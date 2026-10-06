---
name: Development schema sync
description: Preserve existing development data when Drizzle detects an index-name mismatch.
---

Before `drizzle-kit push`, ensure every integrity rule created in SQL migrations is represented in the Drizzle schema. Checks, foreign keys, and partial indexes omitted from the schema can disappear from Development; Publish diffs live Development against Production, so that drift can become destructive production proposals. If push offers to truncate while adding a unique index, inspect the actual indexes first: an equivalent differently named index can trigger a false duplicate/truncate prompt.

**Why:** SQL migration files preserve historical intent but are not the live-schema comparison used by Publish. A prior development sync also showed how an equivalent index under PostgreSQL's `_key` name can conflict with Drizzle's generated `_unique` name.

**How to apply:** compare `pg_constraint` and `pg_indexes` in both environments with schema source and migration SQL before syncing. Represent existing rules and their semantics in Drizzle, align names/object types where possible, and never accept truncation or force-push merely to bypass a mismatch.
