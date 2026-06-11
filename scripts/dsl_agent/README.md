# Dify DSL Agent MVP

This is an internal prototype for a first-party Dify DSL generation agent.

It does not ask users to use Codex. Instead, it encodes a Codex-like workflow:

```text
user request
-> graph planning
-> plugin evidence lookup
-> source-grounded YAML generation
-> local rule validation
-> bounded repair loop
-> generated Dify DSL YAML
```

The frontend path can now generate YAML and pass it into Dify's existing DSL
import flow. Manual import is still useful for CLI artifacts and isolated
debugging, but it is no longer the only product path.

There is also an experimental Console API lifecycle runner for the Samhammer
style automation loop: import DSL, debug draft workflow, publish, enable API,
create an app API key, and export a backup.

The Dify repo now also has a first frontend integration point:

```text
Create App -> Import from DSL -> Generate with AI
```

That tab now starts an observable run with
`POST /console/api/apps/dsl-agent/runs`, polls
`GET /console/api/apps/dsl-agent/runs/{run_id}`, receives generated YAML, then
reuses the existing `apps/imports` flow and plugin dependency dialog. The older
`POST /console/api/apps/dsl-agent/generate` endpoint is kept for compatibility.
The API path now uses the same local resolver/normalizer/validator/repair
modules from this folder. The default generator remains a deterministic
workflow starter so the UI is always usable, and an optional OpenAI backend can
be enabled per request or by environment variable while preserving the same
run/result contract.

Every full generation run also writes `console_debug_plan.md`, which turns the
generated YAML into concrete Console API commands for internal testing.

## Files

- `agent.py` - main generation CLI
- `run_agent_context_smoke_tests.py` - prompt evidence compaction regression checks
- `demo_cases.yml` - official demo prompt contracts
- `run_demo_contract_tests.py` - validates demo prompt evidence contracts
- `generation_eval_cases.yml` - natural-language generation quality cases
- `run_generation_eval.py` - validates generated DSL node families and graph shape
- `plugin_resolver.py` - local plugin evidence resolver
- `run_evidence_smoke_tests.py` - plugin evidence regression checks for demo scenarios
- `shape_normalizer.py` - deterministic fixes for common LLM-generated DSL field-shape aliases
- `run_shape_normalizer_smoke_tests.py` - shape normalizer regression checks
- `validator.py` - local Dify DSL rule validator
- `run_validator_smoke_tests.py` - local validator regression checks
- `run_dify_app.py` - post-import API runner/debugger
- `console_lifecycle.py` - optional Console API lifecycle runner
- `run_console_lifecycle_smoke_tests.py` - Console lifecycle helper regression checks without a live Dify instance
- `deterministic_repair.py` - rule-based repairs for known validation/runtime failures
- `run_deterministic_repair_smoke_tests.py` - deterministic repair regression checks without a live Dify instance
- `runtime_repair.py` - repair generated DSL from parsed Console runtime evidence
- `debug_loop.py` - optional import/debug/repair loop runner
- `run_debug_loop_smoke_tests.py` - debug loop helper regression checks without a live Dify instance
- `batch_eval.py` - live local CE batch runner for import/draft/repair cases
- `batch_eval_cases.yml` - batch case manifest with expected statuses/outputs
- `batch_cases/` - hand-authored fixtures for success and failure/repair coverage
- `prompts.py` - prompt and rulebook text
- `../dsl_generator/` - existing compiler/examples/templates reused as reference evidence and optional experiments
- `outputs/` - generated run artifacts

## Dify Frontend MVP

Backend endpoints:

```text
POST /console/api/apps/dsl-agent/runs
GET  /console/api/apps/dsl-agent/runs/{run_id}
POST /console/api/apps/{app_id}/dsl-agent/debug/draft-run
POST /console/api/apps/dsl-agent/debug/repair
POST /console/api/apps/{app_id}/dsl-agent/debug/repair-draft

# legacy synchronous endpoint
POST /console/api/apps/dsl-agent/generate
```

Request:

```json
{
  "prompt": "Summarize customer support tickets.",
  "app_name": "Support Summarizer",
  "provider": "langgenius/openai/openai",
  "model": "gpt-4o-mini",
  "generation_backend": "openai",
  "generation_model": "gpt-5.5",
  "input_variable": "input",
  "resolve_dependencies": true
}
```

`generation_backend` and `generation_model` are optional. Omit them for the
deterministic starter, or set `generation_backend` to `openai` after configuring
`OPENAI_API_KEY`. The service also honors `DIFY_DSL_AGENT_GENERATION_BACKEND`
and `DIFY_DSL_AGENT_GENERATION_MODEL`. If OpenAI is unavailable, quota-limited,
or missing credentials, the API records a safe warning and falls back to the
deterministic starter.

Run response:

```json
{
  "id": "run-id",
  "status": "queued | running | succeeded | failed",
  "current_stage": "plan | source_evidence | resolve_dependencies | generate | normalize | validate | repair",
  "result": {
    "yaml_content": "...",
    "name": "Support Summarizer",
    "description": "Generated from a natural language requirement.",
    "warnings": [],
    "metadata": {
      "mode": "workflow",
      "provider": "langgenius/openai/openai",
      "model": "gpt-4o-mini",
      "generation_model": "gpt-5.5",
      "input_variable": "input",
      "dependency_count": 1,
      "backend": "deterministic_starter | openai",
      "plan": {},
      "source_evidence": {},
      "generation": {},
      "normalization": {},
      "validation": {},
      "repair": {}
    }
  },
  "events": [
    {
      "sequence": 1,
      "stage": "plan",
      "status": "running",
      "message": "Preparing workflow plan.",
      "created_at": "..."
    }
  ]
}
```

Draft debug request:

```json
{
  "inputs": { "input": "Summarize this text." },
  "query": "hello",
  "include_events": false
}
```

Draft debug response:

```json
{
  "mode": "workflow",
  "event_count": 3,
  "summary": {
    "workflow_run_id": "run-id",
    "succeeded": false,
    "failed_nodes": [],
    "errors": []
  }
}
```

The debug endpoint runs the app draft with Console permissions, parses the SSE
event stream, and returns compact runtime evidence for the next repair
iteration.

Runtime repair request:

```json
{
  "yaml_content": "kind: app\n...",
  "runtime_evidence": {
    "summary": {
      "succeeded": false,
      "failed_nodes": [
        {
          "node_id": "code",
          "node_type": "code",
          "status": "failed",
          "error": "runtime error"
        }
      ],
      "errors": []
    }
  }
}
```

Runtime repair response:

```json
{
  "yaml_content": "kind: app\n...",
  "changed": true,
  "input_validation": {},
  "validation": {},
  "repair": {
    "backend": "scripts.dsl_agent.deterministic_repair",
    "fixes": []
  }
}
```

This keeps the closed loop explicit and composable:

```text
generate YAML
-> import with apps/imports
-> run draft through /dsl-agent/debug/draft-run
-> repair YAML through /dsl-agent/debug/repair
-> re-import as overwrite
```

For a tighter post-import loop, the app-scoped `repair-draft` endpoint combines
the middle two steps: it runs the imported draft, parses runtime errors, and
returns a repair suggestion without automatically overwriting the app.

Frontend files:

- `web/app/components/app/create-from-dsl-modal/index.tsx`
- `web/service/apps.ts`
- `web/models/app.ts`
- `api/controllers/console/app/dsl_agent.py`
- `api/services/app_dsl_agent_service.py`

Next step: replace the deterministic starter in `AppDslAgentService` with the
source-grounded multi-agent pipeline while preserving the response shape.

## Generate DSL

Requires `OPENAI_API_KEY`. The default model is `gpt-5.5` for complex
agentic/coding workflows; set `OPENAI_MODEL` or pass `--model` to override it.

```bash
python3 dify/scripts/dsl_agent/agent.py \
  "Create a Typeform-triggered workflow that uses an agent to review the submission and sends a Gmail follow-up."
```

The default backend is `--backend direct-yaml`. The existing local compiler is
not stable enough to be the product backend, but can still be used explicitly as
an experiment:

```bash
python3 dify/scripts/dsl_agent/agent.py \
  "Create a Typeform-triggered workflow that sends a Gmail follow-up." \
  --backend spec-compiler
```

The command writes a run directory:

```text
dify/scripts/dsl_agent/outputs/<run-id>/
  request.txt
  plan.json
  plugin_evidence.json
  prompt_plugin_evidence.json
  source_context.json
  generated_spec.yml     # spec-compiler backend only
  generated.yml
  shape_normalization_report.json
  validation_report.json
  setup.md
  console_debug_plan.md
```

## Plugin Evidence Only

Use this when iterating on plugin selection without calling an LLM:

```bash
python3 dify/scripts/dsl_agent/agent.py \
  "Typeform trigger and Gmail send message" \
  --plugin-evidence-only
```

Or call the resolver directly:

```bash
python3 dify/scripts/dsl_agent/plugin_resolver.py "Gmail send Typeform trigger"
```

The resolver currently checks:

- `dify-official-plugins/`
- `dify/scripts/dsl_generator/templates/extracted/`

For official plugins, it reads manifest/provider/tool/event YAML and collects
nearby README/privacy doc summaries. It also links official plugin candidates to
extracted templates when their `provider_id` and `tool_name` / `event_name`
match. This lets the authoring agent use official plugin documentation while
preserving real exported node shapes and dependency evidence.

The resolver now separates:

- official manifest identity: `plugin_id`, `package_identity`, `version`, `minimum_dify_version`
- model provider evidence: `model_provider_candidates`, model provider ids, supported model types, and provider/model credential fields
- exact dependency evidence: dependency hashes only when found in real extracted DSL templates
- credential requirements: provider OAuth/client/credential/subscription schemas without secret values

Policy:

- prefer official Dify plugins
- use extracted templates as node-shape evidence
- use exact dependency hashes only from `exact_dependency_evidence` or template `dependencies`
- use third-party plugins only when official plugins do not cover the need
- use raw HTTP only when no suitable plugin exists or the user explicitly asks for HTTP

Evidence regression checks:

```bash
python3 dify/scripts/dsl_agent/run_evidence_smoke_tests.py
```

Prompt context regression checks:

```bash
python3 dify/scripts/dsl_agent/run_agent_context_smoke_tests.py
```

## Normalize DSL Shape

After generation or runtime repair, the agent first runs a deterministic shape
normalizer before dependency normalization and validation. It fixes common
LLM-generated aliases that Dify import does not accept:

- `workflow.viewport` moved to `workflow.graph.viewport`
- workflow-level `nodes` / `edges` moved into `workflow.graph` when both are present
- start variables using `key` / `name` mapped to `variable`
- start variable type aliases such as `text` / `string` mapped to `text-input`
- end outputs using `key` / `value` mapped to `variable` / `value_selector`
- missing `environment_variables`, `conversation_variables`, and `features` filled with safe empty defaults
- workflow variables get Dify-required non-null default `value` fields and alias fields are removed

Run the normalizer directly:

```bash
python3 dify/scripts/dsl_agent/shape_normalizer.py \
  dify/scripts/dsl_agent/outputs/<run-id>/generated.yml \
  --report-output dify/scripts/dsl_agent/outputs/<run-id>/shape_normalization_report.json
```

Shape normalizer regression checks:

```bash
python3 dify/scripts/dsl_agent/run_shape_normalizer_smoke_tests.py
```

## Normalize Dependencies

After shape normalization, the agent runs a deterministic dependency normalizer
before validation. It scans generated tool, trigger, and model-backed nodes,
then adds only dependencies that can be grounded in resolver evidence:

- exact plugin dependency hashes from extracted templates
- official model provider package identities when no exact exported hash exists

It does not trust a generated node's own `plugin_unique_identifier` as evidence,
so fabricated hashes remain visible as validation/import issues instead of being
silently accepted.

Run the normalizer directly:

```bash
python3 dify/scripts/dsl_agent/dependency_normalizer.py \
  dify/scripts/dsl_agent/outputs/<run-id>/generated.yml \
  --plugin-evidence dify/scripts/dsl_agent/outputs/<run-id>/plugin_evidence.json \
  --report-output dify/scripts/dsl_agent/outputs/<run-id>/dependency_normalization_report.json
```

Normalizer regression checks:

```bash
python3 dify/scripts/dsl_agent/run_dependency_normalizer_smoke_tests.py
```

Console lifecycle helper checks:

```bash
python3 dify/scripts/dsl_agent/run_console_lifecycle_smoke_tests.py
```

Debug loop helper checks:

```bash
python3 dify/scripts/dsl_agent/run_debug_loop_smoke_tests.py
```

## Official Demo Contracts

Demo prompts live in `demo_cases.yml`. They are intentionally testable without
an LLM key: the contract verifies that each prompt resolves to the expected
official plugins, extracted node templates, dependency evidence, and setup
fields.

```bash
python3 dify/scripts/dsl_agent/run_demo_contract_tests.py \
  --json \
  --output dify/scripts/dsl_agent/outputs/demo_contract_report.json
```

Current demo contracts:

- `typeform_gmail_followup` - Typeform trigger plus Gmail follow-up draft.
- `drive_qdrant_indexing` - Google Drive trigger plus Qdrant indexing; this also covers third-party template fallback evidence.

## Generation Quality Evaluation

Use this before claiming the generator can handle broader workflow patterns. It
starts from natural-language requirements, calls the same `AppDslAgentService`
used by the product API, validates the generated YAML, and checks expected node
families and edge handles.

Fast deterministic gate:

```bash
cd dify/api
uv run python ../scripts/dsl_agent/run_generation_eval.py \
  --no-resolve-dependencies \
  --json \
  --output ../scripts/dsl_agent/outputs/generation_eval_latest/report.json
```

The default case manifest covers:

- structured extraction: `start -> llm -> code -> end`;
- support ticket classification: `question-classifier` with per-class LLM branches;
- urgent/default branching: native `if-else` with `true` / `false` handles;
- RAG answering: `knowledge-retrieval -> llm -> end`.

Optional OpenAI quality run:

```bash
cd dify/api
DIFY_DSL_AGENT_OPENAI_TIMEOUT_SECONDS=60 \
uv run python ../scripts/dsl_agent/run_generation_eval.py \
  --generation-backend openai \
  --generation-model gpt-5.5 \
  --no-resolve-dependencies \
  --json
```

OpenAI runs may fall back to the deterministic starter if the model times out
or returns invalid YAML; the report records `fallback_from` for each case.

Optional local CE import/draft debug loop:

```bash
cd dify/api
uv run python ../scripts/dsl_agent/run_generation_eval.py \
  --no-resolve-dependencies \
  --debug-loop \
  --console-base http://localhost \
  --install-missing-dependencies \
  --skip-run-records \
  --json
```

This writes each generated `generated.yml` under
`scripts/dsl_agent/outputs/generation_eval_latest/<case-id>/`, then invokes
`debug_loop.py` for import, dependency check/install, draft run, runtime error
capture, and repair attempts. Cases can define `inputs` for draft execution.
Cases that require workspace-specific resources, such as a real dataset id for
RAG, can set `debug.skip: true` and remain part of the structural generation
gate without failing the live CE loop.

To iterate on one failing case, pass `--case-id <id>`; the flag may be repeated.

## Validate DSL

```bash
python3 dify/scripts/dsl_agent/validator.py \
  dify/scripts/dsl_agent/outputs/<run-id>/generated.yml
```

JSON output:

```bash
python3 dify/scripts/dsl_agent/validator.py \
  dify/scripts/dsl_agent/outputs/<run-id>/generated.yml \
  --json
```

Validator regression checks:

```bash
python3 dify/scripts/dsl_agent/run_validator_smoke_tests.py
```

The validator checks graph structure, nested `value_selector` /
`variable_selector` references, plugin-backed node dependencies, model provider
dependencies for LLM/classifier/extractor/retrieval nodes, native start/end
shapes, and code node fields/outputs.

## Manual Import Boundary

The default MVP path does not automatically call Dify's DSL import API.

Flow:

```text
1. Generate generated.yml locally.
2. User manually imports generated.yml in Dify.
3. User configures model/plugin credentials.
4. User publishes or enables API access.
5. User gives the app API endpoint and API key to the runner.
6. Runner calls the app and records response/errors.
```

## Experimental Console Lifecycle

Use this only against a Dify instance where you have Console credentials. The
current local Dify backend accepts cookie-based Console login and also supports
Bearer access tokens; write requests may require `X-CSRF-Token`.

For local Dify CE, the DB is the state store behind the Console API. The agent
should not write the DB directly; it closes the loop through the same backend
paths the Console UI uses: setup/login, import, dependency check, draft debug,
publish, API enablement, API key creation, export backup, and Service API
regression.

Start local CE from the repo's Docker setup:

```bash
cd dify/docker
cp .env.example .env
docker compose up -d
```

Docker compose exposes the Console through nginx at `http://localhost`. If you
run the API service directly outside compose, override examples with
`--console-base http://localhost:5001`.

Check whether the local CE is reachable and what the next action is:

```bash
python3 dify/scripts/dsl_agent/console_lifecycle.py \
  --console-base http://localhost \
  preflight
```

If CE has not been initialized and `INIT_PASSWORD` is configured:

```bash
python3 dify/scripts/dsl_agent/console_lifecycle.py \
  --console-base http://localhost \
  init-validate \
  --init-password YOUR_INIT_PASSWORD
```

Then create the local admin account:

```bash
python3 dify/scripts/dsl_agent/console_lifecycle.py \
  --console-base http://localhost \
  setup \
  --email you@example.com \
  --name Admin \
  --password 'YOUR_PASSWORD'
```

Login and persist cookies:

```bash
python3 dify/scripts/dsl_agent/console_lifecycle.py \
  --console-base http://localhost \
  login \
  --email you@example.com \
  --password 'YOUR_PASSWORD'
```

The default cookie jar is `~/.dify_console_cookies.txt`; treat it as a session
credential. The helper attempts to save it with `0600` permissions.

Run the import/debug/repair loop:

```bash
python3 dify/scripts/dsl_agent/debug_loop.py \
  dify/scripts/dsl_agent/outputs/<run-id> \
  --console-base http://localhost \
  --mode workflow \
  --inputs '{"input": "hello"}' \
  --install-missing-dependencies
```

This writes `debug_loop_report.json` and per-loop artifacts such as
`shape_normalization.loop1.json`, `console_import.loop1.json`,
`validation.loop1.json`, `console_draft_run.loop1.json`, and
`generated.loop1.runtime_repair.yml`. If local validation fails before import,
the loop can write `generated.loop1.validation_repair.yml` and
`validation_repair.loop1.json` before retrying import. Runtime repair attempts
also write shape and dependency normalization reports.
When dependency installation is enabled, it also writes
`dependency_install.loop1.json`.

Run the full internal lifecycle after model/plugin credentials are configured:

```bash
python3 dify/scripts/dsl_agent/debug_loop.py \
  dify/scripts/dsl_agent/outputs/<run-id> \
  --console-base http://localhost \
  --mode workflow \
  --inputs '{"input": "hello"}' \
  --install-missing-dependencies \
  --publish \
  --enable-api \
  --create-api-key \
  --export-backup \
  --service-regression
```

This adds `post_success_lifecycle.json`, `exported.yml`, and
`service_regression.json` when those stages run. If any publish/API/export or
Service API check fails, `debug_loop_report.json` reports
`post_success_failed`. API key payloads are redacted in persisted reports; the
raw key is kept only in memory long enough to run Service API regression.

Or use the local CE closure wrapper, which performs preflight, optional
setup/login when credentials are provided, and then calls `debug_loop.py`:

```bash
python3 dify/scripts/dsl_agent/local_ce_closure.py \
  dify/scripts/dsl_agent/outputs/<run-id> \
  --console-base http://localhost \
  --email you@example.com \
  --password 'YOUR_PASSWORD' \
  --mode workflow \
  --inputs '{}' \
  --publish \
  --enable-api \
  --create-api-key \
  --export-backup \
  --service-regression
```

For a new local CE with an init password, also pass
`--init-password YOUR_INIT_PASSWORD`. You can dry-run the wrapper with
`--dry-run` or stop after preflight/login with `--no-run`.

Import generated DSL:

```bash
python3 dify/scripts/dsl_agent/console_lifecycle.py \
  --console-base http://localhost \
  import-debug dify/scripts/dsl_agent/outputs/<run-id>/generated.yml \
  --confirm \
  --output dify/scripts/dsl_agent/outputs/<run-id>/console_import.json
```

The import debug output includes import status, optional confirm result,
dependency check results, and structured HTTP error details when import fails.

Install missing plugin dependencies from the imported app's dependency check:

```bash
python3 dify/scripts/dsl_agent/console_lifecycle.py \
  --console-base http://localhost \
  install-missing-dependencies APP_ID
```

Run the recommended draft debug sequence:

```bash
python3 dify/scripts/dsl_agent/console_lifecycle.py \
  --console-base http://localhost \
  debug-draft APP_ID \
  --mode workflow \
  --inputs '{"input": "hello"}' \
  --output dify/scripts/dsl_agent/outputs/<run-id>/console_draft_run.json
```

The debug output includes:

- dependency check results
- `draft_run.summary.workflow_run_id`
- `draft_run.summary.status`
- `draft_run.summary.errors`
- `draft_run.summary.failed_nodes`
- per-node statuses from `node_finished` events
- run detail and node executions when a workflow run id is available

Repair YAML from the parsed Console debug result:

```bash
python3 dify/scripts/dsl_agent/runtime_repair.py \
  dify/scripts/dsl_agent/outputs/<run-id>
```

This reads `generated.yml`, `console_draft_run.json`, and any available
`console_import.json` / `console_run_detail.json` / `console_node_executions.json`,
then writes:

```text
generated.runtime_repair.yml
runtime_repair_report.json
```

Each runtime repair attempt also writes `shape_normalization.runtime_repairN.json`
and `dependency_normalization.runtime_repairN.json`.

After a repair, rerun `import-debug` with `generated.runtime_repair.yml`.

Deterministic repair checks:

```bash
python3 dify/scripts/dsl_agent/run_deterministic_repair_smoke_tests.py
```

These checks cover two non-LLM repair gates:

- invalid selectors are repaired before import, so Dify does not silently return
  a successful run with `null` outputs;
- failed code nodes are repaired from parsed Console runtime evidence.
- obviously fake OpenAI model names are repaired before import, so draft debug
  does not hang waiting for provider errors.

## Batch Evaluation

One successful import/run is only a smoke test. To decide whether the DSL agent
is improving, use batch evaluation against local CE:

```bash
python3 dify/scripts/dsl_agent/batch_eval.py \
  --repair-backend deterministic \
  --timeout-seconds 45
```

The batch runner loads `batch_eval_cases.yml`, skips cases whose required model
provider is not active in the workspace, runs `debug_loop.py` per case, and
writes one aggregate report plus per-case `debug_loop_report.json` files.

Current local CE proof artifacts:

```text
scripts/dsl_agent/outputs/batch_eval_20260610_100448/batch_eval_report.json
scripts/dsl_agent/outputs/batch_eval_20260610_102412/batch_eval_report.json
```

That run covered:

- passthrough workflow success;
- official OpenAI LLM node success;
- pre-import selector validation failure, deterministic repair, reimport, and
  successful draft run;
- runtime code-node failure, Console error capture, deterministic repair,
  overwrite import, and successful draft run;
- broken OpenAI model repair with `--include-optional`: initially timed out
  when repair waited for draft runtime evidence; it now fails validation first,
  repairs to `gpt-4o-mini`, imports, and draft-runs successfully.

The report result was `total=5`, `passed=5`, `failed=0`; one case was an
optional skip counted as OK. This is the first quality gate, not the final
coverage claim for "most workflows." New node families and plugin flows should
be added as batch cases before claiming broader coverage.

Fetch full run records after a draft run:

```bash
python3 dify/scripts/dsl_agent/console_lifecycle.py \
  --console-base http://localhost \
  workflow-run-detail APP_ID WORKFLOW_RUN_ID

python3 dify/scripts/dsl_agent/console_lifecycle.py \
  --console-base http://localhost \
  workflow-run-node-executions APP_ID WORKFLOW_RUN_ID
```

Publish and create a Service API key:

```bash
python3 dify/scripts/dsl_agent/console_lifecycle.py --console-base http://localhost publish APP_ID
python3 dify/scripts/dsl_agent/console_lifecycle.py --console-base http://localhost api-enable APP_ID
python3 dify/scripts/dsl_agent/console_lifecycle.py --console-base http://localhost api-key APP_ID
```

For publish markers, Dify currently enforces `marked_name <= 20` and
`marked_comment <= 100`; `debug_loop.py` validates these before calling the
Console API.

## Run Imported App

Workflow app:

```bash
python3 dify/scripts/dsl_agent/run_dify_app.py \
  --mode workflow \
  --api-base https://YOUR_DIFY_HOST/v1 \
  --api-key YOUR_APP_API_KEY \
  --inputs '{"input": "hello"}'
```

Advanced chat app:

```bash
python3 dify/scripts/dsl_agent/run_dify_app.py \
  --mode advanced-chat \
  --api-base https://YOUR_DIFY_HOST/v1 \
  --api-key YOUR_APP_API_KEY \
  --query "hello" \
  --inputs '{}'
```

## Current Limitations

- Full Console lifecycle automation exists in the experimental runner; the default product boundary is still manual import until auth, dependency installation, and credential setup are hardened.
- Automatic plugin installation is opt-in and still depends on marketplace/package/GitHub permissions in the target workspace.
- The repo-native frontend entry exists under `Create App -> Import from DSL -> Generate with AI`, but it still uses the starter backend until the stronger agent is wired behind the same endpoint.
- Validator is local and rule-based; it is not a full Dify runtime import.
- Dependency normalization is conservative: it only adds dependencies from resolver evidence and still needs live Console import/debug to catch schema drift.
- Plugin resolver uses local official plugin repos and extracted templates first.
- Third-party GitHub plugin search is not implemented yet.
- Runtime repair needs parsed Console debug output. Known failures can use deterministic repair; unknown failures still need an LLM repair backend.
- Generated YAML quality depends on model behavior, source evidence, runtime evidence, and rule coverage.

## Public Repo References

See `REPO_REFERENCE_NOTES.md` for the public projects we reviewed and how this
agent borrows their useful patterns:

- `LingyiChen-AI/workflow-skill`
- `A1sh-4/dify-dsl-generator`
- `lazeyliu/dify-dsl-generator-skills`
- `GHP1223/dify-dsl-gen`
- `01554/DslGenAgent`
- `kevinten-ai/ai-dify-dsl`

## Next Steps

1. Add third-party plugin search as a separate resolver phase.
2. Expand validator coverage for node-specific schemas and import-result errors.
3. Split spec generation into per-node authoring when the first demo suite is stable.
4. Add a hosted or local UI wrapper for the official demo flow.
5. Run the full Console lifecycle against a live Dify instance with test credentials and record known-good artifacts.
