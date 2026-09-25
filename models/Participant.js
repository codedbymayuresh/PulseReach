const mongoose = require('mongoose');
const participantSchema = new mongoose.Schema({
  driveId:{type:mongoose.Schema.Types.ObjectId,ref:'Drive',required:true},
  name:{type:String,required:true}, phone:{type:String,required:true}, email:{type:String,default:''},
  preferredLanguage:{type:String,enum:['English','Hindi','Marathi'],default:'English'},
  communicationConsent:{type:Boolean,default:true}, futureDriveConsent:{type:Boolean,default:false},
  confirmationStatus:{type:String,enum:['Pending','Confirmed','Declined'],default:'Pending'},
  reminderEngagement:{type:Number,default:0}, responseScore:{type:Number,default:0}, previousParticipation:{type:Boolean,default:false},
  predictedAttendance:{type:Number,default:50}, attendanceStatus:{type:String,enum:['Not Marked','Attended','Absent'],default:'Not Marked'}
},{timestamps:true});
module.exports = mongoose.model('Participant',participantSchema);
