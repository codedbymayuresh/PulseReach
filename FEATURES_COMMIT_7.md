# PulseReach — Next Commit Bundle

This bundle keeps the working Commit 6 donor registration + confirmation flow and adds:

1. `feat: intelligent personalized reminders`
2. `feat: volunteer roles + RBAC`
3. `feat: audit trail`
4. `feat: dashboard intelligence`

## Intelligent personalized reminders
- Consent-aware eligibility filtering
- Confirmation/time/engagement-aware urgency
- Existing Gemini/template communication engine reused
- Reminder generation is logged; this prototype does not send messages

## Volunteer roles + RBAC
- OWNER, MANAGER and VOLUNTEER roles
- Team member creation and activation/deactivation
- Managers can manage drives and mobilisation
- Volunteers can manage participants and communications
- Sensitive management/audit actions are restricted

## Audit trail
- Registration
- Login
- Drive creation/status/deletion
- Confirmation
- Consent
- Attendance
- Communication generation
- Reminder generation
- Volunteer account/status changes

## Dashboard intelligence
- Projected target fill
- Gap to target
- At-risk participants
- Reminder opportunities
- Gemini prediction coverage

The product boundary remains mobilisation/admin only. No medical eligibility, diagnosis, screening decisions, collection, inventory or medical records are implemented.
