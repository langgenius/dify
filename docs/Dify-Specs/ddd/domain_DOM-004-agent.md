---
title: Domain — Agent
id: DOM-004
feature: F-004
kind: domain
status: draft
owner: TBD
updated: 2026-09-20
---

# Domain — Agent (DOM-004)

> Reconstructed from the code. Terms are the identifiers the code uses; rules are promoted from comments that state a rule, and each names the code that enforces it.

## Ubiquitous language

The enumerations the schema constrains are the domain's own vocabulary — every value below is a string the database will accept and no other.

| Term | Permitted values | Source |
| --- | --- | --- |
| `agent_config_drafts.draft_type` | draft, debug_build | `api/models/agent.py:283` |
| `agent_config_revisions.operation` | create_version, save_current_version, save_new_version, save_new_agent, save_to_roster, restore_version, publish_draft, import_package | `api/models/agent.py:363` |
| `agent_debug_conversations.draft_type` | draft, debug_build | `api/models/agent.py:248` |
| `agent_home_snapshots.status` | active, retired | `api/models/agent.py:218` |
| `agent_workspace_bindings.agent_config_version_kind` | snapshot, draft, build_draft | `api/models/agent.py:502` |
| `agent_workspace_bindings.status` | active, retired | `api/models/agent.py:502` |
| `agent_workspaces.owner_type` | workflow_run, conversation, build_draft | `api/models/agent.py:464` |
| `agent_workspaces.status` | active, retired | `api/models/agent.py:464` |
| `agents.icon_type` | image, emoji, link | `api/models/agent.py:140` |
| `agents.agent_kind` | dify_agent | `api/models/agent.py:140` |
| `agents.scope` | roster, workflow_only | `api/models/agent.py:140` |
| `agents.source` | roster, agent_app, workflow, imported, system | `api/models/agent.py:140` |
| `agents.status` | active, archived | `api/models/agent.py:140` |
| `skill_draft_files.kind` | file, directory | `api/models/skill.py:88` |
| `skill_draft_files.storage` | text, tool_file | `api/models/skill.py:88` |
| `workflow_agent_node_bindings.binding_type` | roster_agent, inline_agent | `api/models/agent.py:407` |

OPEN: several enum values carry no visible meaning beyond their spelling. What distinguishes them to a user?

## Actors

| Actor | Does | Evidence |
| --- | --- | --- |
| Agent author | composes and publishes an Agent | `api/controllers/console/agent/roster.py:620` |
| Agent runtime | executes the published configuration | `dify-agent-runtime/cmd/dify-agent-cli/main.go:23` |

OPEN: which of these are distinct personas to the business, and which are the same person in two modes? The code models permissions, not people.

## Business rules

Promoted from 24 rule-bearing comments in this feature's files. Each is `I:` — a comment is evidence that someone knew the rule, not proof the code still enforces it.

**DOM-004-R1** — I: Reject env entries that cannot be represented in `execve`. shellctl applies `env` as a process environment overlay, so validation follows the low-level `NAME=value` constraints instead of shell variable naming rules: names must be non-empty and cannot contain `=` or NUL, while values cannot contain — basis: stated in a comment at the enforcement site [D: dify-agent/src/shellctl/shared/schemas.py:157]

**DOM-004-R2** — I: Per-surface allowlists (design §2.4): the soul prompt may only reference soul-owned entities; the persisted workflow task prompt may only reference run-scoped ones. — basis: stated in a comment at the enforcement site [D: api/services/agent/prompt_mentions.py:82]

**DOM-004-R3** — I: Mint stable ids for CLI tools that predate the id field (ENG-616). `[§cli_tool:<id>§]` mentions resolve by id so renames never break references; the frontend mints ids for new entries, and save backfills legacy ones. Runs before validation so duplicate-id checks see the final state. Save-only — the — basis: stated in a comment at the enforcement site [D: api/services/agent/composer_service.py:86]

**DOM-004-R4** — I: Raised when Dify product/workflow state cannot be mapped to a run request. — basis: stated in a comment at the enforcement site [D: api/clients/agent_backend/errors.py:50]

**DOM-004-R5** — I: Reject stale snapshots before they reach the Agent backend. Draft rows are updated in place, so their IDs cannot prove that a retained snapshot still belongs to the current composition. Agenton requires the ordered layer names to match exactly; enforce the same invariant at the API boundary and retu — basis: stated in a comment at the enforcement site [D: api/core/app/apps/agent_app/runtime_request_builder.py:250]

**DOM-004-R6** — I: Raised when Agent App state cannot be mapped to a valid run request. — basis: stated in a comment at the enforcement site [D: api/core/app/apps/agent_app/runtime_request_builder.py:66]

**DOM-004-R7** — I: Raised when workflow state cannot be mapped to a valid Agent backend run request. — basis: stated in a comment at the enforcement site [D: api/core/workflow/nodes/agent_v2/runtime_request_builder.py:110]

**DOM-004-R8** — I: The dify-agent runtime payload only consumes the nested vector/keyword settings; ``weight_type`` is an API-side authoring detail and must not leak into the inner request shape. — basis: stated in a comment at the enforcement site [D: api/core/workflow/nodes/agent_v2/runtime_request_builder.py:770]

**DOM-004-R9** — I: Reserved for a future user-rename UX. Accepted but currently rejected at validation time so frontend cannot silently believe a rename took effect (see :meth:`_validate_provider_and_credentials`). — basis: stated in a comment at the enforcement site [D: api/models/agent_config_entities.py:678]

**DOM-004-R10** — I: Per-item shape for an ``array``-typed declared output. PRD §OUTPUT 配置框 keeps arrays one level deep on first version; nested arrays are rejected so the runtime type checker and JSON Schema stay easy to reason about. Stage 4 §4.2. — basis: stated in a comment at the enforcement site [D: api/models/agent_config_entities.py:826]

…14 further rule-bearing comments are quoted in `architect/feature_v1.17_F-004_architect.md` and the survey.

OPEN: every rule above states *what*; none states *why*. Which are regulatory, which are product decisions, and which are workarounds?

## Process flow

Recoverable only as call sequence, not as a business process. See `architect/feature_v1.17_F-004_architect.md` and the endpoint table in `data/api-contract_v1.17_F-004.md`.

OPEN: what is the intended happy path from a user's point of view? A route table gives the operations, never the order a person performs them in.

## Invariants

Enforced by the database for this feature: 123 not-null columns and 13 cross-column uniqueness constraints [D: api/models/].

- `agent_config_drafts` is unique on (`tenant_id`, `agent_id`, `draft_type`, `draft_owner_key`) [D: api/models/agent.py:283]
- `agent_config_revisions` is unique on (`agent_id`, `revision`) [D: api/models/agent.py:363]
- `agent_config_snapshots` is unique on (`agent_id`, `version`) [D: api/models/agent.py:327]
- `agent_debug_conversations` is unique on (`tenant_id`, `agent_id`, `account_id`, `draft_type`) [D: api/models/agent.py:248]
- `agent_skill_binding_snapshots` is unique on (`tenant_id`, `agent_id`, `config_snapshot_id`, `skill_id`) [D: api/models/skill.py:158]
- `agent_skill_binding_snapshots` is unique on (`tenant_id`, `agent_id`, `config_snapshot_id`, `priority`) [D: api/models/skill.py:158]
- `agent_skill_bindings` is unique on (`tenant_id`, `agent_id`, `skill_id`) [D: api/models/skill.py:135]
- `agent_skill_bindings` is unique on (`tenant_id`, `agent_id`, `priority`) [D: api/models/skill.py:135]
- `agents` is unique on (`tenant_id`, `roster_unique_name`) [D: api/models/agent.py:140]
- `skill_draft_files` is unique on (`skill_id`, `path`) [D: api/models/skill.py:88]
- `skill_versions` is unique on (`skill_id`, `version_number`) [D: api/models/skill.py:109]
- `skills` is unique on (`tenant_id`, `name`) [D: api/models/skill.py:56]
- `workflow_agent_node_bindings` is unique on (`tenant_id`, `workflow_id`, `workflow_version`, `node_id`) [D: api/models/agent.py:407]

I: referential invariants between these tables are enforced in service code, not by the database — basis: only 8 `ForeignKey()` declarations exist across all 143 tables [D: api/models/].

OPEN: which invariants does the business require that nothing in the code checks? Those are the ones a bad migration or a direct database write would break silently.

## Implementation status

One row per rule above. States and what `done` costs: `status-model.md`.

| Rule | Status | Evidence |
| --- | --- | --- |
| DOM-004-R1 | todo | — |
| DOM-004-R2 | todo | — |
| DOM-004-R3 | todo | — |
| DOM-004-R4 | todo | — |
| DOM-004-R5 | todo | — |
| DOM-004-R6 | todo | — |
| DOM-004-R7 | todo | — |
| DOM-004-R8 | todo | — |
| DOM-004-R9 | todo | — |
| DOM-004-R10 | todo | — |

## Open questions

- OPEN: is this feature boundary the one the team recognises? It was drawn from handler directories and table ownership, not from anyone's statement of the domain.
- OPEN: no rule in this document is named by any test. Which of them are actually verified, and which only exist as prose next to the code?
- OPEN: what is the source of truth when a comment and the code beside it disagree?
