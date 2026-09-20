---
title: Feature Architecture v1.17 F-004 — Agent
id: F-004
status: draft
owner: TBD
updated: 2026-09-20
---

# Feature Architecture v1.17 F-004 — Agent

> As-built. Read with `architect.md` for system context and `architect_common.md` for the enforced layer rules.

## Design approach

I: an Agent is a configuration artefact with its own draft/publish lifecycle, executed by a separate runtime rather than in the API process — basis: `agents` is versioned through `agent_config_drafts`, `agent_config_revisions` and `agent_config_snapshots`, and the API reaches the executor through an HTTP client package [D: api/models/agent.py; api/clients/agent_backend/].

OPEN: why this shape and not another? The code retains no record of what was rejected, and this section states only what the code does.

## Surface

99 operations over 87 paths, on `console` (89), `inner_api` (10) [D: api/controllers/].

Busiest handler modules:

| Module | Operations |
| --- | --- |
| `api/controllers/console/app/agent_config_inspector.py` | 28 |
| `api/controllers/console/agent/roster.py` | 26 |
| `api/controllers/console/agent/composer.py` | 18 |
| `api/controllers/console/app/agent_app_sandbox.py` | 7 |
| `api/controllers/inner_api/plugin/agent_config.py` | 6 |
| `api/controllers/console/app/message.py` | 4 |
| `api/controllers/console/app/completion.py` | 3 |
| `api/controllers/inner_api/agent/files.py` | 2 |

Full table in `data/api-contract_v1.17_F-004.md`.

## Components and call direction

Controllers in this feature import these application and domain modules [D: api/controllers/]:

| Module | Imported by N handler files |
| --- | --- |
| `services.agent.composer_service` | 3 |
| `services.agent.errors` | 2 |
| `services.agent.roster_service` | 2 |
| `services.entities.agent_entities` | 2 |
| `services.agent_config_service` | 2 |
| `core.agent.publish_visibility` | 1 |
| `services.agent.observability_service` | 1 |
| `services.app_service` | 1 |
| `services.enterprise` | 1 |
| `services.enterprise.enterprise_service` | 1 |

The direction is one-way: `controllers -> services -> core -> libs`, enforced by import-linter [D: api/.importlinter:21].

## Stores

14 owned tables; field detail in `data/data-erd_v1.17_F-004.md`:

`agent_config_drafts`, `agent_config_revisions`, `agent_config_snapshots`, `agent_debug_conversations`, `agent_home_snapshots`, `agent_skill_binding_snapshots`, `agent_skill_bindings`, `agent_workspace_bindings`, `agent_workspaces`, `agents`, `skill_draft_files`, `skill_versions`, `skills`, `workflow_agent_node_bindings`

## Stated constraints in this feature

24 rule-bearing comments sit in this feature's files. Each is a quote, not a paraphrase; the domain document promotes the ones the code enforces.

- > "Reject env entries that cannot be represented in `execve`. shellctl applies `env` as a process environment overlay, so validation follows the low-level `NAME=value` constraints instead of shell variable naming rules: names must be non-empty and cannot contain `=` or NUL, while values cannot contain" [D: dify-agent/src/shellctl/shared/schemas.py:157]
- > "Per-surface allowlists (design §2.4): the soul prompt may only reference soul-owned entities; the persisted workflow task prompt may only reference run-scoped ones." [D: api/services/agent/prompt_mentions.py:82]
- > "Mint stable ids for CLI tools that predate the id field (ENG-616). `[§cli_tool:<id>§]` mentions resolve by id so renames never break references; the frontend mints ids for new entries, and save backfills legacy ones. Runs before validation so duplicate-id checks see the final state. Save-only — the" [D: api/services/agent/composer_service.py:86]
- > "Raised when Dify product/workflow state cannot be mapped to a run request." [D: api/clients/agent_backend/errors.py:50]
- > "Reject stale snapshots before they reach the Agent backend. Draft rows are updated in place, so their IDs cannot prove that a retained snapshot still belongs to the current composition. Agenton requires the ordered layer names to match exactly; enforce the same invariant at the API boundary and retu" [D: api/core/app/apps/agent_app/runtime_request_builder.py:250]
- > "Raised when Agent App state cannot be mapped to a valid run request." [D: api/core/app/apps/agent_app/runtime_request_builder.py:66]
- > "Raised when workflow state cannot be mapped to a valid Agent backend run request." [D: api/core/workflow/nodes/agent_v2/runtime_request_builder.py:110]
- > "The dify-agent runtime payload only consumes the nested vector/keyword settings; ``weight_type`` is an API-side authoring detail and must not leak into the inner request shape." [D: api/core/workflow/nodes/agent_v2/runtime_request_builder.py:770]
- > "Reserved for a future user-rename UX. Accepted but currently rejected at validation time so frontend cannot silently believe a rename took effect (see :meth:`_validate_provider_and_credentials`)." [D: api/models/agent_config_entities.py:678]
- > "Per-item shape for an ``array``-typed declared output. PRD §OUTPUT 配置框 keeps arrays one level deep on first version; nested arrays are rejected so the runtime type checker and JSON Schema stay easy to reason about. Stage 4 §4.2." [D: api/models/agent_config_entities.py:826]
- > "ENG-617 §5.2 (PRD: human involvement must be slash-referenced or save errors). Every configured human contact must appear as ``{{#human:<id>#}}`` in the corresponding prompt. A contact matches via any identity alias; contacts carrying no identity at all cannot be referenced and are skipped." [D: api/services/agent/composer_validator.py:123]
- > "Return tenant-scoped dataset rows for normalized knowledge dataset ids. Knowledge ids come from user-editable config. Malformed ids can never match a dataset row, so they are treated as missing instead of breaking the UUID-typed dataset lookup." [D: api/services/agent/knowledge_datasets.py:32]

…and 12 more in the survey.


## Failure modes

Errors surface as typed exceptions rendered by the blueprint's handler; the guards in the contract table reject before the handler runs [D: api/controllers/].

OPEN: what should a caller do on each failure — retry, back off, or give up? The code raises and the client decides, and no document states the intended client behaviour.

## Observability

Shared for the whole backend: OpenTelemetry, Sentry and structured request logging are attached as extensions [D: api/extensions/ext_otel.py; api/extensions/ext_sentry.py; api/extensions/ext_request_logging.py].

OPEN: which signals in this feature are alerted on? No alert rule lives in this repository.

## Open questions

- OPEN: what are the latency and throughput targets for this feature? None is expressed anywhere.
- OPEN: which of the constraints quoted above are still true? A comment is evidence that someone knew the rule when they wrote it, not that the code beside it still enforces it.
- OPEN: rejected alternatives for this design. Not recoverable from a working tree.
