# PulseReach — First Commit

Intelligent Blood Donation Mobilisation & Turnout Platform prototype.

## First-commit scope
- Landing page / product UI
- Organiser dashboard with registrations, confirmation, predicted attendance and actual attendance metrics
- Blood-drive creation
- Shareable donor registration page
- QR code for registration
- Participant profile signals: language, consent, confirmation, reminder engagement, previous participation
- Prototype turnout score that updates when confirmation changes
- Separate current-drive and future-drive communication consent
- Basic attendance API
- Medical boundary explicitly kept outside the platform

## Run locally
1. Install Node.js 18+ and MongoDB.
2. `npm install`
3. `npm start`
4. Open `http://localhost:8080`

Optional environment variables: `MONGO_URI`, `PORT`, `SESSION_SECRET`.

## Demo
The app seeds a GCOEA Mega Blood Donation Drive with sample participants on first launch. Open `/dashboard` for the organiser view or `/register/demo` for the donor registration flow.

## Next commit ideas
Gemini-powered personalised messages, real reminder delivery, stronger prediction model, Supabase migration, role-based auth, audit log UI, communication-event tracking, CSV export, and production QR/share flows.
