const express = require('express');
const path = require('path');
const session = require('express-session');
const QRCode = require('qrcode');
const connectDB = require('./db');
const Drive = require('./models/Drive');
const Participant = require('./models/Participant');

const app = express();
const port = process.env.PORT || 8080;

connectDB();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'pulsereach-prototype',
  resave: false,
  saveUninitialized: true
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

async function getDashboardData() {
  const drives = await Drive.find().sort({ createdAt: -1 });
  const participants = (await Participant.find().sort({ createdAt: -1 })).map(decorateParticipant);

  const total = participants.length;
  const confirmed = participants.filter((p) => p.confirmationStatus === 'Confirmed').length;
  const attended = participants.filter((p) => p.attendanceStatus === 'Attended').length;
  const predicted = total
    ? Math.round(participants.reduce((sum, p) => sum + p.predictedAttendance, 0) / 100 * total)
    : 0;

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
  const data = await getDashboardData();
  res.render('landing', data);
});

app.get('/dashboard', async (req, res) => {
  const data = await getDashboardData();
  res.render('dashboard', data);
});

app.get('/drives/new', (req, res) => res.render('new-drive'));

app.post('/drives', async (req, res) => {
  const drive = await Drive.create({
    name: req.body.name,
    date: req.body.date,
    venue: req.body.venue,
    targetCount: req.body.targetCount,
    screeningLink: req.body.screeningLink,
    description: req.body.description,
    createdBy: 'Organizer'
  });
  res.redirect(`/drives/${drive._id}`);
});

app.get('/drives/:id', async (req, res) => {
  const drive = await Drive.findById(req.params.id);
  if (!drive) return res.status(404).send('Drive not found');

  const url = `${req.protocol}://${req.get('host')}/register/${drive._id}`;
  const qr = await QRCode.toDataURL(url);
  const participants = await Participant.find({ driveId: drive._id });

  res.render('drive-detail', {
    drive,
    url,
    qr,
    participantCount: participants.length
  });
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

app.get('/participants', async (req, res) => {
  const participants = await Participant.find()
    .populate('driveId')
    .sort({ createdAt: -1 });

  res.json(participants.map(decorateParticipant));
});

app.post('/api/participants/:id/confirm', async (req, res) => {
  const participant = await Participant.findByIdAndUpdate(
    req.params.id,
    { confirmationStatus: req.body.status || 'Confirmed' },
    { new: true }
  );

  if (!participant) return res.status(404).json({ message: 'Participant not found' });

  participant.predictedAttendance = score(participant);
  await participant.save();

  res.json({ success: true, participant: decorateParticipant(participant) });
});

app.post('/api/participants/:id/attendance', async (req, res) => {
  const participant = await Participant.findByIdAndUpdate(
    req.params.id,
    { attendanceStatus: req.body.status || 'Attended' },
    { new: true }
  );

  if (!participant) return res.status(404).json({ message: 'Participant not found' });

  res.json({ success: true, participant: decorateParticipant(participant) });
});

app.listen(port, () => console.log(`PulseReach running on http://localhost:${port}`));
