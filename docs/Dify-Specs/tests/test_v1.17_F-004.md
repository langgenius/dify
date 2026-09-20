---
title: Test Plan v1.17 F-004 — Agent
id: F-004
status: draft
owner: TBD
updated: 2026-09-20
---

# Test Plan v1.17 F-004 — Agent

> **This is an as-built record.** It describes the suite that exists, not a suite to be written. Its purpose is the coverage holes listed below.

## Scope and command

2327 test cases across 202 files carry this feature's subject matter [D: survey of test function and `describe`/`it` names].

The project's own command is `make test` [D: Makefile:104], which runs `uv run --project api --dev pytest` in two passes — everything except `api/tests/unit_tests/controllers`, then the controllers [D: Makefile:106].

Docker-backed integration suites are CI-owned and are not expected to run locally [D: api/AGENTS.md:14].

## Test files

| File | Cases |
| --- | --- |
| `api/tests/unit_tests/services/agent/test_agent_services.py` | 145 |
| `dify-agent/tests/local/dify_agent/runtime/test_runner.py` | 53 |
| `api/tests/unit_tests/controllers/console/agent/test_agent_controllers.py` | 49 |
| `api/tests/unit_tests/core/workflow/nodes/agent_v2/test_runtime_request_builder.py` | 46 |
| `dify-agent/tests/local/dify_agent/server/test_settings.py` | 42 |
| `api/tests/unit_tests/services/agent/test_roster_package_service.py` | 41 |
| `dify-agent/tests/local/dify_agent/client/test_client.py` | 40 |
| `api/tests/unit_tests/core/app/apps/agent_app/test_app_runner.py` | 37 |
| `dify-agent/tests/local/dify_agent/layers/shell/test_layer.py` | 34 |
| `api/tests/unit_tests/core/agent/test_cot_agent_runner.py` | 31 |
| `api/tests/unit_tests/core/workflow/nodes/agent_v2/test_dify_tools_builder.py` | 31 |
| `api/tests/unit_tests/core/workflow/nodes/agent_v2/test_validators.py` | 31 |
| `dify-agent-runtime/tests/acceptance_test.go` | 30 |
| `api/tests/unit_tests/core/workflow/nodes/agent_v2/test_agent_node.py` | 30 |
| `api/tests/unit_tests/services/agent/test_agent_observability_service.py` | 29 |

…187 more files.


Enumerating all 24,695 cases in the repository into this hub would duplicate the suite without adding information; the suite is the record and this document points at it.

## Representative cases

Cases whose names state a contract rather than an implementation detail:

- `TestApplySchemaMigrationFailureRollsBackDDLAndVersion` [D: dify-agent-runtime/internal/server/db_test.go:145]
- `TestConfigFilesPullReturnsAllFailuresInInputOrderAfterLaterFailureCompletesFirst` [D: dify-agent-runtime/internal/agentcli/config_test.go:468]
- `TestConfigPullMultiItemFailuresIdentifyItemAndStage` [D: dify-agent-runtime/internal/agentcli/config_test.go:554]
- `TestConfigPushFinalFailureIdentifiesOperationAndExplainsExpiry` [D: dify-agent-runtime/internal/agentcli/config_test.go:790]
- `TestConfigPushMultiItemUploadFailuresIdentifyItemAndStage` [D: dify-agent-runtime/internal/agentcli/config_test.go:695]
- `TestInitSchemaRejectsNewerDatabaseWithoutDDL` [D: dify-agent-runtime/internal/server/db_test.go:126]
- `TestLandlockCannotReadOtherAgentHome` [D: dify-agent-runtime/tests/acceptance_test.go:725]
- `TestLandlockCannotWriteOutsideHome` [D: dify-agent-runtime/tests/acceptance_test.go:705]
- `TestRestoreReadOnlyDirectory` [D: dify-agent-runtime/internal/snapshot/restore_test.go:224]
- `TestRestoreRefusesSymlinkComponentEscape` [D: dify-agent-runtime/internal/snapshot/restore_test.go:115]
- `TestRestoreRejectsEscapes` [D: dify-agent-runtime/internal/snapshot/restore_test.go:78]
- `TestRestoreRejectsSparseEntries` [D: dify-agent-runtime/internal/snapshot/restore_test.go:169]
- `TestRunFileUploadPreservesReferenceWhenPublicURLRequestFails` [D: dify-agent-runtime/internal/agentcli/file_test.go:139]
- `TestRunFileUploadRejectsInvalidUploadResponseBeforeDownloadRequest` [D: dify-agent-runtime/internal/agentcli/file_test.go:301]
- `TestRunFileUploadRejectsMissingReferenceInBothModes` [D: dify-agent-runtime/internal/agentcli/file_test.go:282]

## Coverage holes

51 of 99 operations sit in a handler file that has a matching `test_<name>.py`; 48 do not [D: api/tests/].

I: a matching test file is a weak proxy for coverage — basis: it proves a test module exists for that handler module, never that a given endpoint or branch is exercised [D: api/tests/].

Handler modules in this feature with no matching test file:

- `api/controllers/console/agent/composer.py`
- `api/controllers/console/agent/roster.py`
- `api/controllers/console/app/agent_app_access.py`
- `api/controllers/console/app/agent_app_feature.py`
- `api/controllers/inner_api/agent/llm.py`
- `api/controllers/inner_api/agent/tools.py`

OPEN: what coverage level is required for this feature? `api-coverage` runs in CI [D: .github/workflows/api-tests.yml:154] but no threshold is stated in the repository.

## Traceability

No test in this repository names a `F-004-US<k>` story or a `DOM-*-R<k>` rule, so no automated link exists between a test and a requirement [D: api/tests/].

OPEN: should tests carry requirement IDs? Without them the status tables in the domain and PRD documents cannot be filled from a test run, and every row stays unverified.

## Implementation status

| Case group | Status | Evidence |
| --- | --- | --- |
| Agent suite | todo | — |
