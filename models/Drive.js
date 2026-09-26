const mongoose = require('mongoose');

const driveSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  date: { type: Date, required: true },
  venue: { type: String, required: true, trim: true },
  targetCount: { type: Number, required: true, min: 1 },
  screeningLink: { type: String, default: '' },
  description: { type: String, default: '' },
  status: { type: String, enum: ['Draft', 'Active', 'Completed'], default: 'Active' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Organizer', required: true, index: true }
}, { timestamps: true });

module.exports = mongoose.model('Drive', driveSchema);
