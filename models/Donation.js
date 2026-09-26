const mongoose = require('mongoose');

const donationSchema = new mongoose.Schema({
  donorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Donor', required: true, index: true },
  participantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Participant', required: true, index: true },
  driveId: { type: mongoose.Schema.Types.ObjectId, ref: 'Drive', required: true, index: true },
  donationDate: { type: Date, required: true, default: Date.now },
  location: { type: String, required: true, trim: true },
  certificateCode: { type: String, required: true, unique: true, index: true }
}, { timestamps: true });

module.exports = mongoose.model('Donation', donationSchema);
