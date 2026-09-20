---
title: Test Plan v1.17 F-001 — App Studio and Publishing
id: F-001
status: draft
owner: TBD
updated: 2026-09-20
---

# Test Plan v1.17 F-001 — App Studio and Publishing

> **This is an as-built record.** It describes the suite that exists, not a suite to be written. Its purpose is the coverage holes listed below.

## Scope and command

8031 test cases across 654 files carry this feature's subject matter [D: survey of test function and `describe`/`it` names].

The project's own command is `make test` [D: Makefile:104], which runs `uv run --project api --dev pytest` in two passes — everything except `api/tests/unit_tests/controllers`, then the controllers [D: Makefile:106].

Docker-backed integration suites are CI-owned and are not expected to run locally [D: api/AGENTS.md:14].

## Test files

| File | Cases |
| --- | --- |
| `api/tests/unit_tests/enterprise/telemetry/test_enterprise_trace.py` | 126 |
| `api/tests/unit_tests/core/moderation/test_sensitive_word_filter.py` | 100 |
| `api/tests/unit_tests/core/mcp/client/test_streamable_http.py` | 97 |
| `api/tests/unit_tests/libs/broadcast_channel/redis/test_channel_unit_tests.py` | 92 |
| `api/tests/unit_tests/services/test_skill_management_service.py` | 90 |
| `api/tests/unit_tests/core/plugin/test_plugin_runtime.py` | 75 |
| `api/tests/unit_tests/core/moderation/test_content_moderation.py` | 73 |
| `api/tests/unit_tests/core/datasource/test_file_upload.py` | 65 |
| `api/tests/unit_tests/core/plugin/test_plugin_manager.py` | 63 |
| `api/tests/test_containers_integration_tests/services/test_app_dsl_service.py` | 61 |
| `api/tests/unit_tests/models/test_app_models.py` | 61 |
| `api/tests/unit_tests/tasks/test_mail_send_task.py` | 59 |
| `api/tests/unit_tests/services/enterprise/test_enterprise_service.py` | 56 |
| `api/tests/unit_tests/factories/test_variable_factory.py` | 56 |
| `api/tests/unit_tests/services/test_variable_truncator.py` | 52 |

…639 more files.


Enumerating all 24,695 cases in the repository into this hub would duplicate the suite without adding information; the suite is the record and this document points at it.

## Representative cases

Cases whose names state a contract rather than an implementation detail:

- `maps 401 and 429 errors` [D: sdks/nodejs-client/src/http/client.test.ts:296]
- `maps unknown transport failures to NetworkError` [D: sdks/nodejs-client/src/http/client.test.ts:348]
- `rejects legacy form-data objects that are not readable streams` [D: sdks/nodejs-client/src/http/client.test.ts:190]
- `returns APIError for other http failures` [D: sdks/nodejs-client/src/http/client.test.ts:398]
- `test_2060_mb_estimate_rejects_sandbox_but_allows_pro` [D: api/tests/unit_tests/services/test_vector_space_admission_service.py:540]
- `test_401_maps_to_identity_refresh_error` [D: api/tests/unit_tests/services/enterprise/test_enterprise_service.py:499]
- `test_403_maps_to_identity_refresh_error_for_license` [D: api/tests/unit_tests/services/enterprise/test_enterprise_service.py:513]
- `test_404_body_carries_no_route_suggestions` [D: api/tests/unit_tests/test_app_factory.py:345]
- `test_404_for_notification_no_error_sent` [D: api/tests/unit_tests/core/mcp/client/test_streamable_http.py:992]
- `test_404_on_initialization_includes_url_in_error` [D: api/tests/unit_tests/core/mcp/client/test_streamable_http.py:976]
- `test_404_sends_session_terminated_error_for_request` [D: api/tests/unit_tests/core/mcp/client/test_streamable_http.py:961]
- `test_4_fixed_api_layer_rejects_null` [D: api/tests/unit_tests/services/test_metadata_bug_complete.py:80]
- `test_account_owner_must_belong_to_the_signed_tenant` [D: api/tests/unit_tests/repositories/test_plugin_file_upload_repository.py:29]
- `test_acquire_propagates_distributed_lock_failure` [D: api/tests/unit_tests/services/test_setup_adapters.py:62]
- `test_admission_is_cloud_only` [D: api/tests/unit_tests/services/test_vector_space_admission_service.py:242]

## Coverage holes

90 of 112 operations sit in a handler file that has a matching `test_<name>.py`; 22 do not [D: api/tests/].

I: a matching test file is a weak proxy for coverage — basis: it proves a test module exists for that handler module, never that a given endpoint or branch is exercised [D: api/tests/].

Handler modules in this feature with no matching test file:

- `api/controllers/console/app/advanced_prompt_template.py`
- `api/controllers/console/app/app_import.py`
- `api/controllers/console/app/conversation_variables.py`
- `api/controllers/console/app/generator.py`
- `api/controllers/console/app/mcp_server.py`
- `api/controllers/console/app/model_config.py`
- `api/controllers/console/app/ops_trace.py`

OPEN: what coverage level is required for this feature? `api-coverage` runs in CI [D: .github/workflows/api-tests.yml:154] but no threshold is stated in the repository.

## Traceability

No test in this repository names a `F-001-US<k>` story or a `DOM-*-R<k>` rule, so no automated link exists between a test and a requirement [D: api/tests/].

OPEN: should tests carry requirement IDs? Without them the status tables in the domain and PRD documents cannot be filled from a test run, and every row stays unverified.

## Implementation status

| Case group | Status | Evidence |
| --- | --- | --- |
| App Studio and Publishing suite | todo | — |
