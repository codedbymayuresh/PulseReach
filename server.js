const express = require('express');
const path = require('path');
const session = require('express-session');
const QRCode = require('qrcode');
const bcrypt = require('bcryptjs');
const connectDB = require('./db');
const Drive = require('./models/Drive');
const Participant = require('./models/Participant');
const Organizer = require('./models/Organizer');

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

async function getDashboardData(organizerId) {
  const drives = await Drive.find({ createdBy: organizerId }).sort({ createdAt: -1 });
  const driveIds = drives.map((drive) => drive._id);
  const participants = (await Participant.find({ driveId: { $in: driveIds } }).sort({ createdAt: -1 })).map(decorateParticipant);

  const total = participants.length;
  const confirmed = participants.filter((p) => p.confirmationStatus === 'Confirmed').length;
  const attended = participants.filter((p) => p.attendanceStatus === 'Attended').length;
  const predicted = total ? Math.round(participants.reduce((sum, p) => sum + p.predictedAttendance, 0) / 100 * total) : 0;

  const driveData = drives.map((drive) => {
    const driveParticipants = participants.filter((p) => String(p.driveId) === String(drive._id));
    const averagePrediction = driveParticipants.length
      ? Math.round(driveParticipants.reduce((sum, p) => sum + p.predictedAttendance, 0) / driveParticipants.length)
      : 0;
    return {
      ...drive.toObject(),
      predicted: Math.min(99, averagePrediction),
      registrationCount: driveParticipants.length,
      confirmedCount: driveParticipants.filter((p) => p.confirmationStatus === 'Confirmed').length,
      attendedCount: driveParticipants.filter((p) => p.attendanceStatus === 'Attended').length
    };
  });

  return {
    drives: driveData,
    participants,
    latestDrive: driveData[0] || null,
    stats: { total, confirmed, predicted, attended },
    consentRate: total ? Math.round(participants.filter((p) => p.communicationConsent).length / total * 100) : 0,
    confirmedRate: total ? Math.round(confirmed / total * 100) : 0,
    engagedRate: total ? Math.round(participants.filter((p) => p.reminderEngagement > 0).length / total * 100) : 0
  };
}

app.get('/', async (req, res) => {
  if (req.session.organizerId) return res.redirect('/dashboard');
  res.render('landing', { latestDrive: null, drives: [], participants: [], stats: { total: 0, confirmed: 0, predicted: 0, attended: 0 }, consentRate: 0, confirmedRate: 0, engagedRate: 0 });
});

app.get('/register-organizer', (req, res) => res.render('organizer-register', { error: null }));

app.post('/register-organizer', async (req, res) => {
  try {
    const { name, email, organization, password, confirmPassword } = req.body;
    if (!name || !email || !organization || !password) return res.render('organizer-register', { error: 'Please fill in all fields.' });
    if (password.length < 8) return res.render('organizer-register', { error: 'Password must be at least 8 characters.' });
    if (password !== confirmPassword) return res.render('organizer-register', { error: 'Passwords do not match.' });
    const existing = await Organizer.findOne({ email: email.toLowerCase().trim() });
    if (existing) return res.render('organizer-register', { error: 'An organizer account with this email already exists.' });

    const passwordHash = await bcrypt.hash(password, 12);
    const organizer = await Organizer.create({ name, email, organization, passwordHash });
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

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

app.get('/dashboard', requireAuth, async (req, res) => {
  const data = await getDashboardData(req.session.organizerId);
  res.render('dashboard', { ...data, organizer: req.session.organizer });
});

app.get('/drives/new', requireAuth, (req, res) => res.render('new-drive', { organizer: req.session.organizer }));

app.post('/drives', requireAuth, async (req, res) => {
  const drive = await Drive.create({
    name: req.body.name,
    date: req.body.date,
    venue: req.body.venue,
    targetCount: req.body.targetCount,
    screeningLink: req.body.screeningLink,
    description: req.body.description,
    createdBy: req.session.organizerId
  });
  res.redirect(`/drives/${drive._id}`);
});

app.get('/drives/:id', requireAuth, async (req, res) => {
  const drive = await Drive.findOne({ _id: req.params.id, createdBy: req.session.organizerId });
  if (!drive) return res.status(404).send('Drive not found');

  const url = `${req.protocol}://${req.get('host')}/register/${drive._id}`;
  const qr = await QRCode.toDataURL(url);
  const participants = await Participant.find({ driveId: drive._id });

  res.render('drive-detail', { drive, url, qr, participantCount: participants.length, organizer: req.session.organizer });
});

app.get('/register/:id', async (req, res) => {
  const drive = await Drive.findById(req.params.id);
  if (!drive) return res.status(404).send('Drive not found');
  res.render('register', { drive });
});

app.post('/register/:id', async (req, res) => {
  const drive = await Drive.findById(req.params.id);
  if (!drive) return res.status(404).send('Drive not found');

  const participant = await Participant.create({
    driveId: drive._id,
    name: req.body.name,
    phone: req.body.phone,
    email: req.body.email,
    preferredLanguage: req.body.preferredLanguage,
    communicationConsent: req.body.communicationConsent === 'on',
    futureDriveConsent: req.body.futureDriveConsent === 'on'
  });

  participant.predictedAttendance = score(participant);
  await participant.save();
  res.render('success', { drive, participant });
});

app.get('/participants', requireAuth, async (req, res) => {
  const drives = await Drive.find({ createdBy: req.session.organizerId }).select('_id');
  const participants = await Participant.find({ driveId: { $in: drives.map(d => d._id) } }).populate('driveId').sort({ createdAt: -1 });
  res.json(participants.map(decorateParticipant));
});

app.post('/api/participants/:id/confirm', requireAuth, async (req, res) => {
  const drives = await Drive.find({ createdBy: req.session.organizerId }).select('_id');
  const participant = await Participant.findOneAndUpdate({ _id: req.params.id, driveId: { $in: drives.map(d => d._id) } }, { confirmationStatus: req.body.status || 'Confirmed' }, { new: true });
  if (!participant) return res.status(404).json({ message: 'Participant not found' });
  participant.predictedAttendance = score(participant);
  await participant.save();
  res.json({ success: true, participant: decorateParticipant(participant) });
});

app.post('/api/participants/:id/attendance', requireAuth, async (req, res) => {
  const drives = await Drive.find({ createdBy: req.session.organizerId }).select('_id');
  const participant = await Participant.findOneAndUpdate({ _id: req.params.id, driveId: { $in: drives.map(d => d._id) } }, { attendanceStatus: req.body.status || 'Attended' }, { new: true });
  if (!participant) return res.status(404).json({ message: 'Participant not found' });
  res.json({ success: true, participant: decorateParticipant(participant) });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send('Something went wrong.');
});

app.listen(port, () => console.log(`PulseReach running on http://localhost:${port}`));
