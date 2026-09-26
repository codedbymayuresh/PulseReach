const mongoose = require('mongoose');

const participantSchema = new mongoose.Schema({
  driveId: { type: mongoose.Schema.Types.ObjectId, ref: 'Drive', required: true, index: true },
  registrationCode: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true, trim: true },
  phone: { type: String, required: true, trim: true },
  email: { type: String, default: '', trim: true, lowercase: true },
  preferredLanguage: { type: String, enum: ['English', 'Hindi', 'Marathi'], default: 'English' },
  communicationConsent: { type: Boolean, default: true },
  futureDriveConsent: { type: Boolean, default: false },
  confirmationStatus: { type: String, enum: ['Pending', 'Confirmed', 'Declined'], default: 'Confirmed' },
  reminderEngagement: { type: Number, default: 0 },
  responseScore: { type: Number, default: 0 },
  previousParticipation: { type: Boolean, default: false },
  predictedAttendance: { type: Number, default: 50 },
  attendanceStatus: { type: String, enum: ['Not Marked', 'Attended', 'Absent'], default: 'Not Marked' },
  consentUpdatedAt: { type: Date, default: Date.now },
  confirmedAt: { type: Date, default: Date.now },
  attendanceMarkedAt: { type: Date, default: null }
}, { timestamps: true });

module.exports = mongoose.model('Participant', participantSchema);
