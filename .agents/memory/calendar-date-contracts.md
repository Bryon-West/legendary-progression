---
name: Calendar-date contracts
description: Avoid timestamp coercion and timezone drift for mesocycle calendar dates.
---

Use validated YYYY-MM-DD strings for calendar dates, not Date objects. Reserve timestamp coercion for actual instants.

**Why:** this project's Orval Zod generator coerces OpenAPI `format: date` into a Date object. Parsing outgoing responses then serializes calendar values as ISO timestamps, which fail HTML date-input requirements and obscure their calendar meaning.

**How to apply:** maintain string validation for mesocycle start dates and their workout snapshots when changing contracts or generation settings. Verify the actual JSON response remains YYYY-MM-DD, not just the TypeScript type.