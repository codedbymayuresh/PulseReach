const connectDB = require('./db');
const Drive = require('./models/Drive');
const Participant = require('./models/Participant');

const initialData = {
  drive: {
    name: 'GCOEA Mega Blood Donation Drive',
    date: new Date('2026-09-25T10:00:00+05:30'),
    venue: 'GCOEA Campus',
    targetCount: 300,
    screeningLink: 'https://example.org/screening',
    description: 'Community blood donation drive coordinated with authorised medical professionals.',
    status: 'Active',
    createdBy: 'GCOEA Blood Cell'
  },
  participants: [
    { name: 'Aarav Patil', phone: '9810000001', preferredLanguage: 'English', communicationConsent: true, futureDriveConsent: true, confirmationStatus: 'Confirmed', reminderEngagement: 3, previousParticipation: true, responseScore: 2 },
    { name: 'Riya Deshmukh', phone: '9810000002', preferredLanguage: 'Marathi', communicationConsent: true, futureDriveConsent: false, confirmationStatus: 'Confirmed', reminderEngagement: 2, previousParticipation: false, responseScore: 1 },
    { name: 'Aditya Joshi', phone: '9810000003', preferredLanguage: 'Hindi', communicationConsent: true, futureDriveConsent: true, confirmationStatus: 'Confirmed', reminderEngagement: 1, previousParticipation: true, responseScore: 0 },
    { name: 'Sneha Kulkarni', phone: '9810000004', preferredLanguage: 'Marathi', communicationConsent: true, futureDriveConsent: true, confirmationStatus: 'Confirmed', reminderEngagement: 3, previousParticipation: false, responseScore: 2 },
    { name: 'Vedant Sharma', phone: '9810000005', preferredLanguage: 'English', communicationConsent: true, futureDriveConsent: false, confirmationStatus: 'Pending', reminderEngagement: 1, previousParticipation: false, responseScore: 1 },
    { name: 'Ananya More', phone: '9810000006', preferredLanguage: 'Hindi', communicationConsent: true, futureDriveConsent: true, confirmationStatus: 'Pending', reminderEngagement: 2, previousParticipation: true, responseScore: 2 },
    { name: 'Om Wankhede', phone: '9810000007', preferredLanguage: 'Marathi', communicationConsent: false, futureDriveConsent: false, confirmationStatus: 'Pending', reminderEngagement: 0, previousParticipation: false, responseScore: 0 }
  ]
};

function score(participant) {
  let score = 45;
  if (participant.confirmationStatus === 'Confirmed') score += 28;
  if (participant.confirmationStatus === 'Declined') score -= 25;
  score += Math.min(15, (participant.reminderEngagement || 0) * 5);
  score += participant.responseScore || 0;
  if (participant.previousParticipation) score += 8;
  return Math.max(5, Math.min(97, score));
}

async function initialize() {
  await connectDB();

  const existingDrive = await Drive.findOne({ name: initialData.drive.name });
  let drive = existingDrive;

  if (!drive) {
    drive = await Drive.create(initialData.drive);
    const participants = initialData.participants.map((participant) => ({
      ...participant,
      driveId: drive._id,
      predictedAttendance: score(participant)
    }));
    await Participant.insertMany(participants);
    console.log(`Initialized drive: ${drive.name}`);
    console.log(`Initialized participants: ${participants.length}`);
  } else {
    console.log(`Initialization skipped: drive already exists (${drive.name})`);
  }

  process.exit(0);
}

initialize().catch((error) => {
  console.error('Initialization failed:', error.message);
  process.exit(1);
});
