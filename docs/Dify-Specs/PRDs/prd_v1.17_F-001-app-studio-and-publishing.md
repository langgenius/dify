---
title: PRD v1.17 F-001 — App Studio and Publishing
id: F-001
status: draft
owner: TBD
updated: 2026-09-20
---

# PRD v1.17 F-001 — App Studio and Publishing

> **Reconstructed, and the weakest document in this hub.** A requirement states intent, and intent is not in a repository. Every story below is inferred from a group of endpoints and test names — evidence that the behaviour exists, never evidence that it was wanted, and never evidence of what it was wanted *for*.

## Summary

112 operations serve this feature [D: api/controllers/]. What they let a user accomplish is summarised by the stories below.

OPEN: what problem does this feature solve, for whom, and what changed for them when it shipped? Not recoverable.

## User stories

**F-001-US1** — As a workspace member, I want to create and configure an application, so that I can choose a mode and a model configuration.

  I: inferred from the existence of `/console/api/apps`, `/console/api/apps/<app_id>/model-config` — basis: a coherent group of operations serves exactly this outcome and nothing else [D: api/controllers/].

**F-001-US2** — As a workspace member, I want to publish an application as a web site or an API, so that I can make it reachable by others.

  I: inferred from the existence of `/console/api/apps/<app_id>/site-enable`, `/console/api/apps/<app_id>/api-enable` — basis: a coherent group of operations serves exactly this outcome and nothing else [D: api/controllers/].

**F-001-US3** — As a workspace member, I want to import and export an application definition, so that I can move it between workspaces or instances.

  I: inferred from the existence of `/console/api/apps/<app_id>/export`, app import — basis: a coherent group of operations serves exactly this outcome and nothing else [D: api/controllers/].

**F-001-US4** — As a workspace member, I want to review conversations and messages an application produced, so that I can see what users asked and got.

  I: inferred from the existence of `/console/api/apps/<app_id>/chat-conversations`, `/console/api/apps/<app_id>/messages` — basis: a coherent group of operations serves exactly this outcome and nothing else [D: api/controllers/].

**F-001-US5** — As a workspace member, I want to annotate an answer so the application reuses it, so that I can correct a wrong reply once.

  I: inferred from the existence of `/console/api/apps/<app_id>/annotations` — basis: a coherent group of operations serves exactly this outcome and nothing else [D: api/controllers/].

**F-001-US6** — As a workspace member, I want to see usage statistics for an application, so that I can know whether it is used.

  I: inferred from the existence of `/console/api/apps/<app_id>/statistics/*` — basis: a coherent group of operations serves exactly this outcome and nothing else [D: api/controllers/].

OPEN: is this the list of things users actually do, or only the list the API makes possible? The two differ, and only usage data settles it.

## Acceptance criteria

Criteria are lifted from test names where a test states a contract in words — a test named "refuses X" is a Given/When/Then, and it is evidence the behaviour is wanted rather than merely present.

- `keeps invalid json error bodies as API errors` [D: sdks/nodejs-client/src/http/client.test.ts:426]
- `rejects legacy form-data objects that are not readable streams` [D: sdks/nodejs-client/src/http/client.test.ts:190]
- `requires name when autoGenerate is false` [D: sdks/nodejs-client/src/client/chat.test.ts:159]
- `test_2060_mb_estimate_rejects_sandbox_but_allows_pro` [D: api/tests/unit_tests/services/test_vector_space_admission_service.py:540]
- `test_4_fixed_api_layer_rejects_null` [D: api/tests/unit_tests/services/test_metadata_bug_complete.py:80]
- `test_account_owner_must_belong_to_the_signed_tenant` [D: api/tests/unit_tests/repositories/test_plugin_file_upload_repository.py:29]
- `test_add_document_to_index_invalid_indexing_status` [D: api/tests/test_containers_integration_tests/tasks/test_add_document_to_index_task.py:282]
- `test_admission_is_cloud_only` [D: api/tests/unit_tests/services/test_vector_space_admission_service.py:242]
- `test_advanced_invalid_model_mode` [D: api/tests/unit_tests/core/app/app_config/easy_ui_based_app/test_prompt_template_manager.py:237]
- `test_advanced_requires_one_config` [D: api/tests/unit_tests/core/app/app_config/easy_ui_based_app/test_prompt_template_manager.py:224]

OPEN: no story above has acceptance criteria covering its happy path in these terms. The suite tests behaviour; it does not restate requirements.

## Implementation status

| story | Status | Evidence |
| --- | --- | --- |
| F-001-US1 | todo | — |
| F-001-US2 | todo | — |
| F-001-US3 | todo | — |
| F-001-US4 | todo | — |
| F-001-US5 | todo | — |
| F-001-US6 | todo | — |

No story may read `done` without the test command and its result in the note [D: docs/Dify-Specs/status-model.md].

## Scope boundaries

OPEN: what was deliberately left out of this feature, and why? A working tree records what exists and keeps no record of what was declined.

## Dependencies

- F-005 — every operation is tenant-scoped and RBAC-guarded [D: api/controllers/console/wraps.py]

OPEN: which external systems is this feature contractually dependent on, as opposed to merely able to use?

## Metrics

OPEN: how is success measured for this feature? No metric, target or SLO appears anywhere in the repository. Telemetry is collected [D: api/tasks/enterprise_telemetry_task.py:19] but what it is read for is not stated.

