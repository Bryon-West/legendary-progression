---
name: API test runner
description: Why route-level integration tests use a bundled Node test runner in this workspace.
---

Node cannot reliably execute test modules that import the workspace database package through its TypeScript directory entry. Bundling as CommonJS with esbuild works; an ESM bundle can leave a dynamic `require("events")` that fails at runtime. When the bundled Express app is tested from a temporary path, the development logger's `pino-pretty` transport also fails to resolve, so run the test process with production logging enabled.

**Why:** The API and database packages share TypeScript workspace imports, while the logger's development transport assumes normal package resolution from the app directory. Route-level verification must exercise the real Express app without changing the workspace runtime.

**How to apply:** Use the existing isolated QA test command for API route/database coverage. Keep its test fixtures under their own QA profile name and rely on its cleanup; do not substitute a direct Node run or change the server's normal development logger.