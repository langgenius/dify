# AgentV2 KnowledgeFS CLI implementation plan

## Objective and boundaries

Agents select KnowledgeFS spaces and autonomously compose read-only CLI operations. KnowledgeFS supplies evidence; the Agent's own model plans and answers. Both Agent App and Workflow AgentV2 use the same configuration and runtime contract. No knowledge writes, ingestion changes, user credential injection, implicit research-agent invocation, or changes to legacy workflow knowledge retrieval are included.

Implementation is local. Production deployment, commits/pushes, production migrations, and live model spending are not implied. Local tests must not be described as production verification. Backend Docker integration tests remain CI-owned.

## Invariants

- Persist Dify control-space references, stable binding IDs and aliases, not execution-space IDs or credentials.
- Agent composer owns configuration; dialogs own temporary edits; generated contracts own wire types.
- Each command is restricted by the immutable run configuration, current Dify authorization and a read-only command allowlist. Caller identity and namespace are never CLI-controlled.
- Preview cannot mutate published bindings. Workflow binding reconciliation includes all KnowledgeFS consumers; per-Agent runtime access is narrower than app-wide bindings.
- KnowledgeFS embedding/rerank settings own retrieval. The Agent model owns reasoning and vision consumption. No additional provider environment variables are introduced.
- Runtime cancellation, lease expiry, revocation, pagination, output limits and aggregate budgets are enforced outside the prompt.
- Citation and image handles come from authenticated evidence receipts, not arbitrary terminal output. Documents remain untrusted content.
- No silent dropping or reinterpretation of old dataset references; historical configuration is readable and unsupported new execution receives an actionable migration error.

## Iterations and acceptance gates

### I0 — Inventory, design and verification setup

- [x] Identify existing Agent composer, fixed knowledge layer, shell CLI, KnowledgeFS admission and filesystem owners.
- [x] Record this plan, implementation boundaries and cross-layer acceptance matrix.
- [x] Confirm runtime/Stub topology, run identity and lifecycle hooks; choose an existing durable/shared owner for command sessions and receipts.
- [x] Establish package test and schema-generation commands; preserve unrelated untracked files.

Gate: no security or lifecycle assumption is based solely on a prompt or a local in-memory registry in the wrong process.

### I1 — Configuration and authorized application access

- [x] Add validated KnowledgeFS binding configuration (stable ID, control-space ID, alias, description; bounded and unique).
- [x] Preserve historical config readability; reject mixed/unsupported legacy configuration explicitly on new publish/run.
- [x] Update composer validation, mentions/candidates, draft/snapshot transformations, DSL export/import/rebinding.
- [x] Validate author visibility at save/publish and enforce current read authorization on every execution.
- [x] Cover Agent App and Workflow caller contexts, preview isolation, app-wide binding union and per-Agent subsets.
- [x] Regenerate affected OpenAPI/TypeScript contracts from their authoritative schemas.

Gate: round-trip configuration tests and cross-tenant, unbound-space, revoked-binding, draft-vs-published tests pass; no ordinary Agent configuration is lost.

### I2 — Read-only KnowledgeFS command gateway

- [x] Implement typed command request/response schemas and a finite operation dispatch table (no generic HTTP proxy).
- [x] Implement spaces, search, filesystem ls/tree/find/grep/cat/stat/diff, citation node opening and capability discovery.
- [x] Search returns bounded evidence only; default retrieval does not run a second planning/answer loop.
- [x] Restrict filesystem roots/visibility and enforce consistent document access for metadata, snippets, text and assets.
- [x] Implement complete bounded envelopes, pagination, precise errors, aggregate command/output/time/concurrency budgets.
- [x] Add replay-safe command IDs, cancellation and trusted evidence receipts using the correct lifecycle owner.

Gate: real serialization/HTTP-boundary tests cover every command, invalid inputs, budget exhaustion, empty results, provider failures and permission changes.

### I3 — Agent runtime and sandbox CLI

- [x] Add KnowledgeFS runtime configuration/layer and wire both runtime builders/provider factories.
- [x] Extend Agent Stub with run-scoped knowledge access; never expose inner API credentials to the sandbox.
- [x] Add `dify-agent knowledge` commands to the preinstalled Go CLI with JSON output and generated help.
- [x] Inject only allowed spaces, capabilities and concise command guidance; no eager retrieval.
- [x] Preserve existing shell/file/config behavior; handle shell availability and CLI protocol mismatch explicitly.
- [x] Connect command cancellation, suspend/resume, cleanup, credential refresh and trace correlation.

Gate: CLI-to-Stub-to-gateway contract tests plus runtime composition, cancellation, resume and legacy shell regression tests pass.

### I4 — Evidence, multiple spaces and multimodal behavior

- [x] Register citation receipts with immutable document/parse provenance and bounded content.
- [x] Carry citations into Agent output/history/UI using existing event and answer rendering owners.
- [x] Support authorized image query handles and image evidence opening; capability-gate each space and the current Agent model.
- [x] Deliver image parts through a trusted runtime side channel, not stdout parsing or raw public URLs.
- [x] Bound image dimensions/bytes/count and explain text-only or image-only unsupported cases.
- [x] Keep cross-space identities/ranks distinct; do not compare incompatible raw embedding scores.
- [x] Revalidate recovered evidence on resume and reject stale/revoked references.

Gate: mixed vision/text spaces, non-vision Agent models, forged references, stale versions, revoked images and payload limits have regression coverage.

### I5 — Shared Agent configuration UI

- [x] Replace the legacy retrieval dialog with a KnowledgeFS-only selector and binding editor.
- [x] Show actual space names, descriptions, capability/unavailability state, multiple selections and actionable errors.
- [x] Update prompt mentions, dirty/save/build-draft/version flows and Workflow AgentV2 composition.
- [x] Keep search/query observers and selection drafts local; confirmed bindings stay in composer atoms.
- [x] Update all supported locales and generated-contract consumers.
- [x] Derive the entry from server configuration and require CLI/gateway readiness before model work. A static feature flag is not a live health probe.

Gate: DOM-observable select/cancel/reopen/save/remove/rename, sibling composer isolation and snapshot round-trip tests pass. Complete the component owner/props/reset audit below.

### I6 — Regression, packaging and handoff

- [x] Run focused and affected API, runtime, Go, KnowledgeFS and frontend suites.
- [x] Run affected lint/type/schema/help-generation consistency checks.
- [x] Verify no privileged values appear in CLI output, runtime snapshots or logs.
- [x] Check build/runtime image packaging, backward protocol errors and rollout ordering.
- [x] Record actual checks, remaining CI/live-environment gates and operator validation steps here.
- [x] Reconcile every checkbox with implemented behavior; do not mark unavailable live verification as passed.

Gate: all local implementation tasks are complete and verified, with external verification explicitly distinguished from local results.

## Frontend owner and state map

Root: shared Agent orchestrate knowledge section, consumed by Agent App configure and Workflow AgentV2. Stable boundaries: composer provider/store, generated console client, Dify UI primitives, prompt editor and existing save/version owners.

| Current owner | Target disposition | State/props contract and reset |
| --- | --- | --- |
| Knowledge section | Replace retrieval rows with space bindings | Reads composer binding atom; owns add/edit interaction identity only |
| Retrieval dialog and nested legacy dataset/model controls | Replace within Agent feature; leave legacy workflow controls untouched | Dialog content owns alias/description and temporary selection; close discards unconfirmed values |
| Composer knowledge module | Extend/transition to KnowledgeFS binding commands | One authoritative persisted draft; add/update/remove also maintain prompt reference labels |
| KnowledgeFS space picker query | Feature-owned query consumer | Generated query; query/permission states remain local; no query observer prop fan-out |
| Conversion and validation modules | Update wire mapping, historical configuration warnings | Pure transformations, no server state fabrication |
| Configure/Workflow providers | Keep | Existing semantic Agent/config identity resets draft; no second store |
| Prompt mentions and version/build-draft consumers | Update generated binding contract | Stable binding IDs survive renaming; unavailable references remain visible and actionable |

Graph: authenticated/config snapshot input → composer draft → binding selector and validation facts → add/update/remove commands → existing save/publish commands. Query-owned space metadata is not copied into a competing writable store. Dialog edits cross the boundary only through a confirmed binding command.

## Acceptance matrix

| Concern | Required coverage |
| --- | --- |
| Configuration | Empty, one/multiple spaces, duplicate IDs/aliases, rename, malformed IDs, old dataset config, export/import/rebind |
| Authorization | Foreign tenant, invisible space, unbound space, swapped alias/ID, wrong caller, revoked/deleted space, restricted document roots |
| Runtime modes | Agent App, Workflow AgentV2, inline/roster, draft/build-draft/published, suspend/resume, no shell, incompatible CLI |
| Autonomous reads | Browse-first and search-first command sequences; no automatic retrieval; evidence-only responses |
| Resource safety | Pagination, large UTF-8 output, image bounds, concurrent calls, retries, global budgets, cancel/lease expiry |
| Provenance | Genuine/forged/stale references, parse-version pinning, citation output, image receipt transport, no secret leakage |
| Multimodal | Text-only/multimodal/mixed spaces; text+image and image-only queries; Agent with/without vision |
| Regression | Other shell/config/file commands, ordinary no-knowledge Agents, existing KnowledgeFS workflow nodes and legacy retrieval consumers |

## Execution log

- 2026-09-07: Plan established. Workspace has only pre-existing untracked `.turbo/`, `artifacts/`, `tmp/`; these are outside scope.

## Implementation outcome — 2026-09-07

I0–I6 local implementation is complete. Shared leases, budgets and receipts live in Redis so the run server and a standalone Stub enforce the same state. No migration, commit, push, production deployment or live model run was performed.

| Iteration | Delivered |
| --- | --- |
| I0 | Ownership, runtime topology, authorization contracts and rollout dependencies |
| I1 | Typed knowledge spaces, author authorization, import/rebind, Agent publish grants and Workflow union |
| I2 | Private finite command gateway, current permissions, versioned results, cross-process leases and budgets |
| I3 | Installed CLI, shared Agent App/Workflow runtime composition, readiness, cancellation and resume |
| I4 | Per-space evidence retrieval, mixed model capabilities, image evidence, citations in stream/history/UI |
| I5 | Shared multi-select/editor, isolated draft ownership and all 24 locale translations |
| I6 | Local regression/type/contract verification, generated help, static packaging check and operator checklist |

The existing composer remains the sole editable configuration owner. The dialog owns only unconfirmed edits; cancelling does not write to another Agent or the composer. New execution rejects legacy Agent datasets with a rebind message. Historical configurations remain readable; legacy Workflow retrieval is unchanged.

Cross-layer tests found and corrected the Workflow citation event-field mismatch (`part` versus `result`), strict private-command serialization, search-to-open parse provenance, stale image artifact reads and inconsistent response declarations.

Two existing regression fixtures were repaired: document read/media-budget tests explicitly use memory storage instead of a live Dify adapter; the timer test matches text across child elements and now exercises a later `done=false` transition. Parser and reasoning-panel production logic are unchanged by these fixture fixes.

## Autonomous command contract

The Agent chooses the sequence. Startup only checks the CLI protocol and performs an authorization-only `spaces` probe; it never retrieves evidence. The probe counts toward the command budget. Incompatible CLI/Stub/API deployments fail before model spending. A single unavailable space does not hide the others.

| Commands | Purpose |
| --- | --- |
| `spaces`, `capabilities` | Inspect the bound scope and current read/query capability |
| `ls`, `tree`, `find`, `grep`, `stat` | Discover readable paths and candidates |
| `cat`, `diff` | Read segments and compare text without another LLM |
| `search` | Evidence-only fast retrieval using the selected space's embedding/rerank profile |
| `open` | Open a node or revalidate an issued evidence receipt |
| `images`, `image` | Enumerate captions and deliver a bounded thumbnail to a vision-capable Agent |

Example inside an active, authorized Agent sandbox:

```sh
dify-agent knowledge spaces
dify-agent knowledge ls --space docs --path /knowledge
dify-agent knowledge search --space docs --query '查找产品限制' --limit 5
dify-agent knowledge open --space docs --node-id '<node UUID returned by search>'
```

Each command selects one space. The Agent can investigate multiple spaces in separate or parallel commands; scores are explicitly local to each space. Text plus image queries retain KFS's existing per-space degradation behavior; unsupported image-only queries fail explicitly. Capabilities are evaluated by the existing model policy at request time, not a new provider environment variable or permanently cached UI badge. The Agent's own model controls whether it can consume image evidence.

`--image-file-id` accepts an upload UUID or the canonical `dify-file-ref` from a `local_file` input. This translates identity only; the API still revalidates access for the current caller. URLs and sandbox paths cannot become query-image grants. Images reach the model through trusted message parts, not arbitrary stdout.

Citations use `[title](kfs://<receipt>)`. Only receipts in authenticated server metadata become in-answer source links. Source cards preserve document/version/node identity; opening a document rechecks access. Agent-specific and ordinary Workflow answer renderers both support this. Old trusted evidence parts are removed from resumed model history, while user images remain intact; reopened receipts are reauthorized and version-checked.

### Enforced limits

- Up to 10 spaces per Agent; existing app-wide binding limits still apply to the Workflow union.
- Read-only 13-command allowlist, canonical `/knowledge` paths; no model-controlled tenant, target URL, headers or credentials.
- 64 commands, at most 2 concurrent, 60 seconds per command, 600 aggregate request-seconds per budget. Command IDs are replay protected; no automatic model-work retry.
- 24 KiB command body, 64 KiB result, 1 MiB aggregate text output; explicit pagination/truncation. `cat --limit` counts segments, not characters.
- At most 4 query images under existing KFS input limits. At most 8 delivered images and 8 MiB image bytes per budget; each fetched thumbnail is capped at 4 MiB, 4 million pixels and 4096 pixels per edge, and must be static JPEG/PNG/WebP.
- A 45-second lease refreshed every 10 seconds; run-state/cancel checks also gate reserve and delivery. Resume budgets/receipts expire after 2 hours without extension by commands.
- Read-only applies to KnowledgeFS, not the Agent's general shell or its other authorized tools. Retrieved documents remain untrusted evidence and must not be promoted to system instructions.

## Local verification record

Tests use local fixtures and test models, not deployed providers.

| Check | Result |
| --- | --- |
| API affected suites: Agent clients/services/composer, both execution modes, metadata, publish/binding/features | 945 passed |
| Runtime, shell, knowledge, embedded/standalone Stub suites | 292 passed |
| Chat answer/citation, composer, selector and history suites | 325 passed |
| KFS filesystem, capabilities, MCP, document/media safety and retrieval suites | 155 passed |
| Go `internal/agentcli` and `cmd/dify-agent-cli` | Passed, including generated help consistency |
| Affected API Pyrefly; full runtime Pyrefly | No errors |
| Full web `tsc --noEmit`; KFS API package `tsc --noEmit` | Passed |
| Python Ruff; affected KFS Biome; 24 locale JSON ESLint | Passed |
| Affected frontend `vp check --fix` | No errors; one pre-existing truncated activity-label disclosure warning at `agent-roster-response-content.tsx:206` |
| KFS OpenAPI/capability exporter tests | 2 passed |
| Dify/KFS product contract and generated lock check | Passed using a temporary Git index; the real Git index remains unstaged |
| Console/service generated contracts; CLI help | Regenerated from source schemas/commands |
| `git diff --check` | Passed |

Reproduction entry points:

- API: `uv run --project api pytest --no-cov` with `api/tests/unit_tests/clients/agent_backend`, `models/test_agent_knowledge_fs_config.py`, `services/agent`, `core/app/apps/agent_app`, `core/workflow/nodes/agent_v2`, the message-cycle metadata test and affected KnowledgeFS publish/binding/product/features tests.
- Runtime: `uv --directory dify-agent run --extra server`, loading real `graphon.model_runtime.entities.llm_entities`, `graphon.model_runtime.entities.message_entities` and `jsonschema` before `pytest.main` on runtime, shell, knowledge and agent_stub/server directories. This avoids a legacy compositor fixture installing placeholder modules globally. Ambient proxy variables were unset for in-process HTTP tests.
- Web: `pnpm --dir web test` on chat answer/citation, Agent composer, knowledge selector and preview history test directories; `pnpm --dir web type-check --noEmit`.
- KFS: package Vitest filesystem registry/request/path, capability, MCP, document read/media-budget and retrieval-test suites; `pnpm exec tsc --noEmit -p packages/api/tsconfig.json`; `pnpm openapi:export:test`.
- Go: `go test ./internal/agentcli ./cmd/dify-agent-cli`; regenerate help with `make -C dify-agent-runtime gen-cli-help`.
- API tests use `--no-cov` when sharing a directory to avoid competing writers to the same coverage SQLite file. These adjustments do not skip assertions or mask production failures.

## Deployment order and external acceptance gates

The following steps are documented, **not executed**. Docker integration remains CI-owned; image builds, deployed routing and real-provider verification are external gates.

1. Deploy matching KnowledgeFS and Dify API code/contracts. This feature adds no database migration.
2. Deploy the matching Agent run server and, if used, standalone Agent Stub with the `server` dependency extra. Both must use the same existing `DIFY_AGENT_REDIS_URL` and `DIFY_AGENT_REDIS_PREFIX`, compatible Stub tokens and the configured inner API connection. Do not put KnowledgeFS credentials in the sandbox.
3. Build/publish `dify-agent-runtime/docker/Dockerfile`, which already installs the CLI at `/usr/local/bin/dify-agent`. Update sandbox provisioning. Preserve required working files before recreating old sandboxes: updating the server alone does not replace retained CLI binaries. Old CLIs fail protocol preflight explicitly.
4. Deploy the generated-contract-compatible web build. Existing KFS configuration plus Agent shell availability controls the entry. No extra embedding/answer-provider switch is introduced.
5. An authorized administrator enables the relevant existing `agent_enabled` / `workflow_enabled` knowledge access policy. Publishing reconciles bindings but does not silently enable external access. Imported/legacy references require explicit reselection and publishing.
6. Verify both Agent App and Workflow AgentV2 against two spaces with different model capabilities. Exercise browse-first/search-first, text/image-only/mixed queries, citation opening and history reload. Confirm no retrieval happens before an Agent CLI search/read command.
7. Revoke one space/document mid-session: subsequent access must fail while other authorized spaces work. Stop a long command and verify no late evidence delivery. Test suspend/resume, two-hour expiry, archived Agents and old sandbox CLIs.
8. Validate shared Redis, network routing, model credentials, actual provider vision support, enterprise authorization and Docker integration before broad enablement. Local tests do not establish these deployment facts.

Rollback: remove KnowledgeFS bindings and republish affected Agents/Workflows before downgrading protocol components, then roll back the matching image set. Preserve working files and history. No destructive database rollback is needed and legacy datasets are not silently restored as a fallback.

## Authorized release follow-up

The user subsequently authorized committing/pushing this implementation and deploying the missing
Agent services to the existing Ubuntu test environment. This is separate from the local-only
implementation record above; no test-environment checks should be presented as production validation.

Pre-push verification was repeated after checking the current branch: 945 API tests, 292 Agent
runtime tests, 418 frontend tests (expanded to the full composer directories), 155 KnowledgeFS
tests and both Go CLI packages passed. Web and KnowledgeFS type checks, Python Ruff, both contract
exporter tests, the staged KnowledgeFS contract lock and whitespace checks passed. The two latest
remote website-source fixes were incorporated by fast-forward without overlapping this feature.

Initial test-host inspection found the Agent backend image already running, but no local sandbox
or dedicated Agent proxy. Deployment must complete the runtime configuration and sandbox/CLI
chain; a running backend container alone is not evidence that Agents are usable.
