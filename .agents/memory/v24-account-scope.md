---
name: V2.4 account ownership and scope
description: User-set boundaries for account ownership, data preservation, and auth scope in Hypertrophy Tracker.
---

- Keep both legacy profiles unassigned until the user explicitly approves an ownership decision.
- Give each new account its own private profile; never claim a legacy profile during signup.
- This Clerk instance rejects first/last name fields; send email/password only at signup, and keep the training-profile Name app-owned—never gate profile saves on Clerk name updates.
- Preserve existing data with additive changes; do not force schema changes that truncate or delete records.
- Do not publish, reset the database, add payments, or add social login without explicit approval.
- Use the supplied gold dragon image unchanged on the welcome screen.

**Why:** The user set these boundaries for V2.4 account work, and this Clerk instance rejects name fields. A failed Clerk name update can prevent the training-profile PATCH from being sent.

**How to apply:** Keep these limits in force for follow-up changes, preserve legacy workout history and profile preferences, and keep training-profile names in the app database rather than syncing them through Clerk `user.update`.