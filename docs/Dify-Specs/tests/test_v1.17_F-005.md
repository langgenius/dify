---
title: Test Plan v1.17 F-005 — Workspace, Identity and Access
id: F-005
status: draft
owner: TBD
updated: 2026-09-20
---

# Test Plan v1.17 F-005 — Workspace, Identity and Access

> **This is an as-built record.** It describes the suite that exists, not a suite to be written. Its purpose is the coverage holes listed below.

## Scope and command

3137 test cases across 250 files carry this feature's subject matter [D: survey of test function and `describe`/`it` names].

The project's own command is `make test` [D: Makefile:104], which runs `uv run --project api --dev pytest` in two passes — everything except `api/tests/unit_tests/controllers`, then the controllers [D: Makefile:106].

Docker-backed integration suites are CI-owned and are not expected to run locally [D: api/AGENTS.md:14].

## Test files

| File | Cases |
| --- | --- |
| `api/tests/unit_tests/services/test_account_service.py` | 105 |
| `api/tests/unit_tests/services/test_billing_service.py` | 98 |
| `api/providers/trace/trace-mlflow/tests/unit_tests/mlflow_trace/test_mlflow_trace.py` | 81 |
| `api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py` | 76 |
| `api/providers/trace/trace-weave/tests/unit_tests/weave_trace/test_weave_trace.py` | 72 |
| `api/tests/test_containers_integration_tests/services/test_account_service.py` | 71 |
| `api/tests/unit_tests/services/test_datasource_provider_service.py` | 66 |
| `api/tests/unit_tests/services/enterprise/test_rbac_service.py` | 65 |
| `api/tests/unit_tests/controllers/console/workspace/test_plugin.py` | 60 |
| `api/tests/unit_tests/controllers/console/workspace/test_skills.py` | 53 |
| `api/tests/unit_tests/core/mcp/auth/test_auth_flow.py` | 49 |
| `api/tests/unit_tests/models/test_account_models.py` | 46 |
| `api/tests/unit_tests/core/entities/test_entities_provider_configuration.py` | 45 |
| `api/tests/unit_tests/models/test_provider_models.py` | 45 |
| `api/tests/unit_tests/core/datasource/test_notion_provider.py` | 44 |

…235 more files.


Enumerating all 24,695 cases in the repository into this hub would duplicate the suite without adding information; the suite is the record and this document points at it.

## Representative cases

Cases whose names state a contract rather than an implementation detail:

- `test_404s_a_caller_that_is_not_an_account` [D: api/tests/unit_tests/controllers/openapi/auth/test_loaders.py:172]
- `test_404s_when_the_app_cannot_be_served` [D: api/tests/unit_tests/controllers/openapi/auth/test_loaders.py:74]
- `test__to_model_settings_only_one_lb` [D: api/tests/unit_tests/core/test_provider_manager.py:403]
- `test_a_caller_that_cannot_be_resolved_leaves_the_auth_ctx_unset` [D: api/tests/unit_tests/controllers/openapi/auth/test_pipelines.py:153]
- `test_a_dead_licence_403s_an_unauthenticated_caller_on_every_route_in_enterprise` [D: api/tests/unit_tests/controllers/openapi/auth/test_router.py:85]
- `test_a_refused_sso_request_never_creates_an_end_user` [D: api/tests/unit_tests/controllers/openapi/auth/test_pipelines.py:208]
- `test_a_row_matches_its_subject_only_when_its_account_binding_agrees` [D: api/tests/unit_tests/libs/test_oauth_bearer.py:26]
- `test_access_policy_create_rejects_unknown_resource_type` [D: api/tests/unit_tests/controllers/console/workspace/test_rbac.py:203]
- `test_account_claim_lock_releases_partial_acquisition_on_failure` [D: api/tests/unit_tests/services/test_account_oauth_adapters.py:183]
- `test_account_repository_activates_only_pending_account` [D: api/tests/unit_tests/repositories/test_account_repository.py:225]
- `test_account_repository_fails_closed_for_duplicate_email` [D: api/tests/unit_tests/repositories/test_account_repository.py:244]
- `test_activate_rejects_rate_limited_request` [D: api/tests/unit_tests/services/test_account_education_service.py:164]
- `test_add_texts_converts_only_true_summary_marker` [D: api/providers/vdb/vdb-tencent/tests/unit_tests/test_tencent_vector.py:284]
- `test_add_texts_inserts_and_logs_on_failures` [D: api/providers/vdb/vdb-oracle/tests/unit_tests/test_oraclevector.py:178]
- `test_add_texts_inserts_only_documents_with_metadata` [D: api/providers/vdb/vdb-analyticdb/tests/unit_tests/test_analyticdb_vector_sql.py:122]

## Coverage holes

230 of 232 operations sit in a handler file that has a matching `test_<name>.py`; 2 do not [D: api/tests/].

I: a matching test file is a weak proxy for coverage — basis: it proves a test module exists for that handler module, never that a given endpoint or branch is exercised [D: api/tests/].

Handler modules in this feature with no matching test file:

- `api/controllers/console/auth/activate.py`

OPEN: what coverage level is required for this feature? `api-coverage` runs in CI [D: .github/workflows/api-tests.yml:154] but no threshold is stated in the repository.

## Traceability

No test in this repository names a `F-005-US<k>` story or a `DOM-*-R<k>` rule, so no automated link exists between a test and a requirement [D: api/tests/].

OPEN: should tests carry requirement IDs? Without them the status tables in the domain and PRD documents cannot be filled from a test run, and every row stays unverified.

## Implementation status

| Case group | Status | Evidence |
| --- | --- | --- |
| Workspace, Identity and Access suite | todo | — |
