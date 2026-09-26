const mongoose = require('mongoose');

const organizerSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  organization: { type: String, required: true, trim: true },
  passwordHash: { type: String, required: true }
}, { timestamps: true });

module.exports = mongoose.model('Organizer', organizerSchema);
