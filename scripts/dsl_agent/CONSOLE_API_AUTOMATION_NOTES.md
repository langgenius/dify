# Console API Automation Notes

Reference context: Samhammer wants Dify app automation through DSL as the
configuration carrier:

```text
generate DSL -> import -> draft debug -> update -> publish -> service API regression
```

## API Boundary

- Service API uses an App API key and calls published apps under `/v1/...`.
- Console API uses Console authentication and manages tenant/workspace resources
  under `/console/api/...`.
- The public docs mainly cover Service API; the automation loop needs Console
  API coverage.

## Locally Confirmed P0 Endpoints

Confirmed from `api/controllers/console/**` in this checkout:

- `POST /console/api/login`
- `POST /console/api/refresh-token`
- `POST /console/api/apps/imports`
- `POST /console/api/apps/imports/{import_id}/confirm`
- `GET /console/api/apps/imports/{app_id}/check-dependencies`
- `GET /console/api/apps/{app_id}`
- `GET /console/api/apps/{app_id}/export`
- `POST /console/api/apps/{app_id}/workflows/draft/run`
- `POST /console/api/apps/{app_id}/advanced-chat/workflows/draft/run`
- `POST /console/api/apps/{app_id}/workflows/draft/nodes/{node_id}/run`
- `POST /console/api/apps/{app_id}/workflows/publish`
- `POST /console/api/apps/{app_id}/api-enable`
- `GET /console/api/apps/{app_id}/api-keys`
- `POST /console/api/apps/{app_id}/api-keys`
- `GET /console/api/apps/{app_id}/workflow-runs`
- `GET /console/api/apps/{app_id}/advanced-chat/workflow-runs`
- `GET /console/api/apps/{app_id}/workflow-runs/{run_id}`
- `GET /console/api/apps/{app_id}/workflow-runs/{run_id}/node-executions`
- `GET /console/api/apps/{app_id}/workflow-app-logs`
- `GET /console/api/apps/{app_id}/statistics/daily-messages`
- `POST /console/api/apps/dsl-agent/generate`

## Auth Notes

Current local Console login returns access, refresh, and CSRF tokens as cookies.
`Authorization: Bearer <access_token>` is still accepted by token extraction, but
write requests also pass through CSRF validation unless explicitly whitelisted.

For automation, the most reliable local path is:

```text
POST /console/api/login
-> persist cookies
-> send X-CSRF-Token from csrf_token cookie on write requests
```

## Runner

`console_lifecycle.py` wraps the confirmed main-loop endpoints. It is deliberately
separate from `agent.py` for now:

- DSL generation quality remains the first milestone.
- Console automation can be turned on only when credentials and a target Dify
  instance are available.
- Draft run SSE can now be parsed into `summary.errors`, `summary.failed_nodes`,
  and `summary.workflow_run_id`.
- `debug-draft` combines dependency check, parsed draft run, run detail, and
  node executions into one JSON artifact for the repair agent.
- `import-debug` combines import, optional confirm, dependency check, and
  structured HTTP failure detail into `console_import.json`.
- `runtime_repair.py` can now feed parsed Console runtime evidence into a repair
  prompt and produce `generated.runtime_repair.yml`.
- `deterministic_repair.py` handles known validation/runtime failures without an
  LLM, including broken selector roots and failed code nodes.
- `debug_loop.py` orchestrates validation, import-debug, debug-draft, and repair
  into a bounded internal loop. It does not publish automatically unless the
  post-success lifecycle flags are explicitly passed.
- `debug_loop.py` can also run the post-success lifecycle when explicitly
  requested: publish, enable API, create an App API key, export without secrets,
  and run a published Service API regression.
- `batch_eval.py` runs a manifest of local CE cases through `debug_loop.py` and
  records pass/fail, initial status, repair application, final outputs, and
  report paths.

## Local CE Closure, 2026-06-10

The local CE instance completed a real plugin-backed workflow loop:

- Installed the official `langgenius/openai` plugin into the local workspace.
- Validated and saved an OpenAI model provider credential through Console API.
- Imported a workflow DSL with an OpenAI LLM node.
- Ran the draft workflow successfully through Console API.
- Published the workflow, enabled API access, created an App API key, exported a
  backup with `include_secret=false`, and ran a published Service API regression.

Result artifact:

```text
scripts/dsl_agent/outputs/live_openai_llm_runtime/debug_loop_report.json
```

The report redacts the generated App API key. Provider credentials are not
written into the generated app DSL.

Known local issue:

- Local package upload required `FORCE_VERIFYING_SIGNATURE=false` in the ignored
  `docker/.env` dev file because the test `.difypkg` is unsigned.
- `POST /console/api/workspaces/current/plugin/install/pkg` hit an API/plugin
  daemon parameter drift during decode: the daemon accepted
  `PluginUniqueIdentifier` but the API client sent `plugin_unique_identifier`.
  Direct daemon install was used as a local workaround. The first-party agent
  should either use marketplace installation for official demo plugins or patch
  that API/daemon mismatch before relying on local package install.

## Batch Eval / Repair Proof, 2026-06-10

A single successful import/run is not enough to prove DSL generation quality.
The current local acceptance shape is:

```text
case fixture -> local validation -> Console import -> dependency check -> draft run -> parsed errors -> repair -> reimport -> rerun
```

Local CE batch artifact:

```text
scripts/dsl_agent/outputs/batch_eval_20260610_100448/batch_eval_report.json
scripts/dsl_agent/outputs/batch_eval_20260610_102412/batch_eval_report.json
```

Result:

- `total=5`, `passed=5`, `failed=0`.
- Active model provider detected: `langgenius/openai/openai`.
- `passthrough_success`: import and draft run succeeded.
- `openai_llm_success`: official OpenAI LLM node imported and ran.
- `broken_selector_repair`: initial status was `validation_failed`; local
  deterministic repair fixed the missing selector root before import; final
  draft output was `{"result": "repair me"}`.
- `broken_code_repair`: initial status was `draft_failed`; Console runtime
  evidence identified the failed code node; deterministic repair generated a new
  YAML, overwrote the same app, and the next draft run succeeded with
  `{"result": "repair code"}`.
- `broken_openai_model_repair`: an earlier optional run timed out when the agent
  waited for draft runtime evidence. The validator now flags obviously fake
  OpenAI model names before import; deterministic repair changes them to
  `gpt-4o-mini`, then import and draft run succeed.

Standalone repair proof artifact:

```text
scripts/dsl_agent/outputs/live_broken_code_repair/debug_loop_report.json
```

This report proves the failure/debug/reimport/rerun loop:

- iteration 1 imported the workflow, ran draft debug, captured
  `Exception: intentional batch eval failure` from the `code` node;
- deterministic repair replaced the failing code implementation and preserved a
  valid DSL shape;
- iteration 2 reimported over app
  `d11ce56c-8e24-48b0-adf0-eb399a005c83` and draft run succeeded.

Important finding: one earlier run showed that a broken end selector can look
runtime-successful while returning `null`. Because of that, `debug_loop.py` now
has a pre-import validation gate and deterministic validation repair. Runtime
success alone is not a sufficient quality signal.

## Product Implication

The official demo should not ask customers to use Codex or Claude Code. It should
present a Dify-owned agent flow:

```text
intent -> DSL -> local validation -> Console import -> draft run -> repair -> publish
```

The Console API docs gap is a product/documentation blocker for external users,
but not a blocker for building the internal demo because the endpoints exist in
the backend.

The first repo-native product entry is now:

```text
Create App -> Import from DSL -> Generate with AI
```

It calls a Dify Console endpoint to generate YAML, then uses the existing import,
confirm, dependency-check, and redirect path. This keeps the UI contract stable
while the backend implementation matures from deterministic workflow starter to
multi-agent DSL authoring, validation, dependency resolution, runtime debug, and
repair.
