---
title: Test Plan v1.17 F-006 — Published App Surfaces
id: F-006
status: draft
owner: TBD
updated: 2026-09-20
---

# Test Plan v1.17 F-006 — Published App Surfaces

> **This is an as-built record.** It describes the suite that exists, not a suite to be written. Its purpose is the coverage holes listed below.

## Scope and command

1213 test cases across 101 files carry this feature's subject matter [D: survey of test function and `describe`/`it` names].

The project's own command is `make test` [D: Makefile:104], which runs `uv run --project api --dev pytest` in two passes — everything except `api/tests/unit_tests/controllers`, then the controllers [D: Makefile:106].

Docker-backed integration suites are CI-owned and are not expected to run locally [D: api/AGENTS.md:14].

## Test files

| File | Cases |
| --- | --- |
| `api/tests/unit_tests/controllers/console/explore/test_trial.py` | 74 |
| `api/tests/unit_tests/core/datasource/test_website_crawl.py` | 70 |
| `api/tests/unit_tests/controllers/web/test_pydantic_models.py` | 67 |
| `api/tests/unit_tests/controllers/service_api/app/test_conversation.py` | 66 |
| `api/tests/unit_tests/controllers/service_api/app/test_completion.py` | 51 |
| `api/tests/unit_tests/controllers/service_api/app/test_message.py` | 51 |
| `api/tests/unit_tests/services/test_webhook_service.py` | 47 |
| `api/tests/unit_tests/services/test_website_service.py` | 45 |
| `api/tests/unit_tests/controllers/service_api/test_wraps.py` | 29 |
| `api/tests/unit_tests/controllers/service_api/app/test_annotation.py` | 26 |
| `api/tests/unit_tests/controllers/console/explore/test_completion.py` | 26 |
| `api/tests/unit_tests/controllers/console/explore/test_message.py` | 25 |
| `api/tests/unit_tests/controllers/service_api/app/test_file.py` | 25 |
| `api/tests/unit_tests/services/test_webhook_service_additional.py` | 24 |
| `api/tests/unit_tests/controllers/console/explore/test_audio.py` | 23 |

…86 more files.


Enumerating all 24,695 cases in the repository into this hub would duplicate the suite without adding information; the suite is the record and this document points at it.

## Representative cases

Cases whose names state a contract rather than an implementation detail:

- `test_404_outside_blueprint_prefix_is_not_claimed` [D: api/tests/unit_tests/controllers/openapi/test_error_contract.py:250]
- `test_accepts_422_carries_code_status_details` [D: api/tests/unit_tests/controllers/openapi/test_error_contract.py:200]
- `test_accepts_rejects_invalid_query_with_422` [D: api/tests/unit_tests/controllers/openapi/test_contract.py:71]
- `test_access_mode_failure_is_not_hidden` [D: api/tests/unit_tests/services/test_webapp_access_query_service.py:96]
- `test_app_api_disabled_raises_forbidden` [D: api/tests/unit_tests/controllers/service_api/test_wraps.py:281]
- `test_app_not_found_raises_forbidden` [D: api/tests/unit_tests/controllers/service_api/test_wraps.py:228]
- `test_app_run_request_rejects_invalid_uuid_conversation_id` [D: api/tests/unit_tests/controllers/openapi/test_app_run_dispatch.py:20]
- `test_app_site_api_maps_unavailable_runtime_to_forbidden` [D: api/tests/unit_tests/controllers/web/test_site.py:73]
- `test_app_status_abnormal_raises_forbidden` [D: api/tests/unit_tests/controllers/service_api/test_wraps.py:253]
- `test_approve_and_deny_methods` [D: api/tests/unit_tests/controllers/openapi/test_device_approve_deny.py:48]
- `test_apps_bare_id_route_404` [D: api/tests/integration_tests/controllers/openapi/test_apps.py:10]
- `test_apps_describe_fields_extra_param_returns_422` [D: api/tests/integration_tests/controllers/openapi/test_apps.py:143]
- `test_apps_describe_fields_info_only` [D: api/tests/integration_tests/controllers/openapi/test_apps.py:67]
- `test_apps_describe_fields_input_schema_only` [D: api/tests/integration_tests/controllers/openapi/test_apps.py:99]
- `test_apps_describe_fields_parameters_only` [D: api/tests/integration_tests/controllers/openapi/test_apps.py:83]

## Coverage holes

141 of 152 operations sit in a handler file that has a matching `test_<name>.py`; 11 do not [D: api/tests/].

I: a matching test file is a weak proxy for coverage — basis: it proves a test module exists for that handler module, never that a given endpoint or branch is exercised [D: api/tests/].

Handler modules in this feature with no matching test file:

- `api/controllers/openapi/apps_permitted_external.py`
- `api/controllers/openapi/oauth_device.py`
- `api/controllers/openapi/oauth_device_sso.py`

OPEN: what coverage level is required for this feature? `api-coverage` runs in CI [D: .github/workflows/api-tests.yml:154] but no threshold is stated in the repository.

## Traceability

No test in this repository names a `F-006-US<k>` story or a `DOM-*-R<k>` rule, so no automated link exists between a test and a requirement [D: api/tests/].

OPEN: should tests carry requirement IDs? Without them the status tables in the domain and PRD documents cannot be filled from a test run, and every row stays unverified.

## Implementation status

| Case group | Status | Evidence |
| --- | --- | --- |
| Published App Surfaces suite | todo | — |
