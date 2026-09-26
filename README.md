# PulseReach — Commit 6: Turnout Prediction Engine

PulseReach now adds an AI-assisted turnout prediction engine for blood-drive mobilisation.

## What this commit adds

- Gemini-powered turnout prediction using current mobilisation signals.
- Prediction inputs include confirmation status, response behaviour, reminder engagement, previous participation and time remaining.
- Structured Gemini output with predicted attendance probability, confidence and a short factual reason.
- Predictions are recalculated when important participant mobilisation signals change.
- Organisers can run an AI prediction pass for every participant in a drive from the drive workspace.
- Prediction source is stored as `Gemini` or `Heuristic` so the dashboard makes the AI/fallback state visible.
- A deterministic heuristic fallback keeps the prototype functional when Gemini is unavailable.
- Prediction metadata is stored with each participant for dashboard and future analytics use.

## How it works

```text
Participant signals
      ↓
Turnout Prediction Engine
      ↓
Gemini API (when configured)
      ↓
Probability + confidence + reason
      ↓
MongoDB participant record
      ↓
Dashboard / drive prediction
```

Gemini is called server-side only. The API key is never exposed to browser JavaScript.

## Run

```bash
npm install
npm start
```

Open `http://localhost:8080` and sign in as an organiser.

## Gemini API setup

Create `.env` from `.env.example` and configure:

```env
GEMINI_API_KEY=your_key_here
GEMINI_MODEL=gemini-3.8-flash
SESSION_SECRET=replace-with-a-long-random-string
MONGO_URI=mongodb://127.0.0.1:27017/pulsereach
```

Then restart the server. Open a drive and click **Run AI turnout prediction**.

If Gemini is unavailable, PulseReach records a heuristic prediction instead and labels the source accordingly.

**Never commit `.env` or expose the API key in frontend JavaScript.**

## Product boundary

PulseReach handles mobilisation and administrative coordination only. It does not determine medical eligibility, perform clinical screening, diagnose, manage blood collection, manage blood inventory, or store medical records.


### Commit 6 AI behavior
- Turnout predictions use Gemini directly.
- Gemini responses are required to be structured JSON with probability, confidence, and reason.
- Gemini API/network/JSON/schema errors are surfaced in the terminal and drive page.
- A failed Gemini prediction is never silently counted as a successful heuristic prediction.
- The default model is `gemini-3.8-flash`; it can be overridden with `GEMINI_MODEL`.

## Commit 7 bundled features
- Intelligent personalised reminders
- Volunteer roles + role-based access control
- Organisation-scoped audit trail
- Dashboard intelligence and mobilisation signals

No medical eligibility, screening, diagnosis, collection, inventory, or medical records are handled by PulseReach.

## Commit 8 — Consent-aware donor notifications
- Drive-level communication consent controls whether a donor receives communications for that registration.
- Consented communications appear in the donor dashboard Notifications section.
- Opening/marking a notification as read stores a timestamp and increments reminder engagement for the participant.
- Engagement is visible to organizers and is fed back into the Gemini turnout prediction engine.
- Donor account creation remains separate from drive registration.
