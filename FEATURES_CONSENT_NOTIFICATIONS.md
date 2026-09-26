# Commit 8 — Consent-Aware Notifications & Engagement

- Drive registration communication consent controls whether current-drive communications are generated.
- Consent-off participants receive no generated communications.
- Donor dashboard includes a notifications section for consented drive communications.
- Reading a notification records `readAt`, `readCount`, and participant `reminderEngagement`.
- The engagement signal is persisted on the organizer side and fed back into the Gemini turnout prediction engine.
- Organizer communication centre shows read/unread state and engagement count.
- Donor account creation remains separate from drive registration.
- Notification pause after a recorded donation is treated as a future-drive communication setting; explicit current-drive consent still governs communications for an already registered drive.
