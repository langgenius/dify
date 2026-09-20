---
title: PRD v1.17 F-007 — difyctl CLI
id: F-007
status: draft
owner: TBD
updated: 2026-09-20
---

# PRD v1.17 F-007 — difyctl CLI

> **Reconstructed, and the weakest document in this hub.** A requirement states intent, and intent is not in a repository. Every story below is inferred from a group of endpoints and test names — evidence that the behaviour exists, never evidence that it was wanted, and never evidence of what it was wanted *for*.

## Summary

`difyctl` gives an operator a terminal equivalent of the console for the operations it covers: authentication, context selection, app listing and running, DSL import/export, member management and skill installation — 28 commands [D: cli/src/commands/tree.generated.ts:1].

OPEN: what problem does this feature solve, for whom, and what changed for them when it shipped? Not recoverable.

## User stories

**F-007-US1** — As a operator, I want to log in to a Dify host from a terminal, so that I can script against it.

  I: inferred from the existence of `difyctl auth login` — basis: a coherent group of operations serves exactly this outcome and nothing else [D: api/controllers/].

**F-007-US2** — As a operator, I want to switch between hosts, accounts and workspaces, so that I can work against more than one.

  I: inferred from the existence of `difyctl use host|account|workspace` — basis: a coherent group of operations serves exactly this outcome and nothing else [D: api/controllers/].

**F-007-US3** — As a operator, I want to list and describe applications, so that I can find what exists without a browser.

  I: inferred from the existence of `difyctl get app`, `difyctl describe app` — basis: a coherent group of operations serves exactly this outcome and nothing else [D: api/controllers/].

**F-007-US4** — As a operator, I want to run an application and stream its output, so that I can drive it from a script or a pipe.

  I: inferred from the existence of `difyctl run app`, `difyctl resume app` — basis: a coherent group of operations serves exactly this outcome and nothing else [D: api/controllers/].

**F-007-US5** — As a operator, I want to import and export a studio app definition, so that I can move an app between instances.

  I: inferred from the existence of `difyctl import studio-app`, `difyctl export studio-app` — basis: a coherent group of operations serves exactly this outcome and nothing else [D: api/controllers/].

**F-007-US6** — As a operator, I want to manage workspace members, so that I can administer without the console.

  I: inferred from the existence of `difyctl create|get|set|delete member` — basis: a coherent group of operations serves exactly this outcome and nothing else [D: api/controllers/].

**F-007-US7** — As a operator, I want to install skills, so that I can set up a workspace repeatably.

  I: inferred from the existence of `difyctl skills install` — basis: a coherent group of operations serves exactly this outcome and nothing else [D: api/controllers/].

OPEN: is this the list of things users actually do, or only the list the API makes possible? The two differ, and only usage data settles it.

## Acceptance criteria

Criteria are lifted from test names where a test states a contract in words — a test named "refuses X" is a Given/When/Then, and it is evidence the behaviour is wanted rather than merely present.

- `--all-workspaces throws UsageInvalidFlag for external logins` [D: cli/src/commands/get/app/run.test.ts:170]
- `--inputs-file: rejects non-object JSON` [D: cli/src/commands/run/app/run.test.ts:338]
- `422 on run: invalidates cache and adds republish hint` [D: cli/src/commands/run/app/run.test.ts:529]
- `[P0] --file remote URL syntax (key=https://...) requires no local upload` [D: cli/test/e2e/suites/run/run-app-file.e2e.ts:135]
- `[P0] --mode chat filters to chat apps only` [D: cli/test/e2e/suites/discovery/get-app-list.e2e.ts:145]
- `[P0] --mode workflow filters to workflow apps only` [D: cli/test/e2e/suites/discovery/get-app-list.e2e.ts:152]
- `[P0] 5.128b --workspace override is per-command only — subsequent calls use the default workspace` [D: cli/test/e2e/suites/framework/global-flags.e2e.ts:122]
- `[P0] Keychain unavailable → token written to hosts.yml (1.7) — requires Device Flow + disabled Keychain` [D: cli/test/e2e/suites/auth/login.e2e.ts:239]
- `[P0] after revoke --all only the current device remains in the list` [D: cli/test/e2e/suites/auth/devices.e2e.ts:292]
- `[P0] auth devices revoke effect=destructive — agent must confirm before calling` [D: cli/test/e2e/suites/agent/agent-skill-workflow.e2e.ts:621]

OPEN: no story above has acceptance criteria covering its happy path in these terms. The suite tests behaviour; it does not restate requirements.

## Implementation status

| story | Status | Evidence |
| --- | --- | --- |
| F-007-US1 | todo | — |
| F-007-US2 | todo | — |
| F-007-US3 | todo | — |
| F-007-US4 | todo | — |
| F-007-US5 | todo | — |
| F-007-US6 | todo | — |
| F-007-US7 | todo | — |

No story may read `done` without the test command and its result in the note [D: docs/Dify-Specs/status-model.md].

## Scope boundaries

OPEN: what was deliberately left out of this feature, and why? A working tree records what exists and keeps no record of what was declined.

## Dependencies

- F-006 — the CLI consumes `/openapi/v1` [D: cli/src/api/apps.ts:5]

OPEN: which external systems is this feature contractually dependent on, as opposed to merely able to use?

## Metrics

OPEN: how is success measured for this feature? No metric, target or SLO appears anywhere in the repository. Telemetry is collected [D: api/tasks/enterprise_telemetry_task.py:19] but what it is read for is not stated.

