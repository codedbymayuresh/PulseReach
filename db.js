const mongoose = require('mongoose');
async function connectDB(){
  const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/pulsereach';
  try { await mongoose.connect(uri); console.log(`MongoDB connected: ${uri}`); }
  catch(e){ console.error('MongoDB connection failed:', e.message); }
}
module.exports = connectDB;
