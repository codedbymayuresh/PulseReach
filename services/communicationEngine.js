const Communication = require('../models/Communication');
const Donor = require('../models/Donor');

const languageNames = { English: 'English', Hindi: 'Hindi', Marathi: 'Marathi' };

function stageFor(participant, drive) {
  const now = new Date();
  const eventDate = new Date(drive.date);
  const hours = (eventDate - now) / 36e5;
  if (participant.confirmationStatus === 'Pending') return hours <= 24 ? 'Final reminder' : 'Confirmation';
  if (participant.confirmationStatus === 'Declined') return 'Follow-up';
  if (hours <= 24) return 'Final reminder';
  return 'Reminder';
}

function contextFor(participant, drive, stage) {
  const hours = Math.max(0, Math.round((new Date(drive.date) - new Date()) / 36e5));
  return {
    participantName: participant.name,
    preferredLanguage: languageNames[participant.preferredLanguage] || 'English',
    stage,
    confirmationStatus: participant.confirmationStatus,
    previousResponse: participant.responseScore > 0 ? 'Positive' : participant.responseScore < 0 ? 'Negative' : 'No recent response',
    previousParticipation: participant.previousParticipation,
    reminderEngagement: participant.reminderEngagement,
    hoursRemaining: hours,
    driveName: drive.name,
    date: new Date(drive.date).toLocaleString('en-IN'),
    venue: drive.venue
  };
}

function templateMessage(context) {
  const en = {
    Confirmation: `Hi ${context.participantName}, your registration for ${context.driveName} is waiting for confirmation. Please confirm if you plan to attend.`,
    Reminder: `Hi ${context.participantName}, a reminder from PulseReach: ${context.driveName} is coming up at ${context.venue}. Your current status is ${context.confirmationStatus.toLowerCase()}. Please confirm your participation if you can attend.`,
    'Final reminder': `Hi ${context.participantName}, ${context.driveName} is coming up soon at ${context.venue}. Your response helps the organiser plan the drive. Please confirm or update your registration.`,
    'Follow-up': `Hi ${context.participantName}, we noticed your registration response for ${context.driveName}. If your plans have changed, you can update your confirmation from your registration page.`,
    Registration: `Hi ${context.participantName}, thanks for registering for ${context.driveName}. We have recorded your registration and will share relevant updates according to your communication consent.`
  };
  if (context.preferredLanguage === 'Hindi') {
    return en[context.stage].replace(/^Hi ([^,]+),/, 'नमस्ते $1,');
  }
  if (context.preferredLanguage === 'Marathi') {
    return en[context.stage].replace(/^Hi ([^,]+),/, 'नमस्कार $1,');
  }
  return en[context.stage];
}

async function generateWithGemini(context) {
  if (!process.env.GEMINI_API_KEY) return null;
  const model = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const prompt = `You are PulseReach, an administrative blood-drive mobilisation assistant. Generate ONE short, respectful reminder message. Do not provide medical advice or eligibility guidance. Do not mention blood type or medical status. Use the participant's preferred language. Never pressure the participant. Include a clear action such as confirm/update registration when relevant.\n\nContext:\n${JSON.stringify(context, null, 2)}\n\nReturn only the message text, no quotes, headings, or explanation.`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.5, maxOutputTokens: 180 } })
  });
  if (!response.ok) throw new Error(`Gemini API returned ${response.status}`);
  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim();
  return text || null;
}

async function generateCommunication(participant, drive) {
  const stage = stageFor(participant, drive);
  const context = contextFor(participant, drive, stage);
  let message = null;
  let generatedBy = 'Template';
  try {
    message = await generateWithGemini(context);
    if (message) generatedBy = 'Gemini';
  } catch (error) {
    console.warn('Gemini generation failed; using template fallback:', error.message);
  }
  message = message || templateMessage(context);
  return { stage, context, message, generatedBy };
}

async function createPreview(participant, drive) {
  if (!participant.communicationConsent) {
    return { skipped: true, reason: 'Participant has withdrawn current-drive communication consent.' };
  }
  if (participant.donorId) {
    const donor = await Donor.findById(participant.donorId).select('notificationPausedUntil');
    if (donor?.notificationPausedUntil && donor.notificationPausedUntil > new Date()) {
      return { skipped: true, reason: `Future-drive notifications are paused until ${donor.notificationPausedUntil.toLocaleDateString('en-IN')}.` };
    }
  }
  const result = await generateCommunication(participant, drive);
  const log = await Communication.create({
    driveId: drive._id,
    participantId: participant._id,
    stage: result.stage,
    language: participant.preferredLanguage,
    message: result.message,
    generatedBy: result.generatedBy,
    consentChecked: true
  });
  return { skipped: false, ...result, log };
}

module.exports = { generateCommunication, createPreview, stageFor };
