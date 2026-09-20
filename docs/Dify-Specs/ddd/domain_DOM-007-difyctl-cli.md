---
title: Domain — difyctl CLI
id: DOM-007
feature: F-007
kind: domain
status: draft
owner: TBD
updated: 2026-09-20
---

# Domain — difyctl CLI (DOM-007)

> Reconstructed from the code. Terms are the identifiers the code uses; rules are promoted from comments that state a rule, and each names the code that enforces it.

## Ubiquitous language

No enumerated columns — this feature owns no relational entity [D: api/models/].


OPEN: several enum values carry no visible meaning beyond their spelling. What distinguishes them to a user?

## Actors

| Actor | Does | Evidence |
| --- | --- | --- |
| Operator | drives a Dify server from a terminal | `cli/src/commands/tree.generated.ts:1` |

OPEN: which of these are distinct personas to the business, and which are the same person in two modes? The code models permissions, not people.

## Business rules

Promoted from 18 rule-bearing comments in this feature's files. Each is `I:` — a comment is evidence that someone knew the rule, not proof the code still enforces it.

**DOM-007-R1** — I: Spec 4.3.17: an external SSO token (dfoe_) must be able to start a new conversation and receive a valid response; exit code must be 0. — basis: stated in a comment at the enforcement site [D: cli/test/e2e/suites/run/run-app-conversation.e2e.ts:197]

**DOM-007-R2** — I: Best-effort nudge: never throws, never blocks. Lives here so every authed command flows through it without per-command wiring. — basis: stated in a comment at the enforcement site [D: cli/src/commands/_shared/authed-command.ts:73]

**DOM-007-R3** — I: Spec 5.113: exit codes must be deterministic — the same error condition must always produce the same exit code. — basis: stated in a comment at the enforcement site [D: cli/test/e2e/suites/error-handling/exit-codes.e2e.ts:145]

**DOM-007-R4** — I: Spec 4.5.9: when the form has exactly one action, --action may be omitted and the CLI auto-selects it. Uses hitlSingleActionAppId (display_in_ui=true, 1 action, no required inputs). hitlAppId now has 3 actions so it cannot be used here. — basis: stated in a comment at the enforcement site [D: cli/test/e2e/suites/run/run-app-hitl.e2e.ts:164]

**DOM-007-R5** — I: Version guard for the freshly-authenticated host; wired to enforceDifyVersion at the command boundary. Runs before the session is persisted so we never save credentials for a server too old for this difyctl. Defaults to a no-op. — basis: stated in a comment at the enforcement site [D: cli/src/commands/auth/login/login.ts:40]

**DOM-007-R6** — I: User aborts (ctrl+C) must never retry. Timeouts and other transport errors fall through to shouldRetry, which enforces the method allowlist. — basis: stated in a comment at the enforcement site [D: cli/src/http/client.ts:210]

**DOM-007-R7** — I: Any other transport error on a retryable method retries. User aborts are filtered out earlier in dispatch (before this hook ever runs), so they never reach here. — basis: stated in a comment at the enforcement site [D: cli/src/http/retry.ts:20]

**DOM-007-R8** — I: Per-suite dedicated tokens — each destructive suite (logout, devices) * gets its own fresh dfoa_ token so revoking it never kills the main token. — basis: stated in a comment at the enforcement site [D: cli/test/e2e/setup/env.ts:114]

**DOM-007-R9** — I: Cannot automate: depends on user opening a browser and approving the OAuth grant. — basis: stated in a comment at the enforcement site [D: cli/test/e2e/suites/auth/login.e2e.ts:232]

**DOM-007-R10** — I: Cannot automate: requires waiting for the full Device Flow poll timeout (~5 min). — basis: stated in a comment at the enforcement site [D: cli/test/e2e/suites/auth/login.e2e.ts:252]

…8 further rule-bearing comments are quoted in `architect/feature_v1.17_F-007_architect.md` and the survey.

OPEN: every rule above states *what*; none states *why*. Which are regulatory, which are product decisions, and which are workarounds?

## Process flow

Recoverable only as call sequence, not as a business process. See `architect/feature_v1.17_F-007_architect.md` and the endpoint table in `data/api-contract_v1.17_F-007.md`.

OPEN: what is the intended happy path from a user's point of view? A route table gives the operations, never the order a person performs them in.

## Invariants

None at the database level — this feature owns no table [D: api/models/].

I: referential invariants between these tables are enforced in service code, not by the database — basis: only 8 `ForeignKey()` declarations exist across all 143 tables [D: api/models/].

OPEN: which invariants does the business require that nothing in the code checks? Those are the ones a bad migration or a direct database write would break silently.

## Implementation status

One row per rule above. States and what `done` costs: `status-model.md`.

| Rule | Status | Evidence |
| --- | --- | --- |
| DOM-007-R1 | todo | — |
| DOM-007-R2 | todo | — |
| DOM-007-R3 | todo | — |
| DOM-007-R4 | todo | — |
| DOM-007-R5 | todo | — |
| DOM-007-R6 | todo | — |
| DOM-007-R7 | todo | — |
| DOM-007-R8 | todo | — |
| DOM-007-R9 | todo | — |
| DOM-007-R10 | todo | — |

## Open questions

- OPEN: is this feature boundary the one the team recognises? It was drawn from handler directories and table ownership, not from anyone's statement of the domain.
- OPEN: no rule in this document is named by any test. Which of them are actually verified, and which only exist as prose next to the code?
- OPEN: what is the source of truth when a comment and the code beside it disagree?
