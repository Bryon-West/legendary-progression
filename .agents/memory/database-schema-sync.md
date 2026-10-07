---
name: Development schema sync
description: Compare Drizzle push previews against live constraints, indexes, and defaults before changing schema.
---

Before `drizzle-kit push`, ensure every integrity rule created in SQL migrations is represented in the Drizzle schema. Checks, foreign keys, and partial indexes omitted from the schema can disappear from Development; Publish diffs live Development against Production, so that drift can become destructive production proposals. If push offers to truncate while adding a unique index, inspect the actual indexes first: an equivalent differently named index can trigger a false duplicate/truncate prompt.

Drizzle may also repeatedly propose `SET DEFAULT '{}'::text[]` for text-array columns after the PostgreSQL catalogs already report that exact default in both Development and Production. Treat this as a tooling normalization quirk, not evidence that the live schemas still differ.

Drizzle Kit's `tablesFilter` limits database introspection, not source-schema serialization. Filtering the database while still loading the full source schema can make real tables look absent; scoping the source to one table can still propose drops for unrelated PostgreSQL sequences.

PostgreSQL truncates identifiers longer than 63 characters. If Drizzle expects a generated foreign-key name longer than that, a live equivalent constraint can appear under the truncated name and the preview may propose dropping/recreating it. Prefer explicit, short names for new constraints; when reconciling an already-applied equivalent rule, rename it in place rather than replacing the rule.

**Why:** SQL migration files preserve historical intent but are not the live-schema comparison used by Publish. Equivalent indexes under different names can trigger false truncate prompts; PostgreSQL can truncate generated names; Drizzle can re-propose array defaults even when catalog values already match; and a filtered preview can omit unrelated objects.

**How to apply:** compare `pg_constraint`, `pg_indexes`, and relevant `information_schema.columns.column_default` values in both environments with schema source and migration SQL before syncing. Prefer a strict, verbose preview against the full schema. Do not accept unrelated sequence drops or data-loss prompts; reconcile name-only differences without removing the integrity rule.
