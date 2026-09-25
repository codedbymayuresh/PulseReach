const mongoose = require('mongoose');
const driveSchema = new mongoose.Schema({
  name:{type:String,required:true}, date:{type:Date,required:true}, venue:{type:String,required:true},
  targetCount:{type:Number,required:true}, screeningLink:{type:String,default:''}, description:{type:String,default:''},
  status:{type:String,enum:['Draft','Active','Completed'],default:'Active'}, createdBy:{type:String,default:'Demo Organizer'}
},{timestamps:true});
module.exports = mongoose.model('Drive',driveSchema);
