# Commit 9 — Gemini Notification Policy

## Post-donation notification pause
- When an organiser records a completed donation, PulseReach stores the donation date and calculates `notificationPausedUntil`.
- Male: 90 days.
- Female: 120 days.
- Other: 90 days.
- This is a communication/mobilisation rule, not a medical eligibility decision.

## Gemini decision engine
Every consented notification request first passes the deterministic server-side policy. If the donor is paused, no Gemini generation occurs. Otherwise Gemini receives: current-drive consent state, pause state, confirmation status, previous response, reminder engagement, time remaining, preferred language and notification purpose.

Gemini returns strict JSON with:
- `shouldSend`
- `reason`
- `message`

For reminders, Gemini decides whether another notification is useful. For registration acknowledgement, Gemini is instructed to send for a consented donor unless the pause blocks it.

## Delivery
The generated message is stored in PulseReach and appears in the donor dashboard Notifications section. There is no external SMS, WhatsApp or email provider connected in this prototype yet.
