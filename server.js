require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const QRCode = require('qrcode');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const connectDB = require('./db');
const Drive = require('./models/Drive');
const Participant = require('./models/Participant');
const Organizer = require('./models/Organizer');
const Communication = require('./models/Communication');
const { createPreview } = require('./services/communicationEngine');

const app = express();
const port = process.env.PORT || 8080;

connectDB();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'pulsereach-prototype-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax' }
}));

function score(participant) {
  let value = 45;
  if (participant.confirmationStatus === 'Confirmed') value += 28;
  if (participant.confirmationStatus === 'Declined') value -= 25;
  value += Math.min(15, (participant.reminderEngagement || 0) * 5);
  value += participant.responseScore || 0;
  if (participant.previousParticipation) value += 8;
  return Math.max(5, Math.min(97, value));
}

function decorateParticipant(participant) {
  const data = participant.toObject ? participant.toObject() : participant;
  return { ...data, predictedAttendance: score(data) };
}

function requireAuth(req, res, next) {
  if (!req.session.organizerId) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  next();
}

function ownerFilter(organizerId) {
  return { createdBy: organizerId };
}

async function getOwnedDrive(id, organizerId) {
  return Drive.findOne({ _id: id, createdBy: organizerId });
}

async function getOwnedParticipant(id, organizerId) {
  const drives = await Drive.find(ownerFilter(organizerId)).select('_id');
  return Participant.findOne({ _id: id, driveId: { $in: drives.map((d) => d._id) } });
}

async function getDashboardData(organizerId) {
  const drives = await Drive.find(ownerFilter(organizerId)).sort({ createdAt: -1 });
  const driveIds = drives.map((drive) => drive._id);
  const participants = (await Participant.find({ driveId: { $in: driveIds } }).sort({ createdAt: -1 })).map(decorateParticipant);

  const total = participants.length;
  const confirmed = participants.filter((p) => p.confirmationStatus === 'Confirmed').length;
  const attended = participants.filter((p) => p.attendanceStatus === 'Attended').length;
  const predicted = participants.reduce((sum, p) => sum + (p.predictedAttendance / 100), 0);

  const driveData = drives.map((drive) => {
    const driveParticipants = participants.filter((p) => String(p.driveId) === String(drive._id));
    const averagePrediction = driveParticipants.length
      ? Math.round(driveParticipants.reduce((sum, p) => sum + p.predictedAttendance, 0) / driveParticipants.length)
      : 0;
    return {
      ...drive.toObject(),
      predicted: Math.round(driveParticipants.reduce((sum, p) => sum + p.predictedAttendance / 100, 0)),
      averagePrediction,
      registrationCount: driveParticipants.length,
      confirmedCount: driveParticipants.filter((p) => p.confirmationStatus === 'Confirmed').length,
      pendingCount: driveParticipants.filter((p) => p.confirmationStatus === 'Pending').length,
      attendedCount: driveParticipants.filter((p) => p.attendanceStatus === 'Attended').length
    };
  });

  return {
    drives: driveData,
    participants,
    latestDrive: driveData[0] || null,
    stats: { total, confirmed, predicted: Math.round(predicted), attended },
    consentRate: total ? Math.round(participants.filter((p) => p.communicationConsent).length / total * 100) : 0,
    futureConsentRate: total ? Math.round(participants.filter((p) => p.futureDriveConsent).length / total * 100) : 0,
    confirmedRate: total ? Math.round(confirmed / total * 100) : 0,
    engagedRate: total ? Math.round(participants.filter((p) => p.reminderEngagement > 0).length / total * 100) : 0
  };
}

app.get('/', async (req, res) => {
  if (req.session.organizerId) return res.redirect('/dashboard');
  try {
    const drive = await Drive.findOne({ status: { $ne: 'Completed' } }).sort({ createdAt: -1 });
    if (!drive) {
      return res.render('landing', { latestDrive: null, drives: [], participants: [], stats: { total: 0, confirmed: 0, predicted: 0, attended: 0 }, consentRate: 0, confirmedRate: 0, engagedRate: 0 });
    }
    const participants = (await Participant.find({ driveId: drive._id }).sort({ createdAt: -1 })).map(decorateParticipant);
    const confirmed = participants.filter((p) => p.confirmationStatus === 'Confirmed').length;
    const predicted = Math.round(participants.reduce((sum, p) => sum + p.predictedAttendance / 100, 0));
    const confirmedRate = participants.length ? Math.round(confirmed / participants.length * 100) : 0;
    const engagedRate = participants.length ? Math.round(participants.filter((p) => p.reminderEngagement > 0).length / participants.length * 100) : 0;
    const publicDrive = { ...drive.toObject(), registrationCount: participants.length, predicted };
    res.render('landing', { latestDrive: publicDrive, drives: [publicDrive], participants, stats: { total: participants.length, confirmed, predicted, attended: participants.filter((p) => p.attendanceStatus === 'Attended').length }, consentRate: participants.length ? Math.round(participants.filter((p) => p.communicationConsent).length / participants.length * 100) : 0, confirmedRate, engagedRate });
  } catch (error) {
    console.error(error);
    res.status(500).send('Unable to load PulseReach right now.');
  }
});

app.get('/register-organizer', (req, res) => res.render('organizer-register', { error: null }));

app.post('/register-organizer', async (req, res) => {
  try {
    const { name, email, organization, password, confirmPassword } = req.body;
    if (!name || !email || !organization || !password) return res.render('organizer-register', { error: 'Please fill in all fields.' });
    if (password.length < 8) return res.render('organizer-register', { error: 'Password must be at least 8 characters.' });
    if (password !== confirmPassword) return res.render('organizer-register', { error: 'Passwords do not match.' });
    const normalizedEmail = email.toLowerCase().trim();
    const existing = await Organizer.findOne({ email: normalizedEmail });
    if (existing) return res.render('organizer-register', { error: 'An organizer account with this email already exists.' });
    const passwordHash = await bcrypt.hash(password, 12);
    const organizer = await Organizer.create({ name, email: normalizedEmail, organization, passwordHash });
    req.session.organizerId = String(organizer._id);
    req.session.organizer = { name: organizer.name, email: organizer.email, organization: organizer.organization };
    res.redirect('/dashboard');
  } catch (error) {
    console.error(error);
    res.status(500).render('organizer-register', { error: 'Unable to create the account right now.' });
  }
});

app.get('/login', (req, res) => {
  if (req.session.organizerId) return res.redirect('/dashboard');
  res.render('login', { error: null, next: req.query.next || '/dashboard' });
});

app.post('/login', async (req, res) => {
  try {
    const email = (req.body.email || '').toLowerCase().trim();
    const organizer = await Organizer.findOne({ email });
    if (!organizer || !(await bcrypt.compare(req.body.password || '', organizer.passwordHash))) {
      return res.status(401).render('login', { error: 'Invalid email or password.', next: req.body.next || '/dashboard' });
    }
    req.session.organizerId = String(organizer._id);
    req.session.organizer = { name: organizer.name, email: organizer.email, organization: organizer.organization };
    res.redirect(req.body.next || '/dashboard');
  } catch (error) {
    console.error(error);
    res.status(500).render('login', { error: 'Unable to sign in right now.', next: req.body.next || '/dashboard' });
  }
});

app.post('/logout', (req, res) => req.session.destroy(() => res.redirect('/')));

app.get('/dashboard', requireAuth, async (req, res) => {
  const data = await getDashboardData(req.session.organizerId);
  res.render('dashboard', { ...data, organizer: req.session.organizer });
});

app.get('/drives/new', requireAuth, (req, res) => res.render('new-drive', { organizer: req.session.organizer, error: null }));

app.post('/drives', requireAuth, async (req, res) => {
  try {
    const drive = await Drive.create({
      name: req.body.name,
      date: req.body.date,
      venue: req.body.venue,
      targetCount: req.body.targetCount,
      screeningLink: req.body.screeningLink,
      description: req.body.description,
      status: req.body.status || 'Active',
      createdBy: req.session.organizerId
    });
    res.redirect(`/drives/${drive._id}`);
  } catch (error) {
    console.error(error);
    res.status(400).render('new-drive', { organizer: req.session.organizer, error: 'Please check the drive details and try again.' });
  }
});

app.get('/drives/:id', requireAuth, async (req, res) => {
  const drive = await getOwnedDrive(req.params.id, req.session.organizerId);
  if (!drive) return res.status(404).send('Drive not found');
  const url = `${req.protocol}://${req.get('host')}/register/${drive._id}`;
  const qr = await QRCode.toDataURL(url);
  const participants = (await Participant.find({ driveId: drive._id }).sort({ createdAt: -1 })).map(decorateParticipant);
  const counts = {
    total: participants.length,
    confirmed: participants.filter((p) => p.confirmationStatus === 'Confirmed').length,
    pending: participants.filter((p) => p.confirmationStatus === 'Pending').length,
    attended: participants.filter((p) => p.attendanceStatus === 'Attended').length,
    absent: participants.filter((p) => p.attendanceStatus === 'Absent').length,
    predicted: Math.round(participants.reduce((sum, p) => sum + p.predictedAttendance / 100, 0))
  };
  res.render('drive-detail', { drive, url, qr, participants, counts, organizer: req.session.organizer });
});

app.post('/drives/:id/status', requireAuth, async (req, res) => {
  const drive = await getOwnedDrive(req.params.id, req.session.organizerId);
  if (!drive) return res.status(404).send('Drive not found');
  if (!['Draft', 'Active', 'Completed'].includes(req.body.status)) return res.status(400).send('Invalid status');
  drive.status = req.body.status;
  await drive.save();
  res.redirect(`/drives/${drive._id}`);
});

app.post('/drives/:id/delete', requireAuth, async (req, res) => {
  const drive = await getOwnedDrive(req.params.id, req.session.organizerId);
  if (!drive) return res.status(404).send('Drive not found');
  await Participant.deleteMany({ driveId: drive._id });
  await drive.deleteOne();
  res.redirect('/dashboard');
});

// Public participant registration. No organizer account is required.
app.get('/register/:id', async (req, res) => {
  const drive = await Drive.findById(req.params.id);
  if (!drive) return res.status(404).send('Drive not found');
  if (drive.status === 'Completed') return res.status(410).send('This drive is closed for registration.');
  res.render('register', { drive, error: null });
});

app.post('/register/:id', async (req, res) => {
  try {
    const drive = await Drive.findById(req.params.id);
    if (!drive) return res.status(404).send('Drive not found');
    if (drive.status === 'Completed') return res.status(410).send('This drive is closed for registration.');
    if (!req.body.name || !req.body.phone) return res.status(400).render('register', { drive, error: 'Name and mobile number are required.' });

    const duplicate = await Participant.findOne({ driveId: drive._id, phone: req.body.phone.trim() });
    if (duplicate) return res.render('register', { drive, error: 'This mobile number is already registered for this drive.' });

    const registrationCode = `PR-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const participantData = {
      driveId: drive._id,
      registrationCode,
      name: req.body.name,
      phone: req.body.phone,
      email: req.body.email,
      preferredLanguage: req.body.preferredLanguage || 'English',
      communicationConsent: req.body.communicationConsent === 'on',
      futureDriveConsent: req.body.futureDriveConsent === 'on',
      confirmationStatus: 'Confirmed',
      confirmedAt: new Date()
    };
    participantData.predictedAttendance = score(participantData);
    const participant = await Participant.create(participantData);
    res.render('success', { drive, participant: decorateParticipant(participant) });
  } catch (error) {
    console.error(error);
    res.status(500).send('Unable to complete registration.');
  }
});

app.get('/registration/:code', async (req, res) => {
  const participant = await Participant.findOne({ registrationCode: req.params.code }).populate('driveId');
  if (!participant) return res.status(404).send('Registration not found');
  res.render('registration-status', { participant: decorateParticipant(participant), drive: participant.driveId });
});

// Public confirmation link: a participant can change their confirmation state without an organizer login.
app.post('/registration/:code/confirmation', async (req, res) => {
  const participant = await Participant.findOne({ registrationCode: req.params.code }).populate('driveId');
  if (!participant) return res.status(404).send('Registration not found');
  const status = ['Confirmed', 'Declined', 'Pending'].includes(req.body.status) ? req.body.status : 'Pending';
  participant.confirmationStatus = status;
  participant.responseScore = status === 'Confirmed' ? 2 : status === 'Declined' ? -2 : 0;
  if (status === 'Confirmed') participant.confirmedAt = new Date();
  participant.predictedAttendance = score(participant);
  await participant.save();
  res.redirect(`/registration/${participant.registrationCode}`);
});

app.get('/participants', requireAuth, async (req, res) => {
  const data = await getDashboardData(req.session.organizerId);
  res.render('participants', { ...data, organizer: req.session.organizer });
});

app.post('/participants/:id/confirm', requireAuth, async (req, res) => {
  const participant = await getOwnedParticipant(req.params.id, req.session.organizerId);
  if (!participant) return res.status(404).json({ message: 'Participant not found' });
  const status = ['Pending', 'Confirmed', 'Declined'].includes(req.body.status) ? req.body.status : 'Confirmed';
  participant.confirmationStatus = status;
  participant.responseScore = status === 'Confirmed' ? 2 : status === 'Declined' ? -2 : 0;
  if (status === 'Confirmed') participant.confirmedAt = new Date();
  participant.predictedAttendance = score(participant);
  await participant.save();
  res.redirect(req.get('referer') || '/participants');
});

app.post('/participants/:id/consent', requireAuth, async (req, res) => {
  const participant = await getOwnedParticipant(req.params.id, req.session.organizerId);
  if (!participant) return res.status(404).json({ message: 'Participant not found' });
  participant.communicationConsent = req.body.communicationConsent === 'on';
  participant.futureDriveConsent = req.body.futureDriveConsent === 'on';
  participant.consentUpdatedAt = new Date();
  if (!participant.communicationConsent) participant.reminderEngagement = 0;
  participant.predictedAttendance = score(participant);
  await participant.save();
  res.redirect(req.get('referer') || '/participants');
});

app.post('/participants/:id/attendance', requireAuth, async (req, res) => {
  const participant = await getOwnedParticipant(req.params.id, req.session.organizerId);
  if (!participant) return res.status(404).json({ message: 'Participant not found' });
  const status = ['Not Marked', 'Attended', 'Absent'].includes(req.body.status) ? req.body.status : 'Attended';
  participant.attendanceStatus = status;
  participant.attendanceMarkedAt = status === 'Not Marked' ? null : new Date();
  await participant.save();
  res.redirect(req.get('referer') || '/participants');
});

app.post('/participants/:id/engagement', requireAuth, async (req, res) => {
  const participant = await getOwnedParticipant(req.params.id, req.session.organizerId);
  if (!participant) return res.status(404).json({ message: 'Participant not found' });
  participant.reminderEngagement = Math.max(0, Math.min(3, Number(req.body.engagement) || 0));
  participant.predictedAttendance = score(participant);
  await participant.save();
  res.redirect(req.get('referer') || '/participants');
});


// Communication engine. This generates consent-aware, context-aware message previews.
app.get('/communications', requireAuth, async (req, res) => {
  const drives = await Drive.find(ownerFilter(req.session.organizerId)).sort({ createdAt: -1 });
  const driveIds = drives.map((d) => d._id);
  const logs = await Communication.find({ driveId: { $in: driveIds } }).populate('participantId').populate('driveId').sort({ createdAt: -1 }).limit(30);
  res.render('communications', { drives, logs, organizer: req.session.organizer });
});

app.post('/communications/preview/:participantId', requireAuth, async (req, res) => {
  try {
    const participant = await getOwnedParticipant(req.params.participantId, req.session.organizerId);
    if (!participant) return res.status(404).send('Participant not found');
    const drive = await getOwnedDrive(participant.driveId, req.session.organizerId);
    if (!drive) return res.status(404).send('Drive not found');
    await createPreview(participant, drive);
    res.redirect(req.get('referer') || `/drives/${drive._id}`);
  } catch (error) {
    console.error(error);
    res.status(500).send('Unable to generate communication preview.');
  }
});

app.post('/communications/preview-drive/:driveId', requireAuth, async (req, res) => {
  try {
    const drive = await getOwnedDrive(req.params.driveId, req.session.organizerId);
    if (!drive) return res.status(404).send('Drive not found');
    const participants = await Participant.find({ driveId: drive._id, communicationConsent: true });
    let generated = 0;
    let skipped = 0;
    for (const participant of participants) {
      const result = await createPreview(participant, drive);
      if (result.skipped) skipped += 1;
      else generated += 1;
    }
    res.redirect(`/communications?generated=${generated}&skipped=${skipped}`);
  } catch (error) {
    console.error(error);
    res.status(500).send('Unable to generate communication previews.');
  }
});

// Backward-compatible JSON endpoints for future frontend/API work.
app.get('/api/participants', requireAuth, async (req, res) => {
  const data = await getDashboardData(req.session.organizerId);
  res.json(data.participants);
});

app.post('/api/participants/:id/confirm', requireAuth, async (req, res) => {
  const participant = await getOwnedParticipant(req.params.id, req.session.organizerId);
  if (!participant) return res.status(404).json({ message: 'Participant not found' });
  participant.confirmationStatus = req.body.status || 'Confirmed';
  participant.predictedAttendance = score(participant);
  await participant.save();
  res.json({ success: true, participant: decorateParticipant(participant) });
});

app.post('/api/participants/:id/attendance', requireAuth, async (req, res) => {
  const participant = await getOwnedParticipant(req.params.id, req.session.organizerId);
  if (!participant) return res.status(404).json({ message: 'Participant not found' });
  participant.attendanceStatus = req.body.status || 'Attended';
  participant.attendanceMarkedAt = new Date();
  await participant.save();
  res.json({ success: true, participant: decorateParticipant(participant) });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send('Something went wrong.');
});

app.listen(port, () => console.log(`PulseReach running on http://localhost:${port}`));
