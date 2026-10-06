---
name: Development schema sync
description: Preserve existing development data when Drizzle detects an index-name mismatch.
---

Before `drizzle-kit push`, ensure every integrity rule created in SQL migrations is represented in the Drizzle schema. Checks, foreign keys, and partial indexes omitted from the schema can disappear from Development; Publish diffs live Development against Production, so that drift can become destructive production proposals. If push offers to truncate while adding a unique index, inspect the actual indexes first: an equivalent differently named index can trigger a false duplicate/truncate prompt.

Drizzle may also repeatedly propose `SET DEFAULT '{}'::text[]` for text-array columns after the PostgreSQL catalogs already report that exact default in both Development and Production. Treat this as a tooling normalization quirk, not evidence that the live schemas still differ.

**Why:** SQL migration files preserve historical intent but are not the live-schema comparison used by Publish. Equivalent indexes under different names can trigger false truncate prompts, and Drizzle can keep re-proposing array defaults even when catalog values already match.

**How to apply:** compare `pg_constraint`, `pg_indexes`, and relevant `information_schema.columns.column_default` values in both environments with schema source and migration SQL before syncing. Represent existing rules and their semantics in Drizzle, align names/object types where possible, and never accept truncation or force-push merely to bypass a mismatch.
