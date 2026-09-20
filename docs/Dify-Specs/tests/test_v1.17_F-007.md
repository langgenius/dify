---
title: Test Plan v1.17 F-007 — difyctl CLI
id: F-007
status: draft
owner: TBD
updated: 2026-09-20
---

# Test Plan v1.17 F-007 — difyctl CLI

> **This is an as-built record.** It describes the suite that exists, not a suite to be written. Its purpose is the coverage holes listed below.

## Scope and command

1815 test cases across 135 files carry this feature's subject matter [D: survey of test function and `describe`/`it` names].

The project's own command is `make test` [D: Makefile:104], which runs `uv run --project api --dev pytest` in two passes — everything except `api/tests/unit_tests/controllers`, then the controllers [D: Makefile:106].

Docker-backed integration suites are CI-owned and are not expected to run locally [D: api/AGENTS.md:14].

## Test files

| File | Cases |
| --- | --- |
| `cli/src/http/client.test.ts` | 55 |
| `cli/src/framework/run.test.ts` | 53 |
| `cli/src/framework/flags.test.ts` | 44 |
| `cli/test/e2e/suites/framework/help.e2e.ts` | 42 |
| `cli/src/commands/run/app/sse-collector.test.ts` | 38 |
| `cli/scripts/install-cli.test.ts` | 37 |
| `cli/src/commands/run/app/stream-handlers.test.ts` | 37 |
| `cli/src/framework/registry.test.ts` | 37 |
| `cli/src/commands/run/app/run.test.ts` | 36 |
| `cli/test/e2e/suites/run/run-app-basic.e2e.ts` | 35 |
| `cli/test/e2e/suites/agent/agent-skill-workflow.e2e.ts` | 34 |
| `cli/src/sys/io/think-filter.test.ts` | 32 |
| `cli/src/store/store.test.ts` | 31 |
| `cli/test/e2e/suites/discovery/get-app-list.e2e.ts` | 30 |
| `cli/scripts/release-naming.test.ts` | 29 |

…120 more files.


Enumerating all 24,695 cases in the repository into this hub would duplicate the suite without adding information; the suite is the record and this document points at it.

## Representative cases

Cases whose names state a contract rather than an implementation detail:

- `--check-compat exits with COMPAT_FAIL_EXIT_CODE when compat is unsupported` [D: cli/src/commands/version/version.test.ts:116]
- `--inputs-file: rejects non-object JSON` [D: cli/src/commands/run/app/run.test.ts:338]
- `401 classifies by status as AuthExpired with CLI login hint` [D: cli/src/http/error-mapper.test.ts:36]
- `403 with no parseable ErrorBody falls back to generic denied message` [D: cli/src/http/error-mapper.test.ts:95]
- `422 on run: invalidates cache and adds republish hint` [D: cli/src/commands/run/app/run.test.ts:529]
- `GET /openapi/v1/apps/:id returns 404 for unknown id` [D: cli/test/fixtures/dify-mock/server.test.ts:126]
- `[P0] --mode chat filters to chat apps only` [D: cli/test/e2e/suites/discovery/get-app-list.e2e.ts:145]
- `[P0] --mode workflow filters to workflow apps only` [D: cli/test/e2e/suites/discovery/get-app-list.e2e.ts:152]
- `[P0] 5.104 failed command with -o json returns non-zero exit — documents WTA-249 known defect` [D: cli/test/e2e/suites/error-handling/exit-codes.e2e.ts:78]
- `[P0] 5.128b --workspace override is per-command only — subsequent calls use the default workspace` [D: cli/test/e2e/suites/framework/global-flags.e2e.ts:122]
- `[P0] 5.70a validation failure message is a plain string, not double-encoded JSON` [D: cli/test/e2e/suites/error-handling/error-messages.e2e.ts:156]
- `[P0] after revoke --all only the current device remains in the list` [D: cli/test/e2e/suites/auth/devices.e2e.ts:292]
- `[P0] auth devices revoke effect=destructive — agent must confirm before calling` [D: cli/test/e2e/suites/agent/agent-skill-workflow.e2e.ts:621]
- `[P0] browser rejection causes login failure (1.12) — requires OAuth deny` [D: cli/test/e2e/suites/auth/login.e2e.ts:247]
- `[P0] current_workspace_id is unchanged when workspace switch fails` [D: cli/test/e2e/suites/auth/use.e2e.ts:151]

## Coverage holes

The CLI ships its own unit and e2e suites (`cli/test/`, `vp test`) [D: cli/package.json].

OPEN: `cli/package.json` declares `test:coverage`; no coverage threshold is stated, so it is not recoverable whether any level is required to merge.

OPEN: what coverage level is required for this feature? `api-coverage` runs in CI [D: .github/workflows/api-tests.yml:154] but no threshold is stated in the repository.

## Traceability

No test in this repository names a `F-007-US<k>` story or a `DOM-*-R<k>` rule, so no automated link exists between a test and a requirement [D: api/tests/].

OPEN: should tests carry requirement IDs? Without them the status tables in the domain and PRD documents cannot be filled from a test run, and every row stays unverified.

## Implementation status

| Case group | Status | Evidence |
| --- | --- | --- |
| difyctl CLI suite | todo | — |
