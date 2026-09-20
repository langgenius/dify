---
title: PRD v1.17 F-006 — Published App Surfaces
id: F-006
status: draft
owner: TBD
updated: 2026-09-20
---

# PRD v1.17 F-006 — Published App Surfaces

> **Reconstructed, and the weakest document in this hub.** A requirement states intent, and intent is not in a repository. Every story below is inferred from a group of endpoints and test names — evidence that the behaviour exists, never evidence that it was wanted, and never evidence of what it was wanted *for*.

## Summary

152 operations serve this feature [D: api/controllers/]. What they let a user accomplish is summarised by the stories below.

OPEN: what problem does this feature solve, for whom, and what changed for them when it shipped? Not recoverable.

## User stories

**F-006-US1** — As a API consumer or end user, I want to call a published application over HTTP with an API key, so that I can integrate it into my own system.

  I: inferred from the existence of `/v1/chat-messages`, `/v1/completion-messages` — basis: a coherent group of operations serves exactly this outcome and nothing else [D: api/controllers/].

**F-006-US2** — As a API consumer or end user, I want to use a published application in a browser without a Dify account, so that I can let end users reach it.

  I: inferred from the existence of `/api/*` with a passport token — basis: a coherent group of operations serves exactly this outcome and nothing else [D: api/controllers/].

**F-006-US3** — As a API consumer or end user, I want to stream a response and stop it mid-flight, so that I can keep a UI responsive.

  I: inferred from the existence of `/v1/chat-messages/<task_id>/stop` — basis: a coherent group of operations serves exactly this outcome and nothing else [D: api/controllers/].

**F-006-US4** — As a API consumer or end user, I want to drive the product from a third-party integration with OAuth scopes, so that I can grant narrow access.

  I: inferred from the existence of `/openapi/v1/*` — basis: a coherent group of operations serves exactly this outcome and nothing else [D: api/controllers/].

**F-006-US5** — As a API consumer or end user, I want to expose an application as an MCP server, so that I can use it from an MCP client.

  I: inferred from the existence of `/mcp/server/<server_code>/mcp` — basis: a coherent group of operations serves exactly this outcome and nothing else [D: api/controllers/].

**F-006-US6** — As a API consumer or end user, I want to browse and try applications in Explore, so that I can discover what exists.

  I: inferred from the existence of installed-app and trial-app endpoints — basis: a coherent group of operations serves exactly this outcome and nothing else [D: api/controllers/].

OPEN: is this the list of things users actually do, or only the list the API makes possible? The two differ, and only usage data settles it.

## Acceptance criteria

Criteria are lifted from test names where a test states a contract in words — a test named "refuses X" is a Given/When/Then, and it is evidence the behaviour is wanted rather than merely present.

- `test_accepts_rejects_invalid_query_with_422` [D: api/tests/unit_tests/controllers/openapi/test_contract.py:71]
- `test_app_api_disabled_raises_forbidden` [D: api/tests/unit_tests/controllers/service_api/test_wraps.py:281]
- `test_app_not_found_raises_forbidden` [D: api/tests/unit_tests/controllers/service_api/test_wraps.py:228]
- `test_app_run_request_rejects_invalid_uuid_conversation_id` [D: api/tests/unit_tests/controllers/openapi/test_app_run_dispatch.py:20]
- `test_app_site_api_maps_unavailable_runtime_to_forbidden` [D: api/tests/unit_tests/controllers/web/test_site.py:73]
- `test_app_status_abnormal_raises_forbidden` [D: api/tests/unit_tests/controllers/service_api/test_wraps.py:253]
- `test_approve_and_deny_methods` [D: api/tests/unit_tests/controllers/openapi/test_device_approve_deny.py:48]
- `test_apps_describe_fields_info_only` [D: api/tests/integration_tests/controllers/openapi/test_apps.py:67]
- `test_apps_describe_fields_input_schema_only` [D: api/tests/integration_tests/controllers/openapi/test_apps.py:99]
- `test_apps_describe_fields_parameters_only` [D: api/tests/integration_tests/controllers/openapi/test_apps.py:83]

OPEN: no story above has acceptance criteria covering its happy path in these terms. The suite tests behaviour; it does not restate requirements.

## Implementation status

| story | Status | Evidence |
| --- | --- | --- |
| F-006-US1 | todo | — |
| F-006-US2 | todo | — |
| F-006-US3 | todo | — |
| F-006-US4 | todo | — |
| F-006-US5 | todo | — |
| F-006-US6 | todo | — |

No story may read `done` without the test command and its result in the note [D: docs/Dify-Specs/status-model.md].

## Scope boundaries

OPEN: what was deliberately left out of this feature, and why? A working tree records what exists and keeps no record of what was declined.

## Dependencies

- F-001, F-002, F-003 — published surfaces invoke the same generation core [D: api/controllers/service_api/app/completion.py]

OPEN: which external systems is this feature contractually dependent on, as opposed to merely able to use?

## Metrics

OPEN: how is success measured for this feature? No metric, target or SLO appears anywhere in the repository. Telemetry is collected [D: api/tasks/enterprise_telemetry_task.py:19] but what it is read for is not stated.

