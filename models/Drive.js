const mongoose = require('mongoose');
const driveSchema = new mongoose.Schema({
  name:{type:String,required:true}, date:{type:Date,required:true}, venue:{type:String,required:true},
  targetCount:{type:Number,required:true}, screeningLink:{type:String,default:''}, description:{type:String,default:''},
  status:{type:String,enum:['Draft','Active','Completed'],default:'Active'},
  createdBy:{type:mongoose.Schema.Types.ObjectId,ref:'Organizer',required:true}
},{timestamps:true});
module.exports = mongoose.model('Drive',driveSchema);
