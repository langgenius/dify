---
title: PRD v1.17 F-004 — Agent
id: F-004
status: draft
owner: TBD
updated: 2026-09-20
---

# PRD v1.17 F-004 — Agent

> **Reconstructed, and the weakest document in this hub.** A requirement states intent, and intent is not in a repository. Every story below is inferred from a group of endpoints and test names — evidence that the behaviour exists, never evidence that it was wanted, and never evidence of what it was wanted *for*.

## Summary

99 operations serve this feature [D: api/controllers/]. What they let a user accomplish is summarised by the stories below.

OPEN: what problem does this feature solve, for whom, and what changed for them when it shipped? Not recoverable.

## User stories

**F-004-US1** — As a agent author, I want to create an Agent in a workspace roster and reuse it, so that I can stop rebuilding the same agent.

  I: inferred from the existence of `/console/api/agent` — basis: a coherent group of operations serves exactly this outcome and nothing else [D: api/controllers/].

**F-004-US2** — As a agent author, I want to compose an Agent inside a workflow node, so that I can use an agent as one step of a graph.

  I: inferred from the existence of agent-composer endpoints — basis: a coherent group of operations serves exactly this outcome and nothing else [D: api/controllers/].

**F-004-US3** — As a agent author, I want to edit an Agent as a build draft and publish it, so that I can change an agent without breaking live use.

  I: inferred from the existence of build-draft and publish endpoints — basis: a coherent group of operations serves exactly this outcome and nothing else [D: api/controllers/].

**F-004-US4** — As a agent author, I want to inspect and upload the skills and files an Agent config carries, so that I can see what the agent can actually do.

  I: inferred from the existence of agent config inspector endpoints — basis: a coherent group of operations serves exactly this outcome and nothing else [D: api/controllers/].

**F-004-US5** — As a agent author, I want to read an Agent sandbox's files after a run, so that I can debug what the agent did.

  I: inferred from the existence of agent sandbox endpoints — basis: a coherent group of operations serves exactly this outcome and nothing else [D: api/controllers/].

**F-004-US6** — As a agent author, I want to review an Agent's logs and statistics, so that I can know how it is performing.

  I: inferred from the existence of `/console/api/agent/<agent_id>/logs`, statistics endpoints — basis: a coherent group of operations serves exactly this outcome and nothing else [D: api/controllers/].

**F-004-US7** — As a agent author, I want to issue and revoke API keys for an Agent, so that I can let something else call it.

  I: inferred from the existence of `/console/api/agent/<agent_id>/api-keys` — basis: a coherent group of operations serves exactly this outcome and nothing else [D: api/controllers/].

OPEN: is this the list of things users actually do, or only the list the API makes possible? The two differ, and only usage data settles it.

## Acceptance criteria

Criteria are lifted from test names where a test states a contract in words — a test named "refuses X" is a Given/When/Then, and it is evidence the behaviour is wanted rather than merely present.

- `TestInitSchemaRejectsNewerDatabaseWithoutDDL` [D: dify-agent-runtime/internal/server/db_test.go:126]
- `TestInvalidCwd` [D: dify-agent-runtime/tests/acceptance_test.go:561]
- `TestInvalidUTF8` [D: dify-agent-runtime/internal/sanitize/sanitize_test.go:74]
- `TestLandlockCannotReadOtherAgentHome` [D: dify-agent-runtime/tests/acceptance_test.go:725]
- `TestLandlockCannotWriteOutsideHome` [D: dify-agent-runtime/tests/acceptance_test.go:705]
- `TestParseEndpoint_Invalid` [D: dify-agent-runtime/internal/agentcli/env_test.go:69]
- `TestParseTimestampInvalid` [D: dify-agent-runtime/internal/server/runtime_test.go:52]
- `TestRestoreReadOnlyDirectory` [D: dify-agent-runtime/internal/snapshot/restore_test.go:224]
- `TestRestoreRefusesSymlinkComponentEscape` [D: dify-agent-runtime/internal/snapshot/restore_test.go:115]
- `TestRestoreRejectsEscapes` [D: dify-agent-runtime/internal/snapshot/restore_test.go:78]

OPEN: no story above has acceptance criteria covering its happy path in these terms. The suite tests behaviour; it does not restate requirements.

## Implementation status

| story | Status | Evidence |
| --- | --- | --- |
| F-004-US1 | todo | — |
| F-004-US2 | todo | — |
| F-004-US3 | todo | — |
| F-004-US4 | todo | — |
| F-004-US5 | todo | — |
| F-004-US6 | todo | — |
| F-004-US7 | todo | — |

No story may read `done` without the test command and its result in the note [D: docs/Dify-Specs/status-model.md].

## Scope boundaries

OPEN: what was deliberately left out of this feature, and why? A working tree records what exists and keeps no record of what was declined.

## Dependencies

- F-005 — every operation is tenant-scoped and RBAC-guarded [D: api/controllers/console/wraps.py]

OPEN: which external systems is this feature contractually dependent on, as opposed to merely able to use?

## Metrics

OPEN: how is success measured for this feature? No metric, target or SLO appears anywhere in the repository. Telemetry is collected [D: api/tasks/enterprise_telemetry_task.py:19] but what it is read for is not stated.

