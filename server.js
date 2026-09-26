const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const session = require('express-session');
const QRCode = require('qrcode');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const connectDB = require('./db');
const Drive = require('./models/Drive');
const Participant = require('./models/Participant');
const Donor = require('./models/Donor');
const Donation = require('./models/Donation');
const Organizer = require('./models/Organizer');
const Communication = require('./models/Communication');
const AuditLog = require('./models/AuditLog');
const { audit } = require('./services/auditService');
const { generateIntelligentReminders } = require('./services/reminderEngine');
const { createPreview, createRegistrationNotification } = require('./services/communicationEngine');
const { baselinePrediction, updatePrediction } = require('./services/predictionEngine');

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
  return baselinePrediction(participant);
}

function decorateParticipant(participant) {
  const data = participant.toObject ? participant.toObject() : participant;
  return { ...data, predictedAttendance: Number.isFinite(data.predictedAttendance) ? data.predictedAttendance : score(data) };
}

function requireAuth(req, res, next) {
  if (!req.session.organizerId) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.organizerId) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    const role = req.session.organizer?.role || 'OWNER';
    if (!roles.includes(role)) return res.status(403).send('You do not have permission to perform this action.');
    next();
  };
}

function requireDonorAuth(req, res, next) {
  if (!req.session.donorId) return res.redirect(`/donor/login?next=${encodeURIComponent(req.originalUrl)}`);
  next();
}

async function loadDonorDashboard(donorId) {
  const donor = await Donor.findById(donorId);
  if (!donor) return null;
  const [donations, registrations] = await Promise.all([
    Donation.find({ donorId }).populate('driveId').sort({ donationDate: -1 }),
    Participant.find({ donorId }).populate('driveId').sort({ createdAt: -1 })
  ]);
  const participantIds = registrations.map((r) => r._id);
  const notifications = participantIds.length
    ? await Communication.find({ participantId: { $in: participantIds }, consentChecked: true }).populate('driveId').sort({ createdAt: -1 }).limit(50)
    : [];
  const activeDrives = await Drive.find({ status: 'Active', date: { $gte: new Date() } }).sort({ date: 1 });
  const registeredDriveIds = new Set(registrations.map((r) => String(r.driveId?._id || r.driveId)));
  return { donor, donations, registrations, notifications, activeDrives, registeredDriveIds: [...registeredDriveIds] };
}

function canManageParticipants(req) {
  return ['OWNER', 'MANAGER', 'VOLUNTEER'].includes(req.session.organizer?.role || 'OWNER');
}

function canManageSettings(req) {
  return ['OWNER', 'MANAGER'].includes(req.session.organizer?.role || 'OWNER');
}

function ownerFilter(organizerId) {
  return { createdBy: organizerId };
}

async function scopedDriveFilter(req) {
  if ((req.session.organizer?.role || 'OWNER') === 'OWNER') return { createdBy: req.session.organizerId };
  return { organization: req.session.organizer?.organization || '' };
}

async function getOwnedDrive(id, organizerId) {
  const organizer = await Organizer.findById(organizerId).select('organization role');
  if (!organizer) return null;
  if (organizer.role === 'OWNER') return Drive.findOne({ _id: id, createdBy: organizerId });
  return Drive.findOne({ _id: id, $or: [{ organization: organizer.organization }, { createdBy: organizerId }] });
}

async function getOwnedParticipant(id, organizerId) {
  const organizer = await Organizer.findById(organizerId).select('organization role');
  if (!organizer) return null;
  const filter = organizer.role === 'OWNER' ? { createdBy: organizerId } : { organization: organizer.organization };
  const drives = await Drive.find(filter).select('_id');
  return Participant.findOne({ _id: id, driveId: { $in: drives.map((d) => d._id) } });
}

async function getDashboardData(organizerId) {
  const organizer = await Organizer.findById(organizerId).select('organization role');
  if (!organizer) return { drives: [], participants: [], latestDrive: null, stats: { total: 0, confirmed: 0, predicted: 0, attended: 0 }, consentRate: 0, futureConsentRate: 0, confirmedRate: 0, engagedRate: 0, intelligence: { target: 0, gapToTarget: 0, projectedFillRate: 0, atRisk: 0, pending: 0, noConsent: 0, aiCoverage: 0, reminderOpportunity: 0 } };
  const driveFilter = organizer.role === 'OWNER' ? { createdBy: organizerId } : { organization: organizer.organization };
  const drives = await Drive.find(driveFilter).sort({ createdAt: -1 });
  for (const drive of drives) { if (!drive.organization) { drive.organization = organizer.organization; await drive.save(); } }
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
      attendedCount: driveParticipants.filter((p) => p.attendanceStatus === 'Attended').length,
      aiPredictionCount: driveParticipants.filter((p) => p.predictionSource === 'Gemini').length
    };
  });

  const target = drives.reduce((sum, d) => sum + Number(d.targetCount || 0), 0);
  const predictedRounded = Math.round(predicted);
  const atRisk = participants.filter((p) => p.confirmationStatus !== 'Confirmed' && p.predictedAttendance < 60).length;
  const pending = participants.filter((p) => p.confirmationStatus === 'Pending').length;
  const noConsent = participants.filter((p) => !p.communicationConsent).length;
  const intelligence = {
    target,
    gapToTarget: Math.max(0, target - predictedRounded),
    projectedFillRate: target ? Math.min(100, Math.round(predictedRounded / target * 100)) : 0,
    atRisk,
    pending,
    noConsent,
    aiCoverage: total ? Math.round(participants.filter((p) => p.predictionSource === 'Gemini').length / total * 100) : 0,
    reminderOpportunity: participants.filter((p) => p.communicationConsent && p.confirmationStatus !== 'Confirmed' && p.attendanceStatus !== 'Attended').length
  };

  return {
    drives: driveData,
    participants,
    latestDrive: driveData[0] || null,
    stats: { total, confirmed, predicted: predictedRounded, attended },
    consentRate: total ? Math.round(participants.filter((p) => p.communicationConsent).length / total * 100) : 0,
    futureConsentRate: total ? Math.round(participants.filter((p) => p.futureDriveConsent).length / total * 100) : 0,
    confirmedRate: total ? Math.round(confirmed / total * 100) : 0,
    engagedRate: total ? Math.round(participants.filter((p) => p.reminderEngagement > 0).length / total * 100) : 0,
    intelligence
  };
}

app.get('/', async (req, res) => {
  if (req.session.organizerId) return res.redirect('/dashboard');
  if (req.session.donorId) return res.redirect('/donor/dashboard');
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
    req.session.organizer = { name: organizer.name, email: organizer.email, organization: organizer.organization, role: organizer.role || 'OWNER' };
    await audit(req, { action: 'ORGANIZER_REGISTERED', entityType: 'Organizer', entityId: organizer._id, details: { organization: organizer.organization } });
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
    const organizer = await Organizer.findOne({ email, active: { $ne: false } });
    if (!organizer || !(await bcrypt.compare(req.body.password || '', organizer.passwordHash))) {
      return res.status(401).render('login', { error: 'Invalid email or password.', next: req.body.next || '/dashboard' });
    }
    req.session.organizerId = String(organizer._id);
    req.session.organizer = { name: organizer.name, email: organizer.email, organization: organizer.organization, role: organizer.role || 'OWNER' };
        await audit(req, { action: 'LOGIN', entityType: 'Organizer', entityId: organizer._id });
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

app.get('/drives/new', requireRole('OWNER', 'MANAGER'), (req, res) => res.render('new-drive', { organizer: req.session.organizer, error: null }));

app.post('/drives', requireRole('OWNER', 'MANAGER'), async (req, res) => {
  try {
    const drive = await Drive.create({
      name: req.body.name,
      date: req.body.date,
      venue: req.body.venue,
      targetCount: req.body.targetCount,
      screeningLink: req.body.screeningLink,
      description: req.body.description,
      status: req.body.status || 'Active',
      createdBy: req.session.organizerId,
      organization: req.session.organizer.organization
    });
    await audit(req, { action: 'DRIVE_CREATED', entityType: 'Drive', entityId: drive._id, driveId: drive._id, details: { name: drive.name, targetCount: drive.targetCount } });
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
  let predictionRun = null;
  if (req.query.predictions || req.query.failed) {
    predictionRun = {
      total: Number(req.query.predictions || 0),
      gemini: Number(req.query.gemini || 0),
      failed: Number(req.query.failed || 0),
      error: req.query.error ? decodeURIComponent(req.query.error) : ''
    };
  }
  res.render('drive-detail', { drive, url, qr, participants, counts, organizer: req.session.organizer, predictionRun });
});

app.post('/drives/:id/status', requireRole('OWNER', 'MANAGER'), async (req, res) => {
  const drive = await getOwnedDrive(req.params.id, req.session.organizerId);
  if (!drive) return res.status(404).send('Drive not found');
  if (!['Draft', 'Active', 'Completed'].includes(req.body.status)) return res.status(400).send('Invalid status');
  drive.status = req.body.status;
  await drive.save();
  await audit(req, { action: 'DRIVE_STATUS_UPDATED', entityType: 'Drive', entityId: drive._id, driveId: drive._id, details: { status: drive.status } });
  res.redirect(`/drives/${drive._id}`);
});

app.post('/drives/:id/delete', requireRole('OWNER'), async (req, res) => {
  const drive = await getOwnedDrive(req.params.id, req.session.organizerId);
  if (!drive) return res.status(404).send('Drive not found');
  await audit(req, { action: 'DRIVE_DELETED', entityType: 'Drive', entityId: drive._id, driveId: drive._id, details: { name: drive.name } });
  await Participant.deleteMany({ driveId: drive._id });
  await Communication.deleteMany({ driveId: drive._id });
  await drive.deleteOne();
  res.redirect('/dashboard');
});

// Donor account registration is separate from blood-drive registration.
// Creating an account never registers the donor for a drive.
app.get('/donor/register', (req, res) => {
  if (req.session.donorId) return res.redirect('/donor/dashboard');
  res.render('donor-register', { error: null, form: {} });
});

app.post('/donor/register', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const phone = String(req.body.phone || '').trim().replace(/[^0-9]/g, '');
    const email = String(req.body.email || '').trim().toLowerCase();
    const gender = ['Male', 'Female', 'Other'].includes(req.body.gender) ? req.body.gender : '';
    const bloodGroup = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].includes(req.body.bloodGroup) ? req.body.bloodGroup : '';
    const preferredLanguage = ['English', 'Hindi', 'Marathi'].includes(req.body.preferredLanguage)
      ? req.body.preferredLanguage
      : 'English';
    const password = String(req.body.password || '');
    const confirmPassword = String(req.body.confirmPassword || '');
    const communicationConsent = req.body.communicationConsent === 'on';
    const futureDriveConsent = req.body.futureDriveConsent === 'on';

    if (!name || !phone || !gender || !bloodGroup) {
      return res.status(400).render('donor-register', { error: 'Name, mobile number, gender and blood group are required.', form: req.body });
    }
    if (!/^\d{10,15}$/.test(phone)) {
      return res.status(400).render('donor-register', { error: 'Please enter a valid mobile number (10–15 digits).', form: req.body });
    }
    if (!password || password.length < 8) {
      return res.status(400).render('donor-register', { error: 'Please create a password with at least 8 characters.', form: req.body });
    }
    if (password !== confirmPassword) {
      return res.status(400).render('donor-register', { error: 'Passwords do not match.', form: req.body });
    }

    const existing = await Donor.findOne({ phone });
    if (existing && existing.passwordHash) {
      return res.status(409).render('donor-register', {
        error: 'An account already exists for this mobile number. Please use Donor Login instead.',
        form: req.body
      });
    }

    const donor = existing || new Donor({ phone });
    donor.name = name;
    donor.phone = phone;
    donor.email = email;
    donor.gender = gender;
    donor.bloodGroup = bloodGroup;
    donor.preferredLanguage = preferredLanguage;
    donor.communicationConsent = communicationConsent;
    donor.futureDriveConsent = futureDriveConsent;
    donor.passwordHash = await bcrypt.hash(password, 12);
    await donor.save();

    req.session.donorId = String(donor._id);
    req.session.donor = { name: donor.name, phone: donor.phone, bloodGroup: donor.bloodGroup };
    await audit(req, { action: 'DONOR_ACCOUNT_CREATED', entityType: 'Donor', entityId: donor._id, details: { preferredLanguage, communicationConsent, futureDriveConsent } });

    // IMPORTANT: account creation does not create a Participant/drive registration.
    res.redirect('/donor/dashboard');
  } catch (error) {
    console.error('Donor account registration failed:', error);
    res.status(500).render('donor-register', { error: 'Unable to create your donor account right now. Please try again.', form: req.body });
  }
});

// Drive registration is a separate, explicit action from the donor dashboard.
app.get('/register/:id', requireDonorAuth, async (req, res) => {
  const drive = await Drive.findById(req.params.id);
  if (!drive) return res.status(404).send('Drive not found');
  if (drive.status === 'Completed') return res.status(410).send('This drive is closed for registration.');
  res.render('register', { drive, error: null, donor: req.session.donor || {}, form: {} });
});

app.post('/register/:id', requireDonorAuth, async (req, res) => {
  let drive;
  try {
    drive = await Drive.findById(req.params.id);
    if (!drive) return res.status(404).send('Drive not found');
    if (drive.status === 'Completed') return res.status(410).send('This drive is closed for registration.');

    const donor = await Donor.findById(req.session.donorId);
    if (!donor) return req.session.destroy(() => res.redirect('/donor/login'));

    const communicationConsent = req.body.communicationConsent === 'on';
    const futureDriveConsent = req.body.futureDriveConsent === 'on';
    donor.communicationConsent = communicationConsent;
    donor.futureDriveConsent = futureDriveConsent;
    donor.consentUpdatedAt = new Date();
    await donor.save();

    const duplicate = await Participant.findOne({ driveId: drive._id, donorId: donor._id });
    if (duplicate) return res.redirect('/donor/dashboard');

    const previousParticipation = Boolean(await Donation.exists({ donorId: donor._id }));
    const participantData = {
      donorId: donor._id,
      driveId: drive._id,
      registrationCode: `PR-${crypto.randomBytes(6).toString('hex').toUpperCase()}`,
      name: donor.name,
      phone: donor.phone,
      email: donor.email,
      gender: donor.gender,
      bloodGroup: donor.bloodGroup,
      preferredLanguage: donor.preferredLanguage,
      communicationConsent,
      futureDriveConsent,
      previousParticipation,
      confirmationStatus: 'Confirmed',
      confirmedAt: new Date()
    };

    const participant = await Participant.create(participantData);
    await audit(req, { action: 'DONOR_REGISTERED', entityType: 'Participant', entityId: participant._id, driveId: drive._id, donorId: donor._id, details: { preferredLanguage: donor.preferredLanguage, communicationConsent, gender: donor.gender, bloodGroup: donor.bloodGroup } });

    // Only donors who explicitly consented to this drive receive a dashboard notification.
    if (participant.communicationConsent) {
      await createRegistrationNotification(participant, drive);
    }

    updatePrediction(participant, drive)
      .then(() => console.log(`Gemini turnout prediction generated for new registration ${participant.registrationCode}.`))
      .catch((predictionError) => console.error(`Gemini prediction failed after registration ${participant.registrationCode}:`, predictionError));

    res.redirect('/donor/dashboard');
  } catch (error) {
    console.error('Drive registration failed:', error);
    if (drive) {
      return res.status(500).render('register', {
        drive,
        donor: req.session.donor || {},
        error: 'We could not complete the drive registration right now. Please try again.',
        form: req.body
      });
    }
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

  // Confirmation must never depend on Gemini being available. Save the donor's
  // response first, then refresh the AI prediction in the background.
  await participant.save();
  updatePrediction(participant, participant.driveId)
    .then(() => console.log(`Gemini turnout prediction refreshed after donor confirmation ${participant.registrationCode}.`))
    .catch((predictionError) => console.error(`Gemini prediction failed after donor confirmation ${participant.registrationCode}:`, predictionError));

  await audit(req, { action: 'DONOR_CONFIRMATION_UPDATED', entityType: 'Participant', entityId: participant._id, driveId: participant.driveId?._id || participant.driveId, donorId: participant.donorId, details: { status } });
  res.redirect(`/registration/${participant.registrationCode}`);
});

app.post('/donor/notifications/:id/read', requireDonorAuth, async (req, res) => {
  try {
    const donor = await Donor.findById(req.session.donorId);
    if (!donor) return res.status(401).json({ message: 'Donor account not found.' });

    const participant = await Participant.findOne({ _id: req.body.participantId || null, donorId: donor._id }).populate('driveId');
    const notification = await Communication.findOne({ _id: req.params.id, participantId: participant?._id, consentChecked: true });
    if (!notification || !participant) return res.status(404).json({ message: 'Notification not found.' });

    if (!notification.readAt) {
      notification.readAt = new Date();
      notification.readCount = (notification.readCount || 0) + 1;
      notification.engagementRecorded = true;
      await notification.save();

      participant.reminderEngagement = Math.min(3, (participant.reminderEngagement || 0) + 1);
      await participant.save();

      await audit(req, {
        action: 'DONOR_NOTIFICATION_READ',
        entityType: 'Communication',
        entityId: notification._id,
        driveId: participant.driveId?._id || participant.driveId,
        donorId: donor._id,
        details: {
          participantId: participant._id,
          stage: notification.stage,
          readAt: notification.readAt,
          reminderEngagement: participant.reminderEngagement
        },
        actorName: donor.name,
        actorRole: 'DONOR',
        organization: participant.driveId?.organization || 'SYSTEM'
      });

      // Reading a notification is a mobilisation signal used by the turnout engine.
      updatePrediction(participant, participant.driveId)
        .then(() => console.log(`Gemini turnout prediction refreshed after notification read ${notification._id}.`))
        .catch((error) => console.error(`Gemini prediction failed after notification read ${notification._id}:`, error));
    }

    res.redirect('/donor/dashboard');
  } catch (error) {
    console.error('Notification read tracking failed:', error);
    res.status(500).send('Unable to update notification status right now.');
  }
});

app.get('/donor/login', (req, res) => {
  if (req.session.donorId) return res.redirect('/donor/dashboard');
  res.render('donor-login', { error: null, next: req.query.next || '/donor/dashboard' });
});

app.post('/donor/login', async (req, res) => {
  try {
    const phone = (req.body.phone || '').replace(/[^0-9]/g, '');
    const donor = await Donor.findOne({ phone });
    if (!donor || !donor.passwordHash || !(await bcrypt.compare(req.body.password || '', donor.passwordHash))) {
      return res.status(401).render('donor-login', { error: 'Invalid mobile number or password.', next: req.body.next || '/donor/dashboard' });
    }
    req.session.donorId = String(donor._id);
    req.session.donor = { name: donor.name, phone: donor.phone, bloodGroup: donor.bloodGroup };
    await audit(req, { action: 'DONOR_LOGIN', entityType: 'Donor', entityId: donor._id });
    res.redirect(req.body.next || '/donor/dashboard');
  } catch (error) {
    console.error('Donor login failed:', error);
    res.status(500).render('donor-login', { error: 'Unable to sign in right now.', next: req.body.next || '/donor/dashboard' });
  }
});

app.get('/donor/dashboard', requireDonorAuth, async (req, res) => {
  try {
    const data = await loadDonorDashboard(req.session.donorId);
    if (!data) return req.session.destroy(() => res.redirect('/donor/login'));
    res.render('donor-dashboard', data);
  } catch (error) {
    console.error('Donor dashboard failed:', error);
    res.status(500).send('Unable to load donor dashboard right now.');
  }
});

app.post('/donor/logout', requireDonorAuth, (req, res) => req.session.destroy(() => res.redirect('/')));

app.get('/donor/:code', async (req, res) => {
  const participant = await Participant.findOne({ registrationCode: req.params.code }).populate('donorId').populate('driveId');
  if (!participant || !participant.donorId) return res.status(404).send('Donor profile not found');
  const donor = participant.donorId;
  const donations = await Donation.find({ donorId: donor._id }).populate('driveId').sort({ donationDate: -1 });
  res.render('donor-profile', { donor, donations });
});

app.get('/certificates/:code', async (req, res) => {
  const donation = await Donation.findOne({ certificateCode: req.params.code }).populate('donorId').populate('driveId');
  if (!donation) return res.status(404).send('Certificate not found');
  res.render('certificate', { donation, donor: donation.donorId });
});

app.post('/participants/:id/record-donation', requireRole('OWNER', 'MANAGER', 'VOLUNTEER'), async (req, res) => {
  try {
    const participant = await getOwnedParticipant(req.params.id, req.session.organizerId);
    if (!participant) return res.status(404).send('Participant not found');
    if (participant.attendanceStatus !== 'Attended') return res.status(400).send('Mark the participant as attended before recording a donation.');
    const drive = await Drive.findById(participant.driveId);
    if (!drive) return res.status(404).send('Drive not found');
    let donor = participant.donorId ? await Donor.findById(participant.donorId) : await Donor.findOne({ phone: participant.phone });
    if (!donor) {
      donor = await Donor.create({ name: participant.name, phone: participant.phone, email: participant.email, gender: participant.gender || 'Other', bloodGroup: participant.bloodGroup || 'O+', preferredLanguage: participant.preferredLanguage, communicationConsent: participant.communicationConsent, futureDriveConsent: participant.futureDriveConsent });
      participant.donorId = donor._id;
      await participant.save();
    }
    const existing = await Donation.findOne({ participantId: participant._id });
    if (existing) return res.redirect(req.get('referer') || '/participants');
    const donationDate = req.body.donationDate ? new Date(req.body.donationDate) : new Date();
    const pauseDays = donor.gender === 'Female' ? 120 : 90;
    const notificationPausedUntil = new Date(donationDate);
    notificationPausedUntil.setDate(notificationPausedUntil.getDate() + pauseDays);
    donor.lastDonationDate = donationDate;
    donor.notificationPauseDays = pauseDays;
    donor.notificationPausedUntil = notificationPausedUntil;
    await donor.save();
    const certificateCode = `PR-CERT-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
    const donation = await Donation.create({ donorId: donor._id, participantId: participant._id, driveId: drive._id, donationDate, location: drive.venue, certificateCode });
    await audit(req, { action: 'DONATION_RECORDED', entityType: 'Donation', entityId: donation._id, driveId: drive._id, donorId: donor._id, details: { donorId: donor._id, pauseDays, certificateCode } });
    res.redirect(`/donor/${participant.registrationCode}`);
  } catch (error) {
    console.error('Donation record failed:', error);
    res.status(500).send('Unable to record the donation.');
  }
});

app.get('/participants', requireRole('OWNER', 'MANAGER', 'VOLUNTEER'), async (req, res) => {
  const data = await getDashboardData(req.session.organizerId);
  res.render('participants', { ...data, organizer: req.session.organizer });
});

app.post('/participants/:id/confirm', requireRole('OWNER', 'MANAGER', 'VOLUNTEER'), async (req, res) => {
  const participant = await getOwnedParticipant(req.params.id, req.session.organizerId);
  if (!participant) return res.status(404).json({ message: 'Participant not found' });
  const status = ['Pending', 'Confirmed', 'Declined'].includes(req.body.status) ? req.body.status : 'Confirmed';
  participant.confirmationStatus = status;
  participant.responseScore = status === 'Confirmed' ? 2 : status === 'Declined' ? -2 : 0;
  if (status === 'Confirmed') participant.confirmedAt = new Date();
  const drive = await Drive.findById(participant.driveId);
  await participant.save();
  updatePrediction(participant, drive)
    .then(() => console.log(`Gemini turnout prediction refreshed after organizer confirmation ${participant.registrationCode}.`))
    .catch((predictionError) => console.error(`Gemini prediction failed after organizer confirmation ${participant.registrationCode}:`, predictionError));
  await audit(req, { action: 'PARTICIPANT_CONFIRMATION_UPDATED', entityType: 'Participant', entityId: participant._id, driveId: participant.driveId, donorId: participant.donorId, details: { status } });
  res.redirect(req.get('referer') || '/participants');
});

app.post('/participants/:id/consent', requireRole('OWNER', 'MANAGER', 'VOLUNTEER'), async (req, res) => {
  const participant = await getOwnedParticipant(req.params.id, req.session.organizerId);
  if (!participant) return res.status(404).json({ message: 'Participant not found' });
  participant.communicationConsent = req.body.communicationConsent === 'on';
  participant.futureDriveConsent = req.body.futureDriveConsent === 'on';
  participant.consentUpdatedAt = new Date();
  if (!participant.communicationConsent) participant.reminderEngagement = 0;
  const drive = await Drive.findById(participant.driveId);
  await participant.save();
  if (participant.donorId) {
    await Donor.findByIdAndUpdate(participant.donorId, { communicationConsent: participant.communicationConsent, futureDriveConsent: participant.futureDriveConsent, consentUpdatedAt: new Date() });
  }
  await audit(req, { action: 'CONSENT_UPDATED', entityType: 'Participant', entityId: participant._id, driveId: participant.driveId, donorId: participant.donorId, details: { communicationConsent: participant.communicationConsent, futureDriveConsent: participant.futureDriveConsent } });
  updatePrediction(participant, drive).catch((error) => console.error(`Gemini prediction failed after consent update ${participant.registrationCode}:`, error));
  res.redirect(req.get('referer') || '/participants');
});

app.post('/participants/:id/attendance', requireRole('OWNER', 'MANAGER', 'VOLUNTEER'), async (req, res) => {
  const participant = await getOwnedParticipant(req.params.id, req.session.organizerId);
  if (!participant) return res.status(404).json({ message: 'Participant not found' });
  const status = ['Not Marked', 'Attended', 'Absent'].includes(req.body.status) ? req.body.status : 'Attended';
  participant.attendanceStatus = status;
  participant.attendanceMarkedAt = status === 'Not Marked' ? null : new Date();
  await participant.save();
  await audit(req, { action: 'ATTENDANCE_UPDATED', entityType: 'Participant', entityId: participant._id, driveId: participant.driveId, donorId: participant.donorId, details: { status } });
  res.redirect(req.get('referer') || '/participants');
});

app.post('/participants/:id/engagement', requireRole('OWNER', 'MANAGER', 'VOLUNTEER'), async (req, res) => {
  const participant = await getOwnedParticipant(req.params.id, req.session.organizerId);
  if (!participant) return res.status(404).json({ message: 'Participant not found' });
  participant.reminderEngagement = Math.max(0, Math.min(3, Number(req.body.engagement) || 0));
  const drive = await Drive.findById(participant.driveId);
  await updatePrediction(participant, drive);
  res.redirect(req.get('referer') || '/participants');
});


// AI turnout prediction engine. Re-runs Gemini when mobilisation signals change or on demand.
app.post('/predictions/run/:driveId', requireRole('OWNER', 'MANAGER'), async (req, res) => {
  try {
    const drive = await getOwnedDrive(req.params.driveId, req.session.organizerId);
    if (!drive) return res.status(404).send('Drive not found');

    const participants = await Participant.find({ driveId: drive._id }).sort({ createdAt: -1 });
    let geminiCount = 0;
    let failedCount = 0;
    const errors = [];

    for (const participant of participants) {
      try {
        const result = await updatePrediction(participant, drive);
        if (result.predictionSource === 'Gemini') geminiCount += 1;
      } catch (error) {
        failedCount += 1;
        const message = `${participant.name}: ${error.message}`;
        errors.push(message);
        console.error(`Gemini turnout prediction failed for ${participant.name}:`, error);
      }
    }

    const errorText = encodeURIComponent(errors.slice(0, 3).join(' | '));
    res.redirect(`/drives/${drive._id}?predictions=${geminiCount}&gemini=${geminiCount}&failed=${failedCount}&error=${errorText}`);
  } catch (error) {
    console.error('Unable to run turnout predictions:', error);
    res.status(500).send(`Unable to run turnout predictions: ${error.message}`);
  }
});


// Intelligent reminder engine. Gemini decides whether to generate each consented, non-paused notification and writes the message shown to the donor dashboard.
app.post('/reminders/run/:driveId', requireRole('OWNER', 'MANAGER', 'VOLUNTEER'), async (req, res) => {
  try {
    const drive = await getOwnedDrive(req.params.driveId, req.session.organizerId);
    if (!drive) return res.status(404).send('Drive not found');
    const participants = await Participant.find({ driveId: drive._id }).sort({ createdAt: -1 });
    const results = await generateIntelligentReminders(participants, drive);
    const generated = results.filter((r) => !r.skipped).length;
    await audit(req, { action: 'INTELLIGENT_REMINDERS_GENERATED', entityType: 'Drive', entityId: drive._id, driveId: drive._id, details: { generated, skipped: results.length - generated } });
    res.redirect(`/communications?reminders=${generated}&drive=${drive._id}`);
  } catch (error) {
    console.error('Reminder generation failed:', error);
    res.status(500).send(`Unable to generate intelligent reminders: ${error.message}`);
  }
});

app.get('/reminders', requireAuth, async (req, res) => {
  const organizer = await Organizer.findById(req.session.organizerId).select('organization role');
  const driveFilter = organizer?.role === 'OWNER' ? { createdBy: req.session.organizerId } : { organization: organizer?.organization || '' };
  const drives = await Drive.find(driveFilter).sort({ createdAt: -1 });
  const driveIds = drives.map((d) => d._id);
  const reminderCandidates = await Participant.find({ driveId: { $in: driveIds }, communicationConsent: true, confirmationStatus: { $ne: 'Confirmed' }, attendanceStatus: { $ne: 'Attended' } }).populate('driveId').populate('donorId').sort({ createdAt: -1 });
  const now = new Date();
  const participants = reminderCandidates.filter((p) => !(p.donorId?.notificationPausedUntil && new Date(p.donorId.notificationPausedUntil) > now));
  res.render('reminders', { drives, participants, organizer: req.session.organizer });
});

// Volunteer/RBAC management.
app.get('/volunteers', requireRole('OWNER', 'MANAGER'), async (req, res) => {
  const volunteers = await Organizer.find({ organization: req.session.organizer.organization, role: { $in: ['MANAGER', 'VOLUNTEER'] }, _id: { $ne: req.session.organizerId } }).sort({ createdAt: -1 });
  res.render('volunteers', { volunteers, organizer: req.session.organizer, error: null });
});

app.post('/volunteers', requireRole('OWNER', 'MANAGER'), async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const requestedRole = ['MANAGER', 'VOLUNTEER'].includes(req.body.role) ? req.body.role : 'VOLUNTEER';
    const role = req.session.organizer.role === 'OWNER' ? requestedRole : 'VOLUNTEER';
    const password = String(req.body.password || '');
    if (!name || !email || password.length < 8) return res.status(400).render('volunteers', { volunteers: await Organizer.find({ organization: req.session.organizer.organization, role: { $in: ['MANAGER','VOLUNTEER'] } }), organizer: req.session.organizer, error: 'Name, email and an 8+ character password are required.' });
    if (await Organizer.findOne({ email })) return res.status(409).render('volunteers', { volunteers: await Organizer.find({ organization: req.session.organizer.organization, role: { $in: ['MANAGER','VOLUNTEER'] } }), organizer: req.session.organizer, error: 'That email is already in use.' });
    const permissions = role === 'MANAGER' ? ['VIEW_DASHBOARD','MANAGE_DRIVES','MANAGE_PARTICIPANTS','MANAGE_COMMUNICATIONS','VIEW_AUDIT'] : ['VIEW_DASHBOARD','MANAGE_PARTICIPANTS','MANAGE_COMMUNICATIONS'];
    const volunteer = await Organizer.create({ name, email, organization: req.session.organizer.organization, passwordHash: await bcrypt.hash(password, 12), role, permissions });
    await Drive.updateMany({ createdBy: req.session.organizerId, $or: [{ organization: { $exists: false } }, { organization: '' }] }, { $set: { organization: req.session.organizer.organization } });
    await audit(req, { action: 'VOLUNTEER_CREATED', entityType: 'Organizer', entityId: volunteer._id, details: { role, email } });
    res.redirect('/volunteers');
  } catch (error) {
    console.error(error);
    res.status(500).send('Unable to create volunteer account.');
  }
});

app.post('/volunteers/:id/toggle', requireRole('OWNER', 'MANAGER'), async (req, res) => {
  const volunteer = await Organizer.findOne({ _id: req.params.id, organization: req.session.organizer.organization, role: { $in: ['MANAGER', 'VOLUNTEER'] } });
  if (!volunteer) return res.status(404).send('Volunteer not found');
  volunteer.active = !volunteer.active;
  await volunteer.save();
  await audit(req, { action: 'VOLUNTEER_STATUS_CHANGED', entityType: 'Organizer', entityId: volunteer._id, details: { active: volunteer.active } });
  res.redirect('/volunteers');
});

app.get('/audit', requireRole('OWNER', 'MANAGER'), async (req, res) => {
  // Audit is intentionally scoped to drives created by the currently logged-in organizer.
  // This prevents one organizer from viewing donor activity belonging to another organizer's camp.
  const ownedDrives = await Drive.find({ createdBy: req.session.organizerId })
    .select('name date venue createdBy')
    .sort({ createdAt: -1 });
  const ownedDriveIds = ownedDrives.map((drive) => drive._id);
  const selectedDriveId = req.query.drive && ownedDriveIds.some((id) => String(id) === String(req.query.drive))
    ? req.query.drive
    : null;
  const driveIdsForQuery = selectedDriveId ? [selectedDriveId] : ownedDriveIds;

  // Only drive-bound donor activity is shown here. Organizer login/account events are excluded.
  const rawLogs = driveIdsForQuery.length
    ? await AuditLog.find({ driveId: { $in: driveIdsForQuery } })
        .sort({ createdAt: -1 })
        .limit(300)
        .populate('driveId', 'name date venue createdBy')
        .populate('donorId', 'name phone gender bloodGroup')
    : [];

  // Backfill donor identity for audit events written before Commit 10 added AuditLog.donorId.
  // This keeps the new donor audit view useful with existing MongoDB data.
  const logs = [];
  for (const log of rawLogs) {
    let donor = log.donorId;
    if (!donor && log.entityId) {
      if (log.entityType === 'Participant') {
        const participant = await Participant.findById(log.entityId).populate('donorId', 'name phone gender bloodGroup');
        donor = participant?.donorId || null;
      } else if (log.entityType === 'Donation') {
        const donation = await Donation.findById(log.entityId).populate('donorId', 'name phone gender bloodGroup');
        donor = donation?.donorId || null;
      } else if (log.entityType === 'Communication') {
        const communication = await Communication.findById(log.entityId).populate({ path: 'participantId', populate: { path: 'donorId', select: 'name phone gender bloodGroup' } });
        donor = communication?.participantId?.donorId || null;
      }
    }
    if (donor) {
      log.donorId = donor;
      logs.push(log);
    }
  }

  const auditSummary = {
    total: logs.length,
    donors: new Set(logs.map((log) => String(log.donorId?._id || log.donorId))).size
  };

  res.render('audit', {
    logs,
    drives: ownedDrives,
    selectedDriveId,
    auditSummary,
    organizer: req.session.organizer
  });
});

// Communication engine. This generates consent-aware, context-aware message previews.
app.get('/communications', requireRole('OWNER', 'MANAGER', 'VOLUNTEER'), async (req, res) => {
  const organizer = await Organizer.findById(req.session.organizerId).select('organization role');
  const driveFilter = organizer?.role === 'OWNER' ? { createdBy: req.session.organizerId } : { organization: organizer?.organization || '' };
  const drives = await Drive.find(driveFilter).sort({ createdAt: -1 });
  const driveIds = drives.map((d) => d._id);
  const logs = await Communication.find({ driveId: { $in: driveIds } }).populate('participantId').populate('driveId').sort({ createdAt: -1 }).limit(30);
  res.render('communications', { drives, logs, organizer: req.session.organizer });
});

app.post('/communications/preview/:participantId', requireRole('OWNER', 'MANAGER', 'VOLUNTEER'), async (req, res) => {
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

app.post('/communications/preview-drive/:driveId', requireRole('OWNER', 'MANAGER', 'VOLUNTEER'), async (req, res) => {
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
    await audit(req, { action: 'COMMUNICATION_PREVIEWS_GENERATED', entityType: 'Drive', entityId: drive._id, driveId: drive._id, details: { generated, skipped } });
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
