# Commit 8 — Consent-Aware Notifications & Engagement

- Drive registration communication consent controls whether current-drive communications are generated.
- Consent-off participants receive no generated communications.
- Donor dashboard includes a notifications section for consented drive communications.
- Reading a notification records `readAt`, `readCount`, and participant `reminderEngagement`.
- The engagement signal is persisted on the organizer side and fed back into the Gemini turnout prediction engine.
- Organizer communication centre shows read/unread state and engagement count.
- Donor account creation remains separate from drive registration.
- Notification pause after a recorded donation is treated as a future-drive communication setting; explicit current-drive consent still governs communications for an already registered drive.


## Commit 9: post-donation notification pause + Gemini decision engine
- A recorded donation sets `Donor.notificationPausedUntil`. Female = 120 days; Male = 90 days; Other = 90 days.
- The application blocks communication while the pause is active. This deterministic rule cannot be overridden by Gemini.
- Gemini is given the pause state and the mobilisation context and returns `shouldSend`, `reason`, and `message`.
- For reminders, Gemini decides whether a message is useful based on confirmation status, time remaining, response behaviour and reminder engagement.
- For registration acknowledgement, Gemini is instructed to send when current-drive consent is present, unless the post-donation pause blocks it.
- The resulting Gemini message is stored as a donor-dashboard notification. External messaging providers are not connected yet.
