const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);

const mongoose = require('mongoose');

async function connectDB() {
  const uri = process.env.MONGO_URI;

  if (!uri) {
    console.error('MONGO_URI is not configured.');
    process.exit(1);
  }

  try {
    await mongoose.connect(uri);
    console.log('MongoDB Atlas connected successfully.');
  } catch (e) {
    console.error('MongoDB connection failed:', e.message);
    process.exit(1);
  }
}

module.exports = connectDB;