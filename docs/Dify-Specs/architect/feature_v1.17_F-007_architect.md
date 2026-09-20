---
title: Feature Architecture v1.17 F-007 — difyctl CLI
id: F-007
status: draft
owner: TBD
updated: 2026-09-20
---

# Feature Architecture v1.17 F-007 — difyctl CLI

> As-built. Read with `architect.md` for system context and `architect_common.md` for the enforced layer rules.

## Design approach

I: `difyctl` is a typed client over the generated contract rather than a hand-written HTTP wrapper — basis: every module in `cli/src/api/` imports its types and its client from `@dify/contracts/api/openapi` [D: cli/src/api/apps.ts:5].

OPEN: why this shape and not another? The code retains no record of what was rejected, and this section states only what the code does.

## Surface

No HTTP surface. 28 leaf commands [D: cli/src/commands/tree.generated.ts:1]; see `data/api-contract_v1.17_F-007.md`.

## Components and call direction

Not applicable — this feature is a client [D: cli/src/api/].

## Stores

No relational store. Local files only [D: cli/src/config/].

## Stated constraints in this feature

18 rule-bearing comments sit in this feature's files. Each is a quote, not a paraphrase; the domain document promotes the ones the code enforces.

- > "Spec 4.3.17: an external SSO token (dfoe_) must be able to start a new conversation and receive a valid response; exit code must be 0." [D: cli/test/e2e/suites/run/run-app-conversation.e2e.ts:197]
- > "Best-effort nudge: never throws, never blocks. Lives here so every authed command flows through it without per-command wiring." [D: cli/src/commands/_shared/authed-command.ts:73]
- > "Spec 5.113: exit codes must be deterministic — the same error condition must always produce the same exit code." [D: cli/test/e2e/suites/error-handling/exit-codes.e2e.ts:145]
- > "Spec 4.5.9: when the form has exactly one action, --action may be omitted and the CLI auto-selects it. Uses hitlSingleActionAppId (display_in_ui=true, 1 action, no required inputs). hitlAppId now has 3 actions so it cannot be used here." [D: cli/test/e2e/suites/run/run-app-hitl.e2e.ts:164]
- > "Version guard for the freshly-authenticated host; wired to enforceDifyVersion at the command boundary. Runs before the session is persisted so we never save credentials for a server too old for this difyctl. Defaults to a no-op." [D: cli/src/commands/auth/login/login.ts:40]
- > "User aborts (ctrl+C) must never retry. Timeouts and other transport errors fall through to shouldRetry, which enforces the method allowlist." [D: cli/src/http/client.ts:210]
- > "Any other transport error on a retryable method retries. User aborts are filtered out earlier in dispatch (before this hook ever runs), so they never reach here." [D: cli/src/http/retry.ts:20]
- > "Per-suite dedicated tokens — each destructive suite (logout, devices) * gets its own fresh dfoa_ token so revoking it never kills the main token." [D: cli/test/e2e/setup/env.ts:114]
- > "Cannot automate: depends on user opening a browser and approving the OAuth grant." [D: cli/test/e2e/suites/auth/login.e2e.ts:232]
- > "Cannot automate: requires waiting for the full Device Flow poll timeout (~5 min)." [D: cli/test/e2e/suites/auth/login.e2e.ts:252]
- > "Inject the dedicated per-suite logoutToken so that auth logout * calls DELETE /account/sessions/self on a disposable session and * never revokes the shared DIFY_E2E_TOKEN used by other suites." [D: cli/test/e2e/suites/auth/logout.e2e.ts:35]
- > "Loose check: most-recently updated item should be somewhere in the first half. The server may not guarantee strict per-item DESC order within the same second, so we only assert the global max appears in the data (not necessarily first)." [D: cli/test/e2e/suites/discovery/get-app-all-workspaces.e2e.ts:234]

…and 6 more in the survey.


## Failure modes

Errors surface as typed exceptions rendered by the blueprint's handler; the guards in the contract table reject before the handler runs [D: api/controllers/].

OPEN: what should a caller do on each failure — retry, back off, or give up? The code raises and the client decides, and no document states the intended client behaviour.

## Observability

Shared for the whole backend: OpenTelemetry, Sentry and structured request logging are attached as extensions [D: api/extensions/ext_otel.py; api/extensions/ext_sentry.py; api/extensions/ext_request_logging.py].

OPEN: which signals in this feature are alerted on? No alert rule lives in this repository.

## Open questions

- OPEN: what are the latency and throughput targets for this feature? None is expressed anywhere.
- OPEN: which of the constraints quoted above are still true? A comment is evidence that someone knew the rule when they wrote it, not that the code beside it still enforces it.
- OPEN: rejected alternatives for this design. Not recoverable from a working tree.
