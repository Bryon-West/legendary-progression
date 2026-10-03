---
name: V2.4 account ownership and scope
description: User-set boundaries for account ownership, data preservation, and auth scope in Hypertrophy Tracker.
---

- Keep both legacy profiles unassigned until the user explicitly approves an ownership decision.
- Give each new account its own private profile; never claim a legacy profile during signup.
- Preserve existing data with additive changes; do not force schema changes that truncate or delete records.
- Do not publish, reset the database, add payments, or add social login without explicit approval.
- Use the supplied gold dragon image unchanged on the welcome screen.

**Why:** The user set these boundaries for the V2.4 account and authentication work.

**How to apply:** Keep these limits in force for follow-up changes and preserve legacy workout history and profile preferences.