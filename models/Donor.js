const mongoose = require('mongoose');

const donorSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  phone: { type: String, required: true, unique: true, index: true, trim: true },
  passwordHash: { type: String, default: '' },
  email: { type: String, default: '', trim: true, lowercase: true },
  gender: { type: String, enum: ['Male', 'Female', 'Other'], required: true },
  bloodGroup: { type: String, enum: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'], required: true },
  preferredLanguage: { type: String, enum: ['English', 'Hindi', 'Marathi'], default: 'English' },
  communicationConsent: { type: Boolean, default: true },
  futureDriveConsent: { type: Boolean, default: false },
  lastDonationDate: { type: Date, default: null },
  notificationPausedUntil: { type: Date, default: null },
  notificationPauseDays: { type: Number, default: 0 },
  consentUpdatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

donorSchema.virtual('notificationsPaused').get(function () {
  return Boolean(this.notificationPausedUntil && this.notificationPausedUntil > new Date());
});

donorSchema.set('toJSON', { virtuals: true });
donorSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Donor', donorSchema);
