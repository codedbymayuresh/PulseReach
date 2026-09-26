const fs = require('fs');
const path = require('path');

const languageNames = { English: 'English', Hindi: 'Hindi', Marathi: 'Marathi' };

function getGeminiApiKey() {
  if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim()) {
    return process.env.GEMINI_API_KEY.trim();
  }

  const candidates = [
    path.join(__dirname, '..', '.env'),
    path.join(__dirname, '..', '.env.local'),
    path.join(__dirname, '..', 'gemini.key')
  ];

  for (const file of candidates) {
    try {
      const content = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
      const match = content.match(/^\s*GEMINI_API_KEY\s*=\s*[\"']?([^\"'\r\n]+)[\"']?\s*$/m);
      if (match && match[1].trim()) return match[1].trim();
      if (path.basename(file) === 'gemini.key' && content.trim()) return content.trim();
    } catch (_) {}
  }

  return '';
}

function ensureRegistrationCode(participant) {
  if (!participant.registrationCode) {
    participant.registrationCode = `PR-${String(participant._id).slice(-8).toUpperCase()}`;
  }
}

function baselinePrediction(participant, drive) {
  let value = 45;
  if (participant.confirmationStatus === 'Confirmed') value += 28;
  if (participant.confirmationStatus === 'Declined') value -= 25;
  if (participant.confirmationStatus === 'Pending') value -= 5;
  value += Math.min(15, (participant.reminderEngagement || 0) * 5);
  value += participant.responseScore || 0;
  if (participant.previousParticipation) value += 8;

  if (drive?.date) {
    const hoursRemaining = (new Date(drive.date) - new Date()) / 36e5;
    if (hoursRemaining >= 0 && hoursRemaining <= 24) value += 4;
    if (hoursRemaining < 0) value -= 8;
  }

  return Math.max(5, Math.min(97, Math.round(value)));
}

function buildContext(participant, drive) {
  const hoursRemaining = Math.max(0, Math.round((new Date(drive.date) - new Date()) / 36e5));
  return {
    participantName: participant.name,
    preferredLanguage: languageNames[participant.preferredLanguage] || 'English',
    confirmationStatus: participant.confirmationStatus,
    reminderEngagement: participant.reminderEngagement || 0,
    responseScore: participant.responseScore || 0,
    previousParticipation: Boolean(participant.previousParticipation),
    attendanceStatus: participant.attendanceStatus,
    hoursRemaining,
    driveName: drive.name,
    driveDate: new Date(drive.date).toLocaleString('en-IN'),
    venue: drive.venue
  };
}

function extractGeminiError(data, status) {
  return data?.error?.message || data?.error?.status || `Gemini API returned HTTP ${status}`;
}

async function generateWithGemini(context) {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is missing. Put GEMINI_API_KEY=... in the .env file beside server.js, then restart npm start.');
  }

  const model = (process.env.GEMINI_MODEL || 'gemini-3.5-flash').trim();
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const prompt = `You are the turnout prediction engine for PulseReach, an administrative blood-donation mobilisation platform. Estimate the probability that this registered participant will attend the drive.

Use ONLY the supplied mobilisation/engagement signals. Do not infer or mention medical eligibility, health, blood type, diagnosis, age, gender, religion, caste, income, or other sensitive attributes. Do not claim certainty.

Return ONLY one valid JSON object. Do not write an introduction, explanation, markdown, or code fence.
The JSON must contain exactly these fields:
- probability: integer from 0 to 100
- confidence: integer from 0 to 100
- reason: one short factual sentence

The probability should reflect the participant's current confirmation, response behaviour, reminder engagement, previous participation and time remaining. Recalculate when these signals change.

Context:
${JSON.stringify(context, null, 2)}`;

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 512,
          thinkingConfig: { thinkingLevel: 'low' },
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'object',
            properties: {
              probability: { type: 'integer' },
              confidence: { type: 'integer' },
              reason: { type: 'string' }
            },
            required: ['probability', 'confidence', 'reason']
          }
        }
      })
    });
  } catch (error) {
    throw new Error(`Gemini network request failed: ${error.message}`);
  }

  let data = {};
  try {
    data = await response.json();
  } catch (error) {
    throw new Error(`Gemini returned a non-JSON HTTP response (${response.status}).`);
  }

  if (!response.ok) {
    throw new Error(extractGeminiError(data, response.status));
  }

  const raw = data?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim();
  if (!raw) {
    const finishReason = data?.candidates?.[0]?.finishReason || 'unknown';
    throw new Error(`Gemini returned no prediction content (finishReason: ${finishReason}).`);
  }

  // Gemini can occasionally prepend a short sentence or markdown fence even
  // when JSON mode is requested. Extract the first complete JSON object, then
  // validate the required fields below. This is still a Gemini-only result.
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    const objectStart = raw.indexOf('{');
    const objectEnd = raw.lastIndexOf('}');
    const candidate = fenced?.[1]?.trim() ||
      (objectStart >= 0 && objectEnd > objectStart ? raw.slice(objectStart, objectEnd + 1).trim() : '');

    if (!candidate) {
      throw new Error(`Gemini returned invalid prediction JSON: ${raw.slice(0, 240)}`);
    }

    try {
      parsed = JSON.parse(candidate);
    } catch (_) {
      throw new Error(`Gemini returned invalid prediction JSON: ${candidate.slice(0, 240)}`);
    }
  }

  const probability = Number(parsed.probability);
  const confidence = Number(parsed.confidence);
  const reason = String(parsed.reason || '').trim();

  if (!Number.isInteger(probability) || probability < 0 || probability > 100) {
    throw new Error('Gemini prediction JSON has an invalid probability (expected integer 0-100).');
  }
  if (!Number.isInteger(confidence) || confidence < 0 || confidence > 100) {
    throw new Error('Gemini prediction JSON has an invalid confidence (expected integer 0-100).');
  }
  if (!reason) {
    throw new Error('Gemini prediction JSON is missing a reason.');
  }

  return {
    predictedAttendance: probability,
    predictionConfidence: confidence,
    predictionReason: reason,
    predictionSource: 'Gemini'
  };
}

async function updatePrediction(participant, drive, { save = true } = {}) {
  ensureRegistrationCode(participant);

  // Commit 6 is explicitly AI-powered: a failed Gemini request is reported,
  // not silently converted into a successful heuristic prediction.
  const result = await generateWithGemini(buildContext(participant, drive));

  participant.predictedAttendance = result.predictedAttendance;
  participant.predictionConfidence = result.predictionConfidence;
  participant.predictionReason = result.predictionReason;
  participant.predictionSource = result.predictionSource;
  participant.predictionUpdatedAt = new Date();

  if (save) await participant.save();
  return result;
}

module.exports = { baselinePrediction, buildContext, generateWithGemini, updatePrediction };
