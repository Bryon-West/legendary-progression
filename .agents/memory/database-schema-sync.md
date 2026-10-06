---
name: Development schema sync
description: Preserve existing development data when Drizzle detects an index-name mismatch.
---

If `drizzle-kit push` offers to truncate a populated table while adding a unique index, first inspect the actual development database indexes. An equivalent unique index with a different name can make the tool propose a duplicate constraint; align the Drizzle schema with the existing constraint name instead of truncating data or forcing the push.

**Why:** a development table contained the required unique index under PostgreSQL's `_key` name while the Drizzle schema expected `_unique`, causing a misleading truncate prompt.

**How to apply:** query index definitions read-only, confirm equivalence, update the explicit Drizzle constraint name, then rerun the normal development schema push. Never accept truncation or force-push just to bypass this mismatch.
