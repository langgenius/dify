# Builder Native Restricted Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Execute the ordered backend work under the user’s existing authorization, with independent reviews and per-ticket local/Dev proof.

**Goal:** Replace Builder's unrestricted test launches with a native restricted execution subset, truthful fixture evidence and fail-closed handling; then make deterministic Code/template available only behind verified sandbox isolation.

**Architecture:** Keep AppGenerateService, native generators/runners, DifyNodeFactory, Graphon nodes and native persistence. Carry a server-owned typed execution context through those owners, revalidate after the worker's DB reload, and enforce effects in per-node injected capabilities. Persist a sealed Builder evidence sidecar; never let observer callbacks or native success erase denial.

**Tech Stack:** Python 3.12, Pydantic v2, SQLAlchemy/Alembic, Flask, existing Graphon 0.7.0 protocols, pytest; CI-owned dify-sandbox conformance.

**Spec:** `docs/superpowers/specs/2026-10-09-builder-safe-execution-design.md`

## Global Constraints

- Base is released/verified `30976670111b055e753dc8452ee1686faa90fe5d`; isolated branch `codex/builder-mvp-safe-execution`. No changes to primary untracked files or paused search worktree.
- Backend only. Root may perform user-authorized Linear, local/Dev E2E, browser evidence, source push and Dev deployment after review. No frontend tickets until ALL six backend workstreams/APIs are verified in Dev; no frontend product edits. Generated shared API contract changes follow the schema owner and are not frontend feature implementation.
- No custom executor, production mock node replacement, observer-hook authorization, process-global monkeypatch, fabricated native-success Run or fake approval.
- Policy version is `builder-restricted-v1`; executable modes are exactly `restricted` and `mock`. All real calls and unknown/destructive effects remain blocked.
- Initial support is standard Workflow, scalar Start/End and native text HTTP fixture chains. Code/template require independently verified `network-disabled-v1` profile; Chatflow/files/models/tools/Agents/containers stay unsupported.
- Read root/api AGENTS and controller API_SCHEMA_GUIDE. Use an isolated worktree after the current gate. Backend commands use `UV_PROJECT_ENVIRONMENT=/Users/chongbinyao/dify/dify/api/.venv uv run --project api --no-sync ...` from that worktree. Integration pytest is CI-only; actual local/native/browser E2E is explicitly user-authorized. Root owns runtime/deploy; task implementers do not start or mutate services.
- Preserve ordinary native execution defaults, historical Run and published-version data, native Run linkage and existing output/revision publication checks. No historical provenance backfill.

## Review Focus

1. Worker loads a newer graph/config after launch admission: reject before file/bootstrap/environment/trace or live constructor work (Task 2).
2. HTTP policy denial is converted to node default output/native terminal success: durable denial still blocks verification/publication (Tasks 3–4).
3. User posts a mode/approval-like flag, stale fixture or foreign request/session/test-input ID: reconstruct trusted owners and deny before execution (Tasks 1–2).
4. Native API dependency changes the class behind an existing node type/version: exact implementation admission rejects it (Task 3).
5. Positive native paths accidentally work only through mocks: run actual Graphon owners for HTTP and real sandbox Code/template controls in CI (Tasks 3, 5–6).

---

## Task 1: Bound request, strict fixture lineage and ownership foundation

**Task global constraints:** Read the spec’s binding decisions above plus root/api AGENTS. Backend only; no runtime, Linear, push/deploy or frontend edits by implementer. Use shared primary `.venv` with `UV_PROJECT_ENVIRONMENT=/Users/chongbinyao/dify/dify/api/.venv uv run --project api --no-sync`. Integration pytest CI-only. No helpers. This foundation is not a behavior release; no safe-execution completion claim.

**Files**
- Create `api/core/dify_builder/execution_policy.py`: immutable schema, canonical digests, raw admission and recorder protocol.
- Create `api/services/dify_builder/execution_policy_service.py`: owner snapshot, preparation, claim and append, server fixture stamping.
- Modify `api/models/dify_builder.py`, `api/core/dify_builder/models.py`, `api/services/dify_builder/repository.py`, `api/services/dify_builder/serde.py`, `api/core/dify_builder/contract.py` for optional fixture persistence.
- Modify `api/services/dify_builder/service.py`, `api/services/dify_builder/wiring.py` (narrow injected synchronous safe fixture-stamp callback), `api/core/dify_builder/ports.py`, `handlers_build.py`, `handlers_edit.py`, `handlers_fix.py`, `api/services/dify_builder/dify_port.py` and relevant test fakes ONLY for shared strict fixture ingestion/server-stamp (run launch changes belong Task 2).
- Add Alembic `add_builder_execution_requests` migration from current single head, no historical backfill.
- Extend existing `api/tasks/remove_app_and_related_data_task.py` and its focused unit tests narrowly for tenant/app-scoped cleanup of the new sidecar, reusing existing bounded deletion ownership; no legacy Builder lifecycle refactor or new sweeping job.
- Tests: new `api/tests/unit_tests/core/dify_builder/test_execution_policy.py`, `api/tests/unit_tests/services/dify_builder/test_execution_policy_service.py`; existing serde/repository/service/action/three-handler tests. CI-owned migration/PG locking tests added with native integration Task 4.

**Exact interfaces produced**

Also produce `RestrictedAdmissionSnapshot` with app_mode, workflow_kind, graph, input_schema, features, has_environment_variables, has_conversation_variables, has_external_tracing; frozen snapshot holds untrusted graph only for inspection, never trusted authorization. `admit_raw_execution_metadata(snapshot) -> None` rejects metadata before revision access; `admit_restricted_workflow(context, snapshot) -> None` checks graph/fixtures/effective inputs. Service recorder object captures immutable context/run/task and latches failures; persistence has no mutable callbacks.
```python
ScalarValue = str | int | float | bool | None
# All trusted types ConfigDict(frozen=True, extra='forbid'), bounded nonempty IDs.
class HttpResponseFixtureV1(BaseModel):
    schema_version: Literal[1] = 1
    node_id: str
    node_type: Literal['http-request'] = 'http-request'
    implementation: Literal['graphon.nodes.http_request.node.HttpRequestNode'] = \
        'graphon.nodes.http_request.node.HttpRequestNode'
    node_version: Literal['1'] = '1'
    source: Literal['user_sample', 'generated_sample']
    status_code: Annotated[int, Field(strict=True, ge=100, le=599)]
    content_type: Literal['application/json', 'text/plain']
    body: str

class HttpFixtureSetV1(BaseModel):
    schema_version: Literal[1] = 1
    execution_revision: str
    fixtures: tuple[HttpResponseFixtureV1, ...]

class AdmittedNodeBinding(BaseModel):
    node_id: str
    implementation: str
    node_version: Literal['1']
    normalized_config_digest: str

class BuilderExecutionContext(BaseModel):
    policy_version: Literal['builder-restricted-v1'] = 'builder-restricted-v1'
    request_id: str
    tenant_id: str
    app_id: str
    workflow_id: str
    actor_id: str
    session_id: str
    test_input_id: str
    execution_revision: str
    graph_revision: str
    submitted_inputs_digest: str
    effective_inputs_digest: str
    fixture_digest: str
    context_digest: str
    mode: Literal['restricted', 'mock']
    sandbox_profile: Literal['disabled', 'network-disabled-v1']
    # Optional typed trusted deployment receipt, None when disabled (Task 5).
    admitted_nodes: tuple[AdmittedNodeBinding, ...]
    http_fixtures: tuple[HttpResponseFixtureV1, ...]

class BuilderExecutionObservation(BaseModel):
    observation_id: str
    invocation_id: str
    request_id: str
    node_id: str
    kind: Literal['fixture_served', 'effect_blocked', 'sandbox_started',
                  'sandbox_completed', 'sandbox_failed']
    implementation_version: str
    reason_code: str
    fixture_digest: str | None = None
    profile_digest: str | None = None
    request_hmac: str | None = None

class BuilderExecutionRecorder(Protocol):
    @property
    def healthy(self) -> bool: ...
    def record(self, observation: BuilderExecutionObservation) -> None: ...

# Service owns ORM/I/O; core types/admission do not import services/ORM.
prepare(*, session_id: str, test_input_id: str, app_id: str, actor: Actor,
        workflow: Workflow, submitted_inputs: Inputs,
        effective_inputs: Inputs) -> BuilderExecutionContext
claim_launch(*, context: BuilderExecutionContext, native_run_id: str,
             task_id: str) -> None
revalidate(*, context: BuilderExecutionContext, workflow: Workflow, app: App,
           actor_id: str, effective_inputs: Inputs, root_node_id: str,
           call_depth: int, transport: Literal['in_process', 'celery'],
           resume: bool) -> None
record(*, context: BuilderExecutionContext, native_run_id: str, task_id: str,
       observation: BuilderExecutionObservation) -> None
# Implement seal in Task 4, not a placeholder method returning eligible proof.
# Port signature for all three handlers; untrusted callers cannot stamp source.
stamp_http_fixtures(app_id: str, actor: Actor, *, base_app_revision: str,
                    fixtures: tuple[HttpResponseFixtureV1, ...]) -> HttpFixtureSetV1
```

`BuilderExecutionPolicyError(ValueError)` owns a stable sanitized `reason_code`; message never echoes input/body/URL. `ExecutionEvidenceSummary` fields: request_id, policy_version, mode, sealed, safety_outcome (six exact spec outcomes including native_failed), simulated_node_ids/blocked_node_ids tuples, sandbox_profile, fixture_digest; optional native ID only if actually observed. Prepare and revalidate are pure effect admission plus scoped DB reads; actual runtime guard remains Tasks 2–3.

**Concrete state/schema decisions**
- IDs <=128 UTF-8 characters; graph bounded to <=128 nodes, fixture bodies <=65,536 bytes, fixtures <=128, observations <=4,096 per request. Existing application retention owns sidecar retention, no global sweeping job. Digests SHA256 canonical finite UTF-8 JSON (no `default=str`); context_digest hashes all context fields except itself. Fixture order canonical by node_id; graph arrays keep order.
- TestInput fixture JSON absent means no fixtures; explicit malformed/null/object submission invalid. Shared decoder after full authorization validates fixture list, strips/overrides client source to user_sample (reject generated_sample impersonation), produces immutable models. An injected service/wiring stamp callback rejects stale/malformed samples synchronously before enqueue and without broad planning revision resolution; the handler revalidates the SAME submitted revision before save. Source absent is user_sample; trusted internal generators can supply generated_sample through a separate internal owner, not action payload. Pydantic parse diagnostics must not echo bodies.
- Strict body UTF-8 and finite JSON; reject duplicate/unknown/unused/wrong-version nodes, bool status, lone surrogates, extra header/file fields.
- Raw snapshot uses `_environment_variables`, `_conversation_variables`, raw app tracing, actual standard kind and features; reject malformed/nonobject/nonempty variables BEFORE execution_revision/key access. Known empty/disabled native feature defaults pass; enabled/unknown forms refuse. No broad planning-secret audit claim.
- Scalar raw values reject nested/list/files/nonfinite even undeclared; bind effective inputs supplied by existing native normalization in Task 2. Node config digest is canonical raw node data with only absent version normalized to '1'. Exact implementation binding initially StartNode v1, EndNode v1, HttpRequestNode v1; inspect actual imported fully qualified Start/End identities, no invented path. Linear standard graph only, no container/cycle/branch/unreachable effects.
- New sidecar stores immutable context JSON/hash, all owner IDs, state prepared/running/sealed, native run/task IDs, append JSON, completion fingerprint/summary, created/sealed timestamps. Unique launch claim is state transition under `SELECT FOR UPDATE`, duplicate same-context claim still rejects. Append verifies running/fullcontext/run/task/node/impl/fixture/profile; repeated observation ID rejects, each capability attempt unique. Observation implementation_version is '<fully-qualified concrete class>:1', distinct from fixture/binding node_version='1'; fixture_digest is whole-set context.fixture_digest. No external I/O in transaction. No seal implementation until authoritative native rows are integrated in Task 4.

- [ ] Write failing typed/body/lineage/owner/state tests. Real existing SQLite fixtures only unit tests; do not claim PG race proof. Pin false source-mode inference and strict provenance:
```python
assert prepare_inputs(source='mock', fixtures=()).mode == 'restricted'
assert fixture.model_dump(mode='json')['status_code'] == 201
with pytest.raises(ValidationError):
    HttpResponseFixtureV1(node_id='http', source='user_sample',
                          status_code=True, content_type='text/plain', body='x')
assert decode_legacy_test_input(old_row).http_fixtures is None
```
Concrete test helper `prepare_inputs` must call actual service using owned session/app/workflow/test-input fixture, never a fake alternate policy. Cases: actor/account membership absent; foreign session owner/app/tenant/test-input; changed raw env/conversation/tracing; malformed persisted fixture envelope; stale submit and stale reuse; numerical effective vs submitted digest distinction; no revisions/decryption called after metadata refusal; mandatory state/claim/append binding; sealed append rejection; recorder failure makes healthy false monotonically; old TestInput roundtrip unchanged.
- [ ] Run these targeted files to record failure before implementation. Implement strict shared ingestion, server stamp and sidecar functions above. Preserve input-only provide_testdata revision exemption; fixture-bearing submissions require base revision match at stamping. Missing Fix test_input_ref must request test data, not call run_draft with empty identity.
- [ ] Run new tests + affected existing repository/serde/submit/handler tests. Meaningful lint/format/changed-source typing with baseline separated. Regenerate backend API contracts with guide if request DTO changes, never hand-edit generated contracts or frontend feature files. Commit only scoped backend/source/schema files. Write report with exact files/commit/tests, known Task 2–4 enforcement/sealing still unimplemented and no completion claim.

## Task 2: Default Builder propagation and pre-bootstrap admission

**Files**
- Modify `api/core/dify_builder/ports.py`, `handlers_build.py`, `handlers_edit.py`, `handlers_fix.py` and corresponding fakes.
- Modify `api/services/dify_builder/dify_port.py`, `api/services/app_generate_service.py`, `api/core/app/entities/app_invoke_entities.py`.
- Modify `api/core/app/apps/workflow/app_generator.py`, `api/core/app/apps/workflow/app_runner.py`, `api/core/app/apps/workflow_app_runner.py`.
- Modify `api/tasks/app_generate/workflow_execute_task.py` only for typed serialization and explicit restricted Celery/resume rejection.
- Test `api/tests/unit_tests/services/dify_builder/test_dify_port.py`, `api/tests/unit_tests/services/test_app_generate_service_in_process.py`, `api/tests/unit_tests/tasks/test_workflow_execute_task.py`, new `api/tests/unit_tests/core/app/apps/test_builder_execution_admission.py`.

**Interfaces**
- Builder `run_draft(..., *, session_id: str, test_input_id: str, on_workflow_event=...) -> Run`; it always calls `prepare`.
- `builder_execution: BuilderExecutionContext | None = None` explicit internal keyword on AppGenerateService/generator overloads and optional typed field on AppGenerateEntity/DifyRunContext/AppExecutionParams. None means ordinary non-Builder invocation only.
- `_init_graph(..., builder_execution: BuilderExecutionContext | None = None, execution_recorder: BuilderExecutionRecorder | None = None)`; recorder protocol is `record(BuilderExecutionObservation) -> None`, supplied by policy service. Context with absent recorder fails closed.
- `RestrictedAdmissionSnapshot(BaseModel)`: app_mode: str, graph: dict[str, Any], input_schema: dict[str, Any], features: dict[str, Any], has_environment_variables: bool, has_conversation_variables: bool, has_external_tracing: bool, workflow_kind: str. The service builds this from raw metadata without decrypting. The input_schema mapping is the existing `start_schema(graph)` owner's output, matching Task 1's produced interface.
- `admit_raw_execution_metadata(snapshot: RestrictedAdmissionSnapshot) -> None` runs before revision/key resolution; `admit_restricted_workflow(context: BuilderExecutionContext, snapshot: RestrictedAdmissionSnapshot) -> None` adds bound graph/fixture checks afterward. Both are pure functions in the domain module; do not import ORM into core.

**Binding propagation/normalization corrections**
- Reuse/extract the native `_prepare_user_inputs` pure scalar validation/sanitization owner, preserving defaults, numeric conversion, NUL removal and dropping undeclared fields. Reject all raw nested/file/nonfinite values BEFORE this owner. Service prepares submitted+effective digests and passes the idempotent effective mapping to generator. Tests `number='41'` and omitted default assert worker binding accepts correct native values; changed effective mapping refuses.
- Worker reload App AND Workflow AND current account/tenant membership, then nonclaiming revalidate and one-time claim before any bootstrap. Native allocated run/task UUID is claimed without presenting it as persisted Run. Move Workflow load/snippet/restore/runner into caught queue-error lifecycle.
- Add actual tracing owner `api/core/ops/ops_trace_manager.py` and tests. Trusted restricted construction policy never resolves/decrypts/dispatches app-external providers, even its independent DB reload races enabled; preserve platform telemetry. Reject observed enabled tracing at each gate.
- Guard raw `_environment_variables`/`_conversation_variables` before first execution_revision and postflight `_bind_run/read_graph` if changed during execution. Actual `kind_or_standard`, root Start, call_depth0, empty entity files, correct app/user/account config; no restored runtime/single-node/container flags.
- Include recorder keyword in factory `from_graph_init_context` classmethod plus constructor/with_runtime_state. AppExecutionParams.new/dump/validate preserve marker. Celery marker gate BEFORE logging payload or initialization; `_resume_app_execution` gate immediately after get_generate_entity BEFORE reset/restore/trace. Ordinary None execution unchanged.
- Known prelaunch policy error returns Run with typed unsupported evidence/no native ID, not generic exception text. Implement typed result plumbing needed now; Task 4 handles shared routing/full seals.

- [ ] Write tests showing Build/Edit/Fix each passes real session/test-input identity, factory receives typed context, posted `args={'execution_mode': 'live_confirmed'}` never selects a live mode, normal DEBUGGER without Builder invocation keeps current behavior.
- [ ] Add tests that spy/fail on `file_factory.build_from_mappings`, `TraceQueueManager`, `ToolManager.get_workflow_tool_runtime`, OAuth refresh, environment key/secret resolution, trace-provider credential decryption, model construction and sandbox client. For restricted Chatflow/Agent/files/env/external tracing/unknown enabled feature, assert zero calls and no native Run ID.
- [ ] Add worker race tests at the actual `_generate_worker` reload boundary: swap graph from Start/End to Code/tool; change environment/features (spy on the environment secret/key provider too); change workflow tenant; alter input/fixture digest. Assert native runner/bootstrap/snippet mutation/trace work never occurs, queue publishes a policy error, stream terminates, and original graph is not executed under a stale context.

```python
# Use a barrier around the existing session.scalar reload in the worker test.
# prepare() has already captured revision A; release the worker with revision B.
worker_thread.start()
reload_barrier.wait()
replace_loaded_workflow_with_changed_revision()
continue_worker.set()
worker_thread.join(timeout=2)
assert not worker_thread.is_alive()
bootstrap_spy.assert_not_called()
runner_spy.assert_not_called()
queue_manager.publish_error.assert_called_once()
```

The barrier helper and mutation fixture belong to this test file and wrap the existing SQLite workflow fixture; they are tests of re-admission timing, not production synchronization.

- [ ] Run new tests to establish failures, then add early service admission before dispatch/file/trace setup and before `execution_revision` resolves environment secrets: inspect raw `_environment_variables/_conversation_variables` and raw app tracing JSON first; reject nonempty environment configuration, enabled tracing or malformed metadata without decryption, propagate through all overloads and typed entities, and revalidate in worker before `_ensure_snippet_start_node_in_worker`/restore/runner/bootstrap. Move policy failure into the existing caught queue-error lifecycle; never throw outside it and strand a stream.
- [ ] Reject restricted Celery, direct resume and single-node variants before reconstructing trace manager or restoring graph. Serialize/deserialize field in AppExecutionParams and entity; explicit marker cannot disappear through model validation. Preserve pause behavior for ordinary workflows.
- [ ] Add a class/binding assertion in runner and factory entry using actual native graph/IDs. Record/return unsupported prelaunch evidence with empty native ID. Keep session close before stream iteration and existing rate-limit release semantics.
- [ ] Run all targeted tests and existing run_draft/in-process tests. Commit the complete default-fence change; do not temporarily ship a context field that reaches live dependencies without Task 3 enforcement. Tasks 2–4 plus composed native persistence verification form one atomic Release A gate.

## Task 3: Native factory capability selection and HTTP fixture controls

**Files**
- Create `api/core/workflow/restricted_execution.py` (exact implementation registry, restricted HTTP/denied-file adapters).
- Modify `api/core/workflow/node_factory.py` (before eager live composition; before LLM reference resolution; per-node HTTP injection; preserve recorder/context on with_runtime_state).
- Modify pure `api/core/dify_builder/execution_policy.py` and focused policy tests only for strict bounded native HTTP scalar defaults/fixed optional UTF-8 Content-Type; objects/arrays/files remain unsupported.
- Create `api/tests/unit_tests/core/workflow/test_restricted_execution.py`.
- Create `api/tests/unit_tests/core/workflow/graph_engine/test_builder_restricted_native.py`; extend factory tests.
- Create test fixtures under `api/tests/fixtures/workflow/builder_restricted/`: `scalar.yml`, `http_text.yml`, `http_default_output.yml`, `code_increment.yml`, `template_greeting.yml`. Code/template fixtures are reserved for Task 5.

**Interfaces**
- `validate_restricted_node(*, context, node_id, node_class, resolved_node_data) -> None` compares concrete class and exact version/config before construction.
- `RestrictedHttpClient` implements all methods of `graphon.http.HttpClientProtocol`; shared private `_respond(method, url, kwargs) -> HttpResponse` is the sole path. It never wraps an SSRF/live client.
- `PolicyTransportError` is exposed through `request_error`; record denial then raise it, letting the native HTTP executor produce its real failure.

**Binding factory/HTTP corrections**
- `_validated_node_config` needs a restricted pre-validation callback: resolve raw type/version, reject explicit unknown/latest, verify exact class identity/version and raw normalized_config_digest BEFORE validate_node_data. Then check typed body/selectors and instantiate; forbidden class validate_node_data itself is a fail-on-call spy.
- Implement all six protocol methods and both error properties. Use a distinct PolicyTransportError for request_error, a separate never-used max-retry type; max-retry catch exposes URL. Reject OPTIONS. Runtime kwargs explicit type/finite/text allowlist with files empty; native max_retries=0 accepted; unknown kwargs denied.
- Raw auth config as well as typed no-auth; fixed literal Content-Type application/json/text/plain optionally charset=utf-8, no vars/auth/cookies. Native text BodyData only none/raw-text/json; no file/default ARRAY_FILES. Selectors bind admitted upstream outputs only. Explicit deny FileManager/FileReferenceFactory/ToolFileManager/factory. Adapter truthy/nonnullable, no live fallback.
- Fixture response uses fixed UTF-8 charset so Unicode body survives native parsing. Durable append before return; server observation/invocation IDs, immutable context/run/task/node/fixture binding. Failure poisons recorder shared with worker completion monotonically.

- [ ] Write forbidden-constructor tests for models/tools/Agents/unreviewed node classes, including a new class mapped to an old node type/version. Assert guard runs before `_resolve_llm_model_reference` and tool runtime/OAuth; no fallback constructors. Verify `with_runtime_state` retains exact context, fixtures and recorder even though containers are not admitted.
- [ ] Add an actual native harness in the new graph-engine test module. Follow `test_table_runner.py:151–246,316–360` for imports and bootstrap, but instantiate **DifyNodeFactory**, never MockNodeFactory. The harness returns real event objects and actual node instances; SQLite-backed recorder is the only Builder persistence test collaborator.

```python
factory = DifyNodeFactory(graph_init_params=params,
                          graph_runtime_state=state,
                          execution_recorder=recorder)
graph = Graph.init(graph_config=graph_config, node_factory=factory,
                   root_node_id='start')
engine = GraphEngine(workflow_id=params.workflow_id, graph=graph,
                     graph_runtime_state=state, command_channel=InMemoryChannel(),
                     config=GraphEngineConfig(min_workers=1, max_workers=1))
events = list(iter_dify_graph_engine_events(engine))
```

`params` uses `GraphInitParams` with `build_dify_run_context(builder_execution=context, ...)`; `state` uses real VariablePool and `add_node_inputs_to_pool`, as the existing table runner does. Use no model/provider/sandbox server in these unit controls.

- [ ] Native fixtures: `scalar.yml` is Start(text:string) → End(out=[start,text]); `http_text.yml` is Start(path:string) → native HTTP GET `https://sample.invalid/{{#start.path#}}`, no-auth, no body, empty headers/params → End(status=[http,status_code], text=[http,body]). Explicit labeled fixture body `{"sample":true}`/application-json/status 201 must produce actual native outputs `status=201`, `text='{"sample":true}'`, node event IDs start/http/end and a fixture receipt. The `.invalid` URL is never contacted. Missing fixture produces reached native failure plus blocked receipt. All external owners are fail-on-call spies.
- [ ] Verify dynamic URL resolves from Start before adapter receipt; adapter record uses HMAC, not URL. Invalid/wrong/stale fixture and response file payload rejects; no live fallback. A recorder DB failure prevents response return. Retried adapter invocations get separate observations but still zero outbound calls.
- [ ] Add native default-output fixture: configure HTTP native error strategy/defaults so the denied node yields actual End success/defaults and GraphRunPartialSucceededEvent(exceptions_count=1). Preserve partial status and blocked evidence; do not claim full native success. Add a GraphEngineLayer whose `on_node_run_start` raises: native Start/End still execute; denied HTTP still cannot dispatch. This proves hook callbacks are not the enforcement mechanism.
- [ ] Run new tests (initially fail); implement exact class/config registry, per-run restricted factory branch and transport adapters. Supply denied file collaborators for HTTP. Text fixtures go through native response parsing, no fabricated NodeRunResult.

```python
# Inside RestrictedHttpClient._respond, after runtime argument validation:
if fixture is None:
    recorder.record(blocked_observation)
    raise PolicyTransportError('execution_policy: fixture_missing')
recorder.record(fixture_observation)
return HttpResponse(status_code=fixture.status_code,
                    headers={'content-type': fixture.content_type},
                    content=fixture.body.encode('utf-8'), url=url)
```

- [ ] Run new native harness tests plus both existing node-factory suites and HTTP executor tests. Check no Graphon lockfile/version delta. Commit and review; no runtime deployment until Task 4 authoritative sealing/publication and composed native evidence pass.


**Accepted exact Task3 handoff:** original raw graph binding and actual resolved class guard precede concrete validation; native BaseNodeData adapts only by model_dump(mode="json",by_alias=True,exclude_unset=True). Private fresh32byte request-HMAC key per run is retained by runtime clones, never persisted/client-selected/logged. HTTP scalar default numeric overflow is a typed refusal; fixed Content-Type equivalents have aligned admission/runtime allowlists. Actual denied default-output run is partial-succeeded with End outputs and blocked receipts, not full native success.

## Task 4: Honest sealed results, no repair loop for denials, publication guards

**Files**
- Modify `api/core/dify_builder/models.py`, `contract.py`, `verification.py`, Build/Edit/Fix handlers.
- Modify existing `api/services/dify_builder/execution_policy_service.py` for seal; `api/core/dify_builder/execution_policy.py` for frozen trusted completion; native `api/core/app/apps/workflow/app_generator.py` only for the precise outer-finally completion callback. Modify `dify_port.py`, `repository.py`, `serde.py`, `run_mapping.py` where evidence attachment is owned.
- Extend worker/port lifecycle tests `test_builder_execution_admission.py`, `test_native_execution_admission.py`, `test_dify_port.py`. Create CI-only `api/tests/test_containers_integration_tests/core/workflow/test_builder_restricted_native.py` and neighboring `test_builder_execution_policy_persistence.py` now, using the existing real container fixture owners.
- Extend `api/tests/unit_tests/services/dify_builder/test_run_mapping.py`, `test_serde.py`, `test_engine_on_sql_repo.py` and `api/tests/unit_tests/core/dify_builder/test_verification.py`; create `api/tests/unit_tests/core/dify_builder/test_execution_evidence.py`.
- Create scoped `.github/workflows/builder-safe-execution-tests.yml` for CI-owned new native/PG gates, then extend its actual-sandbox job in Task 6. Trigger on authorized `build/dify-builder` pushes (narrow paths) and workflow_dispatch, read-only contents permission; no fake provider/service credentials.

**Interfaces**
- `RunVerification.execution_evidence: ExecutionEvidenceSummary | None` defaults to None for old records without backfill.
- `TestResultCard` carries mode/safety outcome and simulated/blocked IDs additively; native status unchanged.
- `is_execution_policy_blocker(run: Run) -> bool` is shared across Build/Edit/Fix and publication.
- Outcomes: `unsupported_safe_execution`, `execution_blocked`, `simulation_completed`, `restricted_execution_completed`, `execution_evidence_unknown`, `native_failed`.

**Binding seal/result corrections and composed gate**
- Add on_worker_finished to the existing transient admission protocol: keyword context/native_run_id/task_id/recorder/actual worker_thread/exit_kind. Native outer-finally runs after runner, active task, DB and Flask context cleanup; callback is a one-shot candidate with no SQL/I/O/queue or policy authority. Claim identity captured before recorder construction. Same holder lock synchronizes refusal/claim/candidate and finalization_closed, never across service calls. After existing response close/bounded join, freeze one snapshot requiring the captured actual Thread dead and identical healthy recorder. Missing/invalid/still-live means unknown, no late upgrade or second wait; Thread stays transient. Completion contains frozen context/claimed ID pair, strict worker_finished/recorder_healthy/response_completed, worker_exit and typed refusal only.
- Iterator/callback/setup/close failures finalize unknown where storage is available and preserve the primary exception/cancellation. Existing300s join is sole wait owner; do not assume its discarded return proves completion. Known synchronous preworker typed refusal or actually returned acknowledged pre-native policy refusal may seal unsupported, no public allocation-only native ID.
- Complete Task 1 state owner with `seal(*, request_id, completion: TrustedExecutionCompletion) -> ExecutionEvidenceSummary`. Frozen trusted completion carries claimed run/task/context and actual worker-finished acknowledgment/recorder healthy; never caller native status. Query actual full-owner WorkflowRun and node rows. Compare persisted native graph, ID, terminal status, executed IDs and per-reached-capability receipts. Missing completion, recorder failure, native rows or receipts = unknown. No receipt-free HTTP graph can become pure scalar. Identical fingerprint replay idempotent; conflicting replay/append sealed row rejects.
- Unknown-first matrix: incomplete response/worker/recorder/owned native row/node chain/reached receipt evidence => execution_evidence_unknown retaining blocked IDs. Complete native failed/stopped/partial-succeeded => native_failed; complete succeeded+blocked => execution_blocked; complete fixture success => simulation_completed; complete actual scalar success => restricted_execution_completed. Any blocked IDs independently trigger typed blocker before diagnosis/repair/publication. Actual native default-output case asserts partial-succeeded plus blocker; succeeded+blocked unit matrix is separately labeled defensive.
- Canonical native reads validate full tenant/app/workflow/actor/account role/debugger/draft Run owners, persisted graph, effective-user inputs projection excluding actual sys.* convention, terminal finished/status/stats, native node row/execution identities and chain/step/retry coverage plus reached receipts. No task-id native column, caller status/executed list or forced sync repository. Deterministic fingerprint includes missing facts and ordered receipts; conflicting/late evidence cannot upgrade sealed unknown.
- Outcomes include native_failed and exactly the binding spec matrix. Extend PublicationDecision.reason Literal with execution_policy_blocked/execution_evidence_unknown/simulation_only/execution_provenance_unbound. Guard all service release/recovery and handler publication owners plus existing revision/output checks, not just cards. Typed blocker before output review/diagnosis, never substring matching.
- Override the global integration SSRF200 convenience fixture with failing live-owner spies; assert synchronous SQL repository configuration in actual native positives. Actual worker delayed after acknowledgment, wrong/conflicting/late callback, poison and lifecycle-close controls must prove no false completion.
- Move actual composed scalar+HTTP positive controls from Task 6 into THIS gate: real port→AppGenerateService→generator→worker→runner→native factory/GraphEngine→native persistence, real run/node rows and sidecar. Full DB/Redis test owners in CI; no invented generator event stream. Add CI PG duplicate-claim/append race and migration upgrade/downgrade tests; SQLite isn't production locking proof.
- Add negative replay/context, authenticated/file/class-replacement, fallback native-success blocked receipt, retry/recorder poison, trace-enable race, effective input/default, stale fixture submit/reuse, resume/Celery and ordinary regression controls. Root performs actual local/Dev E2E + screenshots once reviewed deploy is ready, with honest unimplemented Code capability gate and ENG-1183 still open.

- [ ] Tests cover native success+blocked receipt; native success+fixture; unsupported prelaunch without native ID; incomplete stream/request; zero/missing native node evidence; older unknown mode; full revision changed; foreign session; valid restricted scalar. Assert no native/historical row gets rewritten and existing published version is untouched.

```python
assert native_run.status == 'succeeded'
assert result_card(builder_run).safety_outcome == 'execution_blocked'
assert not publication_decision(builder_run, session_id=session_id,
    current_revision=revision, current_graph_revision=graph_revision).allowed
agent.diagnose.assert_not_called()  # blocked policy is not a business-code bug
```

- [ ] Run to establish failure; implement service seal/bind after native result consumption. Require sealed provenance and native linkage for eligible current tests; an unknown/missing observation record stays unknown. Protect session transaction lifetime and stream closure paths.
- [ ] Wire shared blocker handling before success/repair branches in all three handlers; present existing review/input return action with a reason. Do not emit an L2 approval card whose binding semantics do not exist. Keep draft intact.
- [ ] Additive serialization/API tests: retain native status and IDs, round-trip typed evidence; old Run verification JSON reads as unknown provenance. Regenerate backend schema only if the actual endpoint's schema source changes, following API_SCHEMA_GUIDE; frontend contract/display gap is recorded without source edits.
- [ ] Run targeted Builder tests and native harness tests. Commit only after Task 2–3 enforcement tests also pass. Release A review explicitly states PRD §9.1 remains partial.

## Task 5: Per-run network-disabled Code/template adapters (kept unavailable by default)

**Files**
- Modify `api/core/helper/code_executor/code_executor.py`, `api/core/workflow/template_rendering.py`, `api/core/workflow/node_factory.py`, `api/core/workflow/restricted_execution.py`, existing CodeExecutionSandboxConfig in `api/configs/feature/__init__.py`.
- Extend `api/tests/unit_tests/core/helper/code_executor/test_code_executor.py`, `api/tests/unit_tests/core/workflow/test_node_factory.py`, `test_restricted_execution.py`, `graph_engine/test_builder_restricted_native.py`.
- Add backend profile documentation alongside existing sandbox config documentation; no compose/runtime deployment change in this task.

**Interfaces**
- `CodeExecutor.execute_code(language, preload, code, *, enable_network: bool = True) -> str`.
- `CodeExecutor.execute_workflow_code_template(language, code, inputs, *, enable_network: bool = True) -> dict[str, Any]`.
- `DefaultWorkflowCodeExecutor(*, enable_network: bool = True)` and `CodeExecutorJinja2TemplateRenderer(*, enable_network: bool = True)` use instance state.
- Server config admits exact profile only after Task 6 evidence. Until then profile defaults disabled; per-language eligibility list is server-owned and cannot come from Builder action payload.

**Binding sandbox readiness and per-instance endpoint**
- Add a typed server-owned SandboxCapabilityReceipt binding actual endpoint identity, immutable image/platform/config/dependency/network/resource digests, verified language cases and trusted CI/deployer proof/expiry. Exact profile/receipt current deployment match required at prepare, worker and invocation; absence/expired/drift/unsupported language denies BEFORE RPC. No user-set verified flag, bare named profile or copied digest is proof. Follow existing config owner with optional dedicated endpoint policy per adapter, never global code_execution_endpoint_url mutation.
- Native CodeNode `graphon.nodes.code.code_node.CodeNode` and TemplateTransformNode `graphon.nodes.template_transform.template_transform_node.TemplateTransformNode`, exact v1, same linear graph restriction. Each native collaborator wrapper records sandbox_started and completed/failed attempts with nonsecret input/code/profile digests, no direct second executor. Shared recorder poison and complete start/finish receipts required.
- Ordinary defaults True and endpoint unchanged. Restricted endpoint False only after actual receipt. Do not enable profile on mocked transport tests or source inspection.

- [ ] Write failing tests of final sandbox request JSON for ordinary=True and restricted=False for Python/JavaScript/Jinja; both helper entry points and template adapter must forward. Test parallel ordinary and restricted calls do not leak policy across instances; no global mutation.
- [ ] Verify default profile rejects Code/template before RPC and records unsupported. Explicit invalid/unknown profile stays blocked. Native factory supplies the false-configured adapter only for a verified profile and records sandbox_started before RPC; record failed/completed afterward without pretending infrastructure errors are policy success.
- [ ] Implement minimal keyword propagation, preserving ordinary default and native code limits/output schema.

```python
# Existing HTTP request stays in CodeExecutor; only policy propagation changes.
data['enable_network'] = enable_network
# Dify's injected restricted adapter:
return CodeExecutor.execute_workflow_code_template(
    language=language, code=code, inputs=inputs, enable_network=False)
```

- [ ] Add native unit controls using actual CodeNode/TemplateTransformNode and a sandbox transport response fixture to assert transformation/output schemas and forwarding. Label them **transport contract tests**, not proof of code execution/isolation. Invalid code output type must fail native schema validation. Do not replace native nodes or execute code in a test-only competing executor.
- [ ] Run targeted unit tests and ordinary Code/template regressions. Commit with capability disabled. Task 6 is required before enabling any sandbox profile.

## Task 6: Actual native positive controls and sandbox conformance gate (CI only)

**Files**
- Create `api/tests/test_containers_integration_tests/core/workflow/test_builder_restricted_native.py`.
- Create `api/tests/test_containers_integration_tests/core/helper/test_builder_sandbox_isolation.py` and scoped test-owned canary fixtures/config.
- Reuse `.github/workflows/api-tests.yml:206` api-integration setup/`--start-middleware` owner via the scoped builder-safe-execution workflow introduced in Task 4; changes must be scoped to the new native/sandbox conformance gates/config. Do not treat AgentRuntime sandbox CI as this owner. Integration pytest stays CI-owned; root conducts explicitly authorized actual local/Dev E2E after review, preserving ordinary services.

**Interfaces**
- Existing native `DifyWorkflowPort.run_draft` plus admitted server profile; no new executor.
- CI provides the sandbox immutable artifact/config digest, local canary addresses and test-scoped DB/Redis/storage. Release capability evidence records these exact identities.

**Actual sandbox upstream and release gate**
- Current source 0.2.15 commit5631afef06ec88f80c28129aec7fd22a30006b14 DOES honor per-request False, but stdout/stderr collectors are unbounded and deploy has no complete request/resource proof. Inspect separate langgenius/dify-sandbox owners: internal/core/runner/output_capture.go, service collectors, Python/Node bootstrap/seccomp, dependency/UID-root cleanup. Add a scoped backend child issue if necessary; implement/review/test/release/pin required sandbox fixes under the same user authorization, never claim disabled adapters complete parent.
- Prefer a dedicated pinned restricted sandbox if shared ordinary endpoint cannot satisfy policy. Global network false, preload false, syscall override absent; immutable dependencies/config; no business host mounts/secret env; actual isolation network/resource controls. Image digest alone insufficient when dependencies/config drift. Existing AgentRuntime sandbox CI is a different owner, not proof for CodeSandbox.
- Complete Python/JS/Jinja native positives/invalid schema and controlled canaries: TCP/UDP/DNS/HTTP/HTTPS/IPv4/6/proxy/redirect/loopback/private peers, observer-positive control then zero restricted hits; serial/parallel neighbor/files/secrets/cleanup/UID reuse; process spawn/signals/orphans; measured CPU/time/memory/PID/stdout/stderr/input/concurrency limits with healthy recovery. Report failed/skip as unavailable per language; unknown bounds cannot pass.
- CI/deployer trusted receipt records exact source/build/platform/config/dependency/interpreter/network/mount/resource/test revision and run evidence, expiry/revocation, language cases. Never raw secrets/environment dumps. Actual endpoint deployment attestation and drift gate mandatory. Root enables only matching verified restricted deployment; records all unsupported remaining PRD surfaces truthfully.
- After reviewed useful Code/template is available, root verifies actual local + Dev native E2E/pods/source, uploads screenshots + machine evidence and updates ENG-1183 to In Review. Then ENG-1184 starts; no frontend tickets until1184–1188 gates also pass.

- [ ] Extend the composed native owner test introduced and passed in Task4, invoking actual port → AppGenerateService → WorkflowAppGenerator → runner/factory/GraphEngine → WorkflowPersistenceLayer. Allow DB/Redis test infrastructure; deny live external transports at their actual owners. Assert real persisted WorkflowRun graph/status, real node rows and Builder sealed linkage; do not patch the generator into an invented event stream.
- [ ] Execute actual sandbox positive controls through native full workflows: Python `def main(n): return {'result': n + 1}` with 41 → 42; JavaScript equivalent; Jinja `Hello {{ name }}` with Ada → Hello Ada. Assert request enable_network=False and native execution rows. Invalid output type fails natively. Non-Builder control retains existing request default True in an isolated test sandbox.
- [ ] Add network attacks against local canaries: raw TCP, HTTP/HTTPS, DNS and UDP; configured HTTP_PROXY/HTTPS_PROXY, redirects and loopback/private-network targets. A canary must prove it can observe an allowed test request, then observe zero restricted egress; a time-out alone is not sufficient evidence. Sandbox compute must still complete for positive controls so “sandbox unavailable” cannot masquerade as isolation.
- [ ] Add host/neighbor-file read/write and inherited-secret probes with test-only sentinels; check isolation and cleanup across requests. Add CPU deadline, memory and output-bound probes under the exact deployment profile. Record profile failures by language.
- [ ] Run in CI, capture immutable sandbox image/config digest and test results. Do not enable the server capability if any conformance case fails or was skipped. If existing 0.2.15 does not enforce request False, leave capability disabled and raise a separately scoped dify-sandbox owner change for `/v1/sandbox/run` network/filesystem/process isolation; pin a verified release afterward. No Graphon update is needed for existing protocols.
- [ ] Root reviews conformance and chooses whether/where to enable that verified deployment profile. This task produces readiness evidence, not an automatic production deploy. State which languages are supported and list still-blocked nodes. Publish/release notes must not claim all PRD Mock/consent requirements are complete.

## Final verification and handoff

- [ ] Self-review global constraints and each review focus; run targeted changed-owner tests, changed-file lint/type checks using repository-supported commands. Broaden to required `make lint`/`make type-check` as branch gate; do not repeat unchanged tests without cause.
- [ ] Confirm ordinary native execution regressions, immutable historical records, blocked unknown provenance, graphon pin unchanged and no frontend files changed.
- [ ] Root runs the current mandated whole-branch review after implementation; preserve the user's chosen execution/review method. This design worker does not create helper agents.
- [ ] Report Release A as a restricted subset. Complete Release B with verified sandbox conformance before closing ENG-1183; unavailable B remains open. Leave live account/target/params consent blocked and list deferred Chatflow/Agent/file/model/tool support explicitly.

## Fixed execution sequencing

- Release B follows A immediately because common Code workflows are essential. Do not merge subset and parent acceptance claims.
- Fixture backend ingestion is included through the existing authenticated test-data action. Frontend authoring/display is recorded until the full backend roadmap/Dev API gate, never implemented in this plan.
- A deployment without verified sandbox identity cannot enable the Code/template capability. The source-local adapters are feasible; deployed isolation remains an external evidence gate.

Executable self-review: all spec safeguards have task ownership, five Review Focus cases have concrete tests, interfaces are named, unknown runtime capabilities default to denied; all six task owners and shared interfaces were checked in the ledger. No product tests or sandbox conformance were run while writing this plan.
