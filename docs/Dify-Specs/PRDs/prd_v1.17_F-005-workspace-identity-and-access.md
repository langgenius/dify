---
title: PRD v1.17 F-005 — Workspace, Identity and Access
id: F-005
status: draft
owner: TBD
updated: 2026-09-20
---

# PRD v1.17 F-005 — Workspace, Identity and Access

> **Reconstructed, and the weakest document in this hub.** A requirement states intent, and intent is not in a repository. Every story below is inferred from a group of endpoints and test names — evidence that the behaviour exists, never evidence that it was wanted, and never evidence of what it was wanted *for*.

## Summary

232 operations serve this feature [D: api/controllers/]. What they let a user accomplish is summarised by the stories below.

OPEN: what problem does this feature solve, for whom, and what changed for them when it shipped? Not recoverable.

## User stories

**F-005-US1** — As a workspace owner or member, I want to invite members to a workspace and set their roles, so that I can let a team work together.

  I: inferred from the existence of member endpoints — basis: a coherent group of operations serves exactly this outcome and nothing else [D: api/controllers/].

**F-005-US2** — As a workspace owner or member, I want to grant permissions through RBAC rather than per resource, so that I can manage access at scale.

  I: inferred from the existence of `/console/api/workspaces/current/rbac/*` — basis: a coherent group of operations serves exactly this outcome and nothing else [D: api/controllers/].

**F-005-US3** — As a workspace owner or member, I want to configure model providers and credentials for the workspace, so that I can use my own model accounts.

  I: inferred from the existence of model-provider endpoints — basis: a coherent group of operations serves exactly this outcome and nothing else [D: api/controllers/].

**F-005-US4** — As a workspace owner or member, I want to install, configure and auto-upgrade plugins, so that I can extend the product.

  I: inferred from the existence of plugin endpoints — basis: a coherent group of operations serves exactly this outcome and nothing else [D: api/controllers/].

**F-005-US5** — As a workspace owner or member, I want to connect tool providers, including MCP servers, so that I can give applications capabilities.

  I: inferred from the existence of tool-provider endpoints — basis: a coherent group of operations serves exactly this outcome and nothing else [D: api/controllers/].

**F-005-US6** — As a workspace owner or member, I want to sign in by password, email code or OAuth, so that I can get into the product.

  I: inferred from the existence of auth endpoints — basis: a coherent group of operations serves exactly this outcome and nothing else [D: api/controllers/].

**F-005-US7** — As a workspace owner or member, I want to manage workspace skills and their versions, so that I can share reusable skills.

  I: inferred from the existence of `/console/api/workspaces/current/skills` — basis: a coherent group of operations serves exactly this outcome and nothing else [D: api/controllers/].

OPEN: is this the list of things users actually do, or only the list the API makes possible? The two differ, and only usage data settles it.

## Acceptance criteria

Criteria are lifted from test names where a test states a contract in words — a test named "refuses X" is a Given/When/Then, and it is evidence the behaviour is wanted rather than merely present.

- `test_404s_when_the_app_cannot_be_served` [D: api/tests/unit_tests/controllers/openapi/auth/test_loaders.py:74]
- `test__to_model_settings_only_one_lb` [D: api/tests/unit_tests/core/test_provider_manager.py:403]
- `test_a_caller_that_cannot_be_resolved_leaves_the_auth_ctx_unset` [D: api/tests/unit_tests/controllers/openapi/auth/test_pipelines.py:153]
- `test_a_refused_sso_request_never_creates_an_end_user` [D: api/tests/unit_tests/controllers/openapi/auth/test_pipelines.py:208]
- `test_a_row_matches_its_subject_only_when_its_account_binding_agrees` [D: api/tests/unit_tests/libs/test_oauth_bearer.py:26]
- `test_access_policy_create_rejects_unknown_resource_type` [D: api/tests/unit_tests/controllers/console/workspace/test_rbac.py:203]
- `test_access_policy_create_requires_workspace_role_manage` [D: api/tests/unit_tests/controllers/console/workspace/test_rbac.py:434]
- `test_account_repository_activates_only_pending_account` [D: api/tests/unit_tests/repositories/test_account_repository.py:225]
- `test_activate_rejects_rate_limited_request` [D: api/tests/unit_tests/services/test_account_education_service.py:164]
- `test_activates_anonymous_invitation_and_invalidates_new_membership_cache` [D: api/tests/unit_tests/services/test_account_activation_service.py:188]

OPEN: no story above has acceptance criteria covering its happy path in these terms. The suite tests behaviour; it does not restate requirements.

## Implementation status

| story | Status | Evidence |
| --- | --- | --- |
| F-005-US1 | todo | — |
| F-005-US2 | todo | — |
| F-005-US3 | todo | — |
| F-005-US4 | todo | — |
| F-005-US5 | todo | — |
| F-005-US6 | todo | — |
| F-005-US7 | todo | — |

No story may read `done` without the test command and its result in the note [D: docs/Dify-Specs/status-model.md].

## Scope boundaries

OPEN: what was deliberately left out of this feature, and why? A working tree records what exists and keeps no record of what was declined.

## Dependencies

- None within this hub.

OPEN: which external systems is this feature contractually dependent on, as opposed to merely able to use?

## Metrics

OPEN: how is success measured for this feature? No metric, target or SLO appears anywhere in the repository. Telemetry is collected [D: api/tasks/enterprise_telemetry_task.py:19] but what it is read for is not stated.

