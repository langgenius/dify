# Builder New Agent Native Testing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Include published Workspace New Agents in Builder's first complete native Workflow acceptance, with real bindings and resumable authorization at their actual execution boundaries.

**Architecture:** Keep Graphon and the existing Pydantic AI runner as execution owners. The API owns authorization, effect records and root lifecycle; the standalone Agent backend owns its versioned wire DTOs, pending calls, history and physical runtime operations. A typed API adapter connects them without importing API modules into `dify-agent`.

**Tech Stack:** Python, Pydantic v2, SQLAlchemy, Flask-RESTX, FastAPI, Redis, native Pydantic AI capabilities/deferred tools, Graphon 0.7 series, pytest, repository Cucumber/Playwright.

**Spec:** `docs/superpowers/specs/2026-10-14-builder-unified-native-testing-design.md`, approved by the user after its written review; source baseline `13368bd5fa91a613c65ccc1bd328fcadac732cf2`.

## Global Constraints

- This document is a plan; authoring it runs no tests, imports, services, network calls, CI, deployment or ticket changes and makes no product changes.
- ENG-1177, ENG-1196 and ENG-1184 share this lane; ENG-1117 stays paused. No frontend implementation or new public Console routes in this lane.
- No API-owned SQL models/migrations here: the coordinator owns shared contracts, authorization, lifecycle, durable result storage and public API schemas.
- `api/core/` is migration-only: adapt existing callers; add services under existing domain owners or `api/services/dify_builder/native_testing/`.
- Use the installed Graphon **0.7.0** baseline and compatible published extensions; never edit `.venv` or substitute the 0.6 sibling checkout.
- All commands below are execution-time commands for a qualified Linux checkout or normal CI, never this planning session. API container integration tests are CI-only.
- API commands use `uv run --project api`; Agent commands use the package's `uv` environment. Run only one repository E2E process at a time.
- Metadata discovery never decrypts credentials, refreshes OAuth or invokes models/tools. Missing authentication remains bindable with needs-setup status.
- No node-type test allowlist, per-plugin source audit or manual plugin admission list. Disclose opaque internal behavior and authorize a concrete bounded invocation.
- No secret values in plans, receipts, events, screenshots or traces. Durable execution state is separate from redacted evidence and excludes credential/config snapshots.
- Runtime resources are acquired/released by native `wrap_run` owners; serialize stable identities, never a `RuntimeLease`, client, bearer token or Python generator.
- Waiting is visible only after durable checkpoint acknowledgement. Claims are atomic, I/O occurs outside DB transactions, and uncertain dispatch never automatically retries.

## Frozen Shared Interfaces and Ownership

- Consume `api/services/dify_builder/native_testing/contracts.py`: `NativeTestContextRef(policy_version='builder-native-test-v1', request_id, invocation_id, context_digest)`.
- Consume `OperationKey(invocation_id, occurrence_path: tuple[str, ...], cursor: int)`; preserve its identity across resume, worker delivery and Agent output retries.
- Consume `EffectIntent(key, kind, resource_ref, implementation_revision, account_ref, target, parameters, input_digest, capability_digest)`.
- Consume `authorization.py`: `EffectAuthorizationService.before_call(*, ref, intent) -> DispatchPermit | ApprovalWait | RecordedResult | PolicyStop`; `record_outcome(*, permit, outcome, result_ref) -> EffectReceipt`.
- Mirror C01 `ApprovalWait.wait_reason: Literal['approval', 'configuration', 'interaction'] = 'approval'` and `WaitingReceipt.wait_reason` without collapsing the categories. Pending actions retain durable configuration/native-form references; a decision applies only to approval.
- Consume `lifecycle.py`: `NativeTestLifecycleService.pause(*, ref, checkpoint, pending_operation_ids, expected_generation)`, `resume(*, actor, request_id, expected_generation, idempotency_key)`, `cancel(*, actor, request_id, idempotency_key)`.
- Consume native lane NW1's `runtime_contracts.py` typed `NativeStatePort`/`ChildInvocationPort` and `NativeControlBridge.resolve`; coordinator C03 implements their persistence/lifecycle adapters. Child `get_or_create` carries `input_result_ref: str` with `input_digest`; a digest alone cannot resume inputs.
- Consume coordinator C03's implementation in `api/services/dify_builder/native_testing/state_store.py`: `store_result(*, ref, key, result: JsonValue) -> str`; `load_result(*, ref, result_ref) -> JsonValue`. NW1 owns its native port contract; Agent pending/history/results remain Agent-owned and are mapped by reference.
- Consume NW2's separate server-owned `native_test_required`/`native_test_ref` fields; marker-without-ref stops before Agent assembly. Do not add native refs to the existing three-v1 `builder_execution` union or change its decoder.
- `before_call` atomically spends/reserves the shared dispatch permit. An in-flight duplicate cannot get another permit; endpoint adapters validate the same permit instead of calling `before_call` as a new operation.
- This lane owns private `api/controllers/inner_api/agent/native_testing.py`, Agent-specific services, Agent package changes and `resources.py` Agent additions. Root sequentially applies A1's Agent-specific `node_policy.py` adaptation alongside broader native policy integration; no two agents own that file concurrently.
- Native lane NW2/NW7 owns `dify_port.py` draft transaction/runtime integration; root schedules its single writer. Coordinator owns shared domain policy/lifecycle and NW owns common inner effect guards. A3/A5 supply explicit call envelopes and adapters; credential/OAuth owners are handed off sequentially, never edited concurrently.

## Review Focus

1. Published roster changes between discovery/apply/start: reconfirm effective drift; paused execution retains its original snapshot/Home (A1/A5).
2. Old or incompatible Agent backend: fail before model, tool, eager retrieval, config pulls or bootstrap I/O; ordinary runs retain their contract (A2/A6).
3. Tool declaration building with expired OAuth: metadata remains inert, and missing credentials yield configuration waiting without broadening authorization (A3/A6).
4. Restart during pending tool/stdin or checkpoint persistence: resume the same operation/job, or report unavailable/unknown; never recreate an effect (A2/A4/A5).
5. Opaque plugin or script changes: expose uncertainty and exact capability scope; changed relevant input/dependency/identity invalidates pending approval without plugin allowlists (A3/A6).

## Read Before Implementation

Read root/API/Agent scoped `AGENTS.md`, `api/controllers/API_SCHEMA_GUIDE.md`, and the actual package-local runtime contract `dify-agent/docs/dify-agent/index.md` plus `concepts/run-lifecycle/index.md` and shell/plugin/execution-context manuals. The package-local path resolves the Agent guide's `docs/dify-agent/index.md` reference.

The in-repository Go owner is `dify-agent-runtime/`; no nearer `AGENTS.md` exists there, so root instructions apply. Its actual local primitives are SQLite/tmux jobs and Landlock V1 paths; runner isolation failure currently warns and continues. They do not provide per-test network/cgroup scope today. A7 is required implementation, not a qualification check that can leave every backend unavailable.

Dependency source inspected read-only during planning: installed `pydantic_ai/capabilities/abstract.py` exposes `before_tool_execute` deferral; `_deferred.py` exposes `DeferredToolRequests`/`DeferredToolResults`; `agent/abstract.py` accepts `deferred_tool_results`. Recheck the implementation environment's locked dependency before coding; do not invent framework pause APIs or claim a mocked runner proves them.

## Concrete Wire and Execution-State Contract

Create these DTOs in A2's standalone `protocol/native_testing.py`; API adapters import those DTOs, never the reverse. UUID syntax follows existing public Agent identifiers; this sketch retains strings to show the actual reference fields.

```python
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field

class AgentNativeTestRef(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, hide_input_in_errors=True)
    policy_version: Literal["builder-native-test-v1"]
    request_id: str = Field(min_length=1)
    invocation_id: str = Field(min_length=1)
    context_digest: str = Field(min_length=1)

class ContinueRunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, hide_input_in_errors=True)
    ref: AgentNativeTestRef
    expected_generation: int = Field(ge=0)
    idempotency_key: str = Field(min_length=1)

class AgentApprovalWait(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, hide_input_in_errors=True)
    kind: Literal["waiting"] = "waiting"
    pending_operation_id: str = Field(min_length=1)
    wait_reason: Literal["approval", "configuration", "interaction"] = "approval"
```

| Agent-owned record | Required durable fields and invariant |
| --- | --- |
| `AgentPendingCall` | Native call ID, final typed target/arguments, operation key, stage, fingerprints and pending-action ID/reason; durable action owner resolves its configuration/form references; never credential values |
| `AgentCheckpoint` | Same ref and pinned config digest, generation, native history/messages, pending call set, completed result refs, operation cursor and shell job refs |
| `AgentResultStore` | `store(*, ref, key, result: JsonValue) -> str` and `load(result_ref: str) -> JsonValue`; ownership check and bounded protected payload, separate from audit receipt |
| `NativeContinuation` | `capture(*, result, deps) -> AgentCheckpoint`; checkpoint exposes `waiting_event() -> RunWaitingEvent`; checkpoint must commit before event publication |
| `NativeEffectDispatcher` | `invoke_permitted(*, permit, intent, invoke) -> JsonValue`; invoke once outside SQL, persist result before success receipt, record unknown on ambiguous completion |
| `NativeApprovalSuspended` | Carries pending-operation ID and wait_reason; pre-tool capability preserves them through native deferral metadata, while stage boundaries produce the same structured wait |
| `NativePolicyStopped` | Carries a machine reason; terminates the marked test invocation tree and never becomes retryable model text |

The independent decision wire mirrors C01's exact discriminants: `DispatchPermit.kind='dispatch'`, `ApprovalWait.kind='waiting'`, `RecordedResult.kind='recorded'`, `PolicyStop.kind='stop'`; stopped reason field is `reason_code`. API bridge maps every permit/receipt field explicitly. Ref decoding is structure validation, not authorization; only the shared stored owner loader grants authority.

Wire `EffectIntent.target` and `parameters` retain complete typed `JsonValue`, including arrays/booleans and canonical file references, with secret values represented only by references. Do not substitute a display string, digest or truncated public summary for executable arguments. `run_waiting`, backend checkpoints, API control and C03 receipts preserve the same wait_reason and durable pending-action reference through restart.

Private API routes are `POST /inner/api/agent/native-testing/before-call`, `/outcome`, and `/materialize`. Register through `api/controllers/inner_api/agent/__init__.py`; apply existing `agent_inner_api_only`, explicit Pydantic parsing and response schemas. They are service-only adapters; coordinator's authenticated public approval action is the sole source of human decisions.

Backend continuation receives the same trusted ref plus expected generation and scheduling idempotency key. Before scheduling it, the private API adapter resolves the API's approved/denied state through C01/C03; a native `ToolApproved` object is framework continuation input, never the authorization record. Backend capability response and each create/continue request independently enforce protocol v1.

Keep ordinary `SessionSnapshot` migration unchanged: do not put pending authorization or current configuration into a legacy snapshot and assume it is trusted. Native-test continuation uses its own versioned protected checkpoint plus the existing state snapshot; both must match the pinned generation. Configuration references reload immutable verified content, not the latest roster draft.

### Task A1: Permission-filtered Agent catalog and native binding guard (ENG-1177)

**Files:** Create `api/services/agent/access_service.py`, `api/services/dify_builder/native_testing/agent_catalog.py`, `agent_binding.py`, and `api/tests/unit_tests/services/dify_builder/test_native_agent_catalog.py`, `test_native_agent_binding.py`. Modify `api/controllers/common/agent_access.py`, `api/services/dify_builder/agent/{resources,build,graph_translate,graph_prompt}.py`, `api/services/dify_builder/node_policy.py`; adapt existing `api/core/workflow/nodes/agent_v2/binding_resolver.py` only through the new service. Add CI integration `api/tests/test_containers_integration_tests/services/test_builder_agent_binding.py`.

**Interfaces:** Consumes C01 frozen reference types and native Agent publication/binding owners. Produces `PublishedAgentCandidate` (agent/snapshot IDs, display version, name/description/capability, dependencies, permission facts, schema provenance); `AgentCatalogService.list_candidates(*, tenant_id, actor_id, app_id, query) -> list[PublishedAgentCandidate]`; `AgentBindingService.prepare_node(*, actor, workflow, node_id, selection, node_job) -> dict[str, JsonValue]`; `require_selected_snapshot(*, selected_snapshot_id: str, effective_snapshot_id: str) -> None`, raising `AgentSnapshotChanged` with non-sensitive replacement metadata.

`selection` is a validated `AgentBindingSelection(agent_id, snapshot_id, capability_digest)`; `node_job` is native `WorkflowNodeJobConfig`. `prepare_node` returns native v2 graph data for NW2/NW7's bounded draft transaction, using `WorkflowAgentPublishService.sync_agent_bindings_for_draft`; it does not commit a second independent binding transaction. `PublishedAgentCandidate` is an internal actor-conditioned projection, not a new public response schema: any exposed resource fields must use their existing schema owner and coordinated generated contracts, without inventing permission/readiness fields in public JSON.

- [ ] **A1.1 Red:** Write snapshot-drift and metadata-provenance tests; create synthetic rows for published, unpublished, archived, other-tenant and actor-inaccessible Agents in the CI integration file. Use native RBAC/publication filters and real SQL, not a mocked list that already filtered the prohibited rows.

```python
def test_active_roster_drift_requires_reconfirmation():
    with pytest.raises(AgentSnapshotChanged):
        require_selected_snapshot(selected_snapshot_id="snapshot-3", effective_snapshot_id="snapshot-4")
    require_selected_snapshot(selected_snapshot_id="snapshot-3", effective_snapshot_id="snapshot-3")
```

- [ ] **A1.2 Red command:** Qualified Linux: `uv run --project api python -m pytest api/tests/unit_tests/services/dify_builder/test_native_agent_catalog.py api/tests/unit_tests/services/dify_builder/test_native_agent_binding.py -q`; expect missing services/failed drift assertion. Normal CI additionally runs `uv run --project api python -m pytest api/tests/test_containers_integration_tests/services/test_builder_agent_binding.py -q`.
- [ ] **A1.3 Implement:** Extract existing Agent visibility resolution into `services.agent.access_service` and retain controller imports as callers. Combine actor membership/access with `AgentRosterService.list_invite_options` publication/model filters before pagination; recheck app-edit and Agent reference access during apply/start/resume. Derive capability text from published state, never draft state or secrets. Keep source failure distinct from an empty matching catalog.

Project only declared public capability/schema/dependency fields from the published snapshot; never send Soul env values, credential refs with private details, hidden runtime parameters or contact configuration to the planner. Catalog permission/readiness is descriptive; runtime resolves and rechecks authority from current server state.

```python
def require_selected_snapshot(*, selected_snapshot_id: str, effective_snapshot_id: str) -> None:
    if selected_snapshot_id != effective_snapshot_id:
        raise AgentSnapshotChanged(effective_snapshot_id=effective_snapshot_id)
```

- [ ] **A1.4 Implement native mapping:** Emit `{"type": "agent", "version": "2", "agent_node_kind": "dify_agent", "agent_binding": {"binding_type": "roster_agent", "agent_id": selection.agent_id, "current_snapshot_id": selection.snapshot_id}}` plus native task/output fields. Validate both input selectors and declared output selectors/types with existing native validators; preserve complete tenant/app/workflow/version/node ownership.
- [ ] **A1.5 Implement honest schemas:** Input declarations come from published Soul `app_variables` and caller inputs. Soul has no reusable first-class output schema: expose `output_schema=None` with `output_contract_source='node_job_required'` when absent. Persist the contract example below as native node-job declarations; do not claim it was published by the Agent.

```python
node_job = WorkflowNodeJobConfig.model_validate({
    "declared_outputs": [
        {"name": "risks", "type": "array", "array_item": {"type": "object"}},
        {"name": "summary", "type": "string"},
    ],
})
assert [item.name for item in node_job.declared_outputs] == ["risks", "summary"]
```

- [ ] **A1.6 Green:** Rerun A1.2 commands; assert draft graph and native binding roll back together, changed start snapshot dispatches zero calls, existing paused binding remains pinned, missing tool credentials stay discoverable/bindable, and only New Agent's first-phase prohibition is replaced by real binding admission. Run existing `test_resources.py`, `test_node_policy.py`, `test_build_cognition.py` and native binding resolver tests.
- [ ] **A1.7 Commit when executing:** `git add api/services/agent/access_service.py api/controllers/common/agent_access.py api/services/dify_builder/native_testing/agent_catalog.py api/services/dify_builder/native_testing/agent_binding.py api/services/dify_builder/agent api/services/dify_builder/node_policy.py api/core/workflow/nodes/agent_v2/binding_resolver.py api/tests/unit_tests/services/dify_builder/test_native_agent_catalog.py api/tests/unit_tests/services/dify_builder/test_native_agent_binding.py api/tests/test_containers_integration_tests/services/test_builder_agent_binding.py`; `git commit -m "feat(builder): bind permitted published Workspace Agents"`.

### Task A2: Versioned Agent wire protocol and durable pending continuation

**Files:** Create `dify-agent/src/dify_agent/protocol/native_testing.py`, `runtime/native_continuation.py`, `tests/local/dify_agent/protocol/test_native_testing.py`, `tests/local/dify_agent/runtime/test_native_continuation.py`, `tests/local/dify_agent/storage/test_native_continuation_store.py`. Modify existing `protocol/{schemas,__init__}.py`, `client/_client.py`, `runtime/{runner,run_scheduler,event_sink}.py`, `storage/redis_run_store.py`, `server/{schemas,app}.py`, `server/routes/runs.py`, `layers/history.py`, and `docs/dify-agent/concepts/run-lifecycle/index.md`.

**Interfaces:** Independent wire `AgentNativeTestRef` has exactly policy_version/request_id/invocation_id/context_digest. `NativeTestCapabilities(protocol_version=1, features: frozenset[str])`; `require_native_test_capabilities(capabilities) -> None`; `AgentCheckpoint(generation, ref, stage, pending_calls, history, operation_cursor, result_refs, job_refs, config_digest)`; `ContinueRunRequest(ref, expected_generation, idempotency_key)` contains no user-supplied decision or fresh execution arguments.

Produce private `GET /runs/capabilities`, `POST /runs/{run_id}/continue`, structured `run_waiting`/`run_resumed` events and waiting status. `RedisRunStore.persist_waiting(*, run_id, checkpoint, event)` atomically stores checkpoint/event/status; `claim_continuation(*, run_id, expected_generation, idempotency_key)` returns the existing scheduling claim for duplicates. `NativeTestProtocolUnsupported` is a stable local/wire capability error. Native testing protocol v1 is independent of composition `schema_version=2`; ordinary requests remain compatible.

- [ ] **A2.1 Red:** Test exact independent DTO serialization, unknown versions/extra fields, mode/ref mismatch and capabilities. Add a real FastAPI/HTTPX adapter contract test that starts no runner when capabilities are missing; counters cover model/tool/eager/config/bootstrap boundaries. Native capabilities must include `pending-call-v1`, `policy-gate-v1`, `test-scope-v1` and `child-continuation-v1`.

```python
def test_old_backend_cannot_start_native_test():
    old = NativeTestCapabilities(protocol_version=0, features=frozenset())
    with pytest.raises(NativeTestProtocolUnsupported):
        require_native_test_capabilities(old)

@pytest.mark.parametrize("reason", ["approval", "configuration", "interaction"])
def test_wait_reason_survives_wire_roundtrip(reason):
    waiting = AgentApprovalWait(pending_operation_id="pending-1", wait_reason=reason)
    decoded = AgentApprovalWait.model_validate_json(waiting.model_dump_json())
    assert decoded.wait_reason == reason
    assert decoded.pending_operation_id == "pending-1"
```

- [ ] **A2.2 Red command:** Qualified Linux: `uv --directory dify-agent run --project . --extra server python -m pytest tests/local/dify_agent/protocol/test_native_testing.py tests/local/dify_agent/runtime/test_native_continuation.py tests/local/dify_agent/storage/test_native_continuation_store.py -q`; expect unsupported DTO/store transition failures. Run real Redis atomicity/restart cases only in normal CI with its provisioned Redis.
- [ ] **A2.3 Implement negotiation:** API adapter must require all features before creating a test binding/run. New backend rejects `execution_mode='builder_test'` without a valid reference or unsupported protocol before loading modules/acquiring leases. Missing capability endpoint, malformed response, stale capability cache or negotiation failure never falls back to ordinary execution; server enforces version per request too.

A2 delivers the negotiation mechanism and truthful currently implemented features. It cannot advertise test-scope/child-continuation support until A4/A5 are installed and qualified; A6 proves the complete positive handshake. A2 is independently tested through DTO/runner/store contracts and rejection of insufficient capabilities, not a premature full-runtime readiness claim.

```python
def require_native_test_capabilities(capabilities: NativeTestCapabilities) -> None:
    required = {"pending-call-v1", "policy-gate-v1", "test-scope-v1", "child-continuation-v1"}
    if capabilities.protocol_version != 1 or not required.issubset(capabilities.features):
        raise NativeTestProtocolUnsupported()
```

- [ ] **A2.4 Implement native pending calls:** Add `DeferredToolRequests` to the runner's output contract, persist exact pending call IDs/arguments and history without marking them interrupted, and continue via native `DeferredToolResults`. Approval is revalidated by the API owner, not accepted from an Agent client boolean. Model/eager/bootstrap/config waits use explicit checkpoint stages; they do not masquerade as deferred model tools.

Denial/revocation maps to standalone `NativePolicyStopped` and API `control.NativePolicyStop`; waiting maps to API `control.NativeApprovalWait`. The latter two inherit the native lane's planned upstream `NodeExecutionControl`. Never submit native `ToolDenied`/approval `False` to let the model choose an alternative after the user denied this test action.

```python
if isinstance(result.output, DeferredToolRequests):
    checkpoint = continuation.capture(result=result, deps=deps)
    await store.persist_waiting(run_id=run_id, checkpoint=checkpoint, event=checkpoint.waiting_event())
    return
```

- [ ] **A2.5 Implement crash-safe state:** Extend existing Redis Lua/CAS ownership for running→waiting and waiting→claimed→running, checkpoint generation and recoverable dispatch intent. Store bounded current request/config by protected server reference, not in public state snapshots; exclude live credentials. Recover claim-after-crash and lost enqueue acknowledgement without a second scheduler claim; cancellation wins over continuation and releases wait resources.
- [ ] **A2.6 Green:** Rerun A2.2; test persistence failure emits no resumable waiting, restart preserves pending call/history/result refs, duplicate continue has one claim, stale generation conflicts, cancelled generation never resumes, and ordinary protocol/run/snapshot migration tests pass. Prove native Pydantic deferral/resumption using its real Agent/FunctionModel, labeling the model synthetic.
- [ ] **A2.7 Commit when executing:** `git add dify-agent/src/dify_agent/protocol dify-agent/src/dify_agent/client/_client.py dify-agent/src/dify_agent/runtime dify-agent/src/dify_agent/storage/redis_run_store.py dify-agent/src/dify_agent/server dify-agent/src/dify_agent/layers/history.py dify-agent/tests/local/dify_agent/protocol/test_native_testing.py dify-agent/tests/local/dify_agent/runtime/test_native_continuation.py dify-agent/tests/local/dify_agent/storage/test_native_continuation_store.py dify-agent/docs/dify-agent/concepts/run-lifecycle/index.md`; `git commit -m "feat(agent): persist versioned native-test continuations"`.

### Task A3: Actual execution gates, inert declarations and opaque-call disclosure

**Files:** Create `dify-agent/src/dify_agent/runtime/native_effects.py`, `dify-agent/src/dify_agent/adapters/native_testing/{__init__,client}.py`, `api/services/dify_builder/native_testing/agent_bridge.py`, `agent_tool_declarations.py`, `api/controllers/inner_api/agent/native_testing.py`. Modify `api/controllers/inner_api/agent/__init__.py`, Agent `runtime/context.py`, `adapters/llm/provider.py`, `layers/dify_plugin/{configs,tools_layer,tool_client}.py`, `layers/dify_core_tools/{client,layer}.py`, `layers/knowledge/{client,layer}.py`, `layers/config/layer.py`, `layers/shell/layer.py`, `agent_stub/server/{agent_stub_files,agent_stub_config}.py`, and API `api/core/workflow/nodes/agent_v2/dify_tools_builder.py` through the new declaration service. Add `api/tests/unit_tests/services/dify_builder/test_agent_tool_declarations.py` and `dify-agent/tests/local/dify_agent/runtime/test_native_effects.py`.

**Interfaces:** Consumes A2 wire/checkpoint and C01 authorization service. `AgentPolicyClient.before_call(ref, intent)`/`record_outcome(permit, outcome, result_ref)` map independent wire DTOs to frozen API fields. `NativeEffectDispatcher.dispatch(*, ref, intent, invoke, result_store) -> JsonValue` handles permit/wait/recorded/stop. `AgentToolDeclarationService.prepare(*, tenant_id, actor_id, app_id, tools)` returns schemas/runtime-reference metadata only; `materialize(*, ref, permit, tool_ref, phase: Literal['refresh', 'business'])` validates the exact phase permit. Private inner routes derive identity from authenticated service + stored ref, never payload actor/tenant authority.

- [ ] **A3.1 Red:** In the real layer/client tests, parameterize `direct_plugin`, `core_tool`, `model`, `eager_knowledge`, `generated_knowledge`, `file_upload`, `file_download`, `config_pull`, `bootstrap`, `shell_run`, `shell_input`; assert waiting produces zero downstream dispatches and no ordinary tool-error observation. Add an expired-OAuth declaration test that fails if refresh, decryption or tool invocation occurs during schema building.

Add missing-credential tests asserting configuration wait, durable configuration reference, zero frozen account-effect/grant/dispatch and unchanged typed target/parameters in the pending execution payload. After normal configuration completes, resolve the actual account/revision and prepare its effect approval; attempting decision on configuration or HumanInput interaction must fail and leave its wait intact.

Add expired-OAuth wait→authorized refresh→persist/CAS→business dispatch: counts are refresh=0/business=0 while waiting, refresh=1/business=0 after refresh, refresh=1/business=1 after business; resuming/retrying either stage keeps those counts. Assert no business permit exists during refresh waiting, and phase-mismatched `/materialize` requests fail before decryption/refresh/dispatch.

```python
def test_opaque_call_discloses_uncertainty():
    disclosure = opaque_invocation_disclosure(kind="plugin", target="provider/action", capability_scope="mailbox:test")
    assert disclosure["authorization_granularity"] == "single_bounded_invocation"
    assert disclosure["internal_effects"] == "opaque"
    assert disclosure["capability_scope"] == "mailbox:test"
```

- [ ] **A3.2 Red commands:** Qualified Linux: `uv --directory dify-agent run --project . --extra server python -m pytest tests/local/dify_agent/runtime/test_native_effects.py tests/local/dify_agent/layers -q`; `uv run --project api python -m pytest api/tests/unit_tests/services/dify_builder/test_agent_tool_declarations.py -q`; expect unguarded dispatch/refresh assertions to fail. Add HTTP/serialization and actual credential owner proofs to normal CI, not mocked provider qualification.
- [ ] **A3.3 Implement private wire adapter:** Parse Pydantic wire models, authenticate existing Agent inner service, reconstruct complete ownership and map explicit fields to C01 services. Return discriminated `dispatch`, `waiting`, `recorded`, `stop`; materialization requires the same permit/action digest and exact phase, outside SQL. Inert account/expiry inspection precedes refresh; authorize the explicit OAuth child operation, refresh once and persist/CAS its result, then call business `before_call`. Never spend a business permit before a refresh that can wait. Business materialization cannot refresh; post-claim drift records known not-dispatched or unknown evidence and revalidates, never silently performs another phase.
- [ ] **A3.3a Implement readiness ordering:** Missing credentials first create C02's configuration pending action with real configuration-owner reference, before freezing an actual-account `EffectIntent` or calling `before_call`. Normal configuration resolves identity/revision, then the actual effect enters authorization. Preserve native interaction/form waits; approving an external effect never supplies credentials or answers HumanInput.
- [ ] **A3.4 Implement actual dispatch:** Build the effect from final merged tool arguments before file upload or credential materialization. Keep plugin daemon invocation direct after its gate; core tools use native ToolManager/ToolEngine after their gate. Forward bounded lineage/permit references through inner calls and plugin invocation metadata; never expose daemon credentials to shell. Preserve SSRF/file authorization owners and shared limits.

```python
decision = await policy.before_call(ref=ref, intent=intent)
if decision.kind == "waiting":
    raise NativeApprovalSuspended(decision.pending_operation_id, wait_reason=decision.wait_reason)
if decision.kind == "stop":
    raise NativePolicyStopped(decision.reason_code)
if decision.kind == "recorded":
    return await result_store.load(decision.result_ref)
return await dispatcher.invoke_permitted(permit=decision, intent=intent, invoke=invoke)
```

- [ ] **A3.5 Implement control preservation:** Native tool pre-execution uses `ApprovalRequired` before invoking any handler; scheduler/checkpoint adapter maps waiting without a failed Agent run. Pre-model/eager/config/bootstrap boundaries raise typed suspension before I/O. Catch and rethrow control before existing `except Exception`/`ValueError` observation mapping. `NativePolicyStopped` cancels the test tree rather than inviting model retry/default/failure-branch recovery.
- [ ] **A3.6 Implement disclosure/invalidation:** Define `opaque_invocation_disclosure(*, kind, target, capability_scope) -> dict[str, str]` and include complete executable arguments/script, non-sensitive identity, implementation/input/dependency fingerprints and bounded data/network/cost scope in protected review data. Redacted summaries link to that data. Changes invalidate pending authorization; opaque plugins are permitted after scoped approval without source audit/allowlist. Secrets are represented by reference/revision and never hashed into public text.

Those disclosure helper keys are internal metadata, not extra public response fields. Map uncertainty/scope to C04 `PendingActionDisclosure.risk_notice`, preserve its typed `target`, `parameters_summary`, `wait_reason`, `required_configuration` and `native_form_ref`, and use the coordinator's exact receipt schema; public responses never expose permit/ref authority or raw execution state.

Persist canonical file references and business arguments, not temporary signed URLs or resolved secrets. A transport credential/file envelope is created only after the corresponding authorization and kept operation-local. A file conversion/upload inside a plugin invocation uses a stable child operation key so waiting during preparation does not duplicate it on reentry.

- [ ] **A3.7 Green:** Rerun A3.2; test known-unstarted retries reuse key, duplicate in-flight gets no permit, lost response yields unknown, denial prevents alternative route dispatch, declaration missing-auth remains bindable, and relevant script/dependency/input/account changes wait again. Shared model/knowledge/file/tool owners verify the same envelope; do not count duplicate guards as separate business effects.
- [ ] **A3.8 Commit when executing:** `git add dify-agent/src/dify_agent/runtime/native_effects.py dify-agent/src/dify_agent/runtime/context.py dify-agent/src/dify_agent/adapters dify-agent/src/dify_agent/layers dify-agent/src/dify_agent/agent_stub/server/agent_stub_files.py dify-agent/src/dify_agent/agent_stub/server/agent_stub_config.py api/services/dify_builder/native_testing/agent_bridge.py api/services/dify_builder/native_testing/agent_tool_declarations.py api/controllers/inner_api/agent/native_testing.py api/controllers/inner_api/agent/__init__.py api/core/workflow/nodes/agent_v2/dify_tools_builder.py api/tests/unit_tests/services/dify_builder/test_agent_tool_declarations.py dify-agent/tests/local/dify_agent/runtime/test_native_effects.py`; `git commit -m "feat(agent): guard native-test effects at actual dispatch"`.

### Task A4: Disposable Agent workspace and real job/lease continuation

**Files:** Create `api/services/dify_builder/native_testing/agent_workspace.py`, `dify-agent/src/dify_agent/runtime_backend/native_test_scope.py`, `api/tests/unit_tests/services/dify_builder/test_agent_test_workspace.py`, `dify-agent/tests/local/dify_agent/runtime_backend/test_native_test_scope.py`. Modify `api/services/agent/workspace_service.py`, existing Agent `protocol/execution_binding.py`, `server/execution_bindings.py`, `runtime_backend/{protocols,local,enterprise,e2b,openshell}.py`, `layers/{runtime/layer,shell/layer}.py`, and `docs/dify-agent/{concepts/runtime-resources/index,user-manual/shell-layer/index}.md`; adapt `api/core/workflow/nodes/agent_v2/session_store.py` only as a caller.

**Interfaces:** Consumes A2/A3, C03 lifecycle and A7's enforcing local scope API. `AgentTestWorkspaceService.prepare(*, ref, pinned_snapshot_id, input_file_refs) -> AgentTestWorkspaceRef`; `retire(*, ref, workspace_ref) -> None`. `AgentTestWorkspaceRef` records binding/workspace/backend identity and pinned Home, not an account conversation. `NativeTestRuntimeCapabilities` declares enforceable network/file/process/cancel bounds and durable-job support. `ShellJobRef(binding_ref, backend_revision, workspace_generation, job_id, output_offset)` persists identity; `validate_job_identity(*, saved, actual) -> None` raises `AgentJobUnavailable` on mismatch/loss.

- [ ] **A4.1 Red:** Assert two test invocations of one Agent get separate mutable Home/workspace, tenant isolation, no ordinary conversation attachment and no writes to saved Home. Test stdin resume after a backend reconnect and missing-job behavior; counters must show no second script start.

```python
def test_lost_job_never_substitutes_another_process():
    saved = ShellJobRef(binding_ref="binding-1", backend_revision="r1", workspace_generation=3, job_id="job-8", output_offset=12)
    actual = saved.model_copy(update={"workspace_generation": 4})
    with pytest.raises(AgentJobUnavailable):
        validate_job_identity(saved=saved, actual=actual)
```

- [ ] **A4.2 Red commands:** Qualified Linux: `uv --directory dify-agent run --project . --extra server python -m pytest tests/local/dify_agent/runtime_backend/test_native_test_scope.py tests/local/dify_agent/layers/shell -q`; `uv run --project api python -m pytest api/tests/unit_tests/services/dify_builder/test_agent_test_workspace.py -q`; expect absent test-scope/job validation failures. Real backend process/network/filesystem proofs belong to normal CI's selected Agent runtime image.
- [ ] **A4.3 Implement scope:** Use API-owned existing binding/workspace allocation and retirement services with root invocation ownership; coordinator supplies any required SQL owner extension. Clone exact immutable published Home to an isolated mutable test Home and independent workspace. Input imports and server-side SecretRefs are explicit gated capabilities; never reuse a normal account conversation or persist new Agent Soul state from the test.

Existing `AgentWorkspaceService.create_binding` performs backend allocation inside its caller transaction. Add a test-only native-owner allocation method coordinated with C03: reserve stable binding/workspace IDs and allocation intent in a short transaction, perform physical allocation with no open SQL transaction, then finalize owned rows and record allocation result. Reconcile a crash after physical allocation by stable IDs; do not copy the existing cross-system transaction/orphan behavior into the new test path.
- [ ] **A4.4 Implement capability enforcement:** Pass a server-authenticated constrained test scope through execution-binding creation/acquisition. Qualify the selected backend's actual egress/path/process cancellation implementation. Unsupported backends return configuration/unavailable before bootstrap; deployment settings or a DTO claiming limits alone are insufficient. Capability negotiation reports only qualified support; ordinary bindings keep existing behavior.

```python
def validate_job_identity(*, saved: ShellJobRef, actual: ShellJobRef) -> None:
    expected = (saved.binding_ref, saved.backend_revision, saved.workspace_generation, saved.job_id)
    observed = (actual.binding_ref, actual.backend_revision, actual.workspace_generation, actual.job_id)
    if expected != observed:
        raise AgentJobUnavailable()
```

- [ ] **A4.5 Implement waiting cleanup:** Persist job identity and operation cursor before publishing a stdin wait. For a backend supporting durable jobs, close operation-local transports/revoke temporary tokens while retaining only the isolated job under bounded deadline; reconnect by saved identity. If retention cannot be enforced, return unavailable/unknown instead of claiming resumable stdin. Terminal/cancel paths terminate the actual process tree and retire test workspace; failed cleanup quarantines capacity and is retryable without damaging the source snapshot.
- [ ] **A4.6 Green:** Rerun A4.2; actual CI backend tests prove denied egress with observable canary, allowed bounded egress, no cross-test mutable state, bounded cancellation/cleanup and stdin resume without script replay. Test job retention expiry, resource loss and unsupported backend with explicit status. A CodeSandbox pass is not evidence for this runtime.
- [ ] **A4.7 Commit when executing:** `git add api/services/dify_builder/native_testing/agent_workspace.py api/services/agent/workspace_service.py api/core/workflow/nodes/agent_v2/session_store.py api/tests/unit_tests/services/dify_builder/test_agent_test_workspace.py dify-agent/src/dify_agent/protocol/execution_binding.py dify-agent/src/dify_agent/server/execution_bindings.py dify-agent/src/dify_agent/runtime_backend dify-agent/src/dify_agent/layers/runtime/layer.py dify-agent/src/dify_agent/layers/shell/layer.py dify-agent/tests/local/dify_agent/runtime_backend/test_native_test_scope.py dify-agent/docs/dify-agent/concepts/runtime-resources/index.md dify-agent/docs/dify-agent/user-manual/shell-layer/index.md`; `git commit -m "feat(agent): isolate native tests and retain durable job identity"`.

### Task A5: API Agent bridge, child Workflow continuation and output retry identity

**Files:** Create `api/services/dify_builder/native_testing/agent_execution.py`, `api/tests/unit_tests/services/dify_builder/test_agent_execution_bridge.py`. Modify `api/clients/agent_backend/{client,request_builder,event_adapter,fake_client,__init__}.py`, `api/core/workflow/nodes/agent_v2/{agent_node,runtime_request_builder,session_store}.py`, and `api/services/agent_tool_inner_service.py`. Adapt `api/core/tools/workflow_as_tool/tool.py` sequentially with the native lane owner after NW1; shared native lane owns its implementation outside `core/`. Add `api/tests/test_containers_integration_tests/core/workflow/test_builder_agent_continuation.py`.

**Interfaces:** Consumes C03 shared lifecycle/result store, NW1 `NativeStatePort`/`ChildInvocationPort`/`NativeControlBridge.resolve`, and A1–A4. Produces `AgentExecutionService.start(*, ref, pinned_binding, native_state)`, `continue_pending(*, ref, checkpoint, expected_generation)`, `cancel(*, ref)` as narrow native caller adapters. Wire mapping is explicit; transport identities never become caller-authority claims. Existing graph pause/checkpoint stores the Agent run ID, backend checkpoint generation and result references.

- [ ] **A5.1 Red:** Use native Agent node stream tests for `run_waiting` without cancelled/failed/default outputs; verify parent/child invocation/depth and original pinned binding survive resume. Add whole-node output retry whose prior tool completed: it must return the recorded result for the same operation key rather than allocate another dispatch.

```python
def test_retry_attempt_is_not_part_of_effect_identity():
    first = OperationKey(invocation_id="agent-1", occurrence_path=("iteration:2", "tool:call-7"), cursor=4)
    resumed = OperationKey(invocation_id="agent-1", occurrence_path=("iteration:2", "tool:call-7"), cursor=4)
    assert first == resumed
    assert first != OperationKey(invocation_id="agent-1", occurrence_path=("iteration:3", "tool:call-7"), cursor=4)
```

- [ ] **A5.2 Red commands:** Qualified Linux: `uv run --project api python -m pytest api/tests/unit_tests/services/dify_builder/test_agent_execution_bridge.py api/tests/unit_tests/clients/agent_backend api/tests/unit_tests/core/workflow/nodes/agent_v2 -q`; expect waiting-event/pinned-identity failures. Normal CI: `uv run --project api python -m pytest api/tests/test_containers_integration_tests/core/workflow/test_builder_agent_continuation.py -q`.
- [ ] **A5.3 Implement bridge:** Negotiate A2 before runtime request construction can materialize credentials or allocate effects. Map C01 reference fields into independent wire DTOs. Route `run_waiting` through native typed control before Agent's broad catches; only after backend and graph checkpoints commit call shared lifecycle pause and expose waiting. A failed checkpoint must leave recovery/error evidence, never claim resumable status.

Map trusted `native_test_required` to backend `execution_mode='builder_test'`; missing/different ref is a stop, even if legacy ordinary builder context is present. Coordinator's public v2 actions live under the existing session `/native-tests`; keep Gmail-only `/real-call-consents` behavior and receipts unchanged. Task-approved bounded local compute/input files consume the shared L1 policy; new model/account/data/network effects still require matching scope.

```python
wire_ref = AgentNativeTestRef(
    policy_version=ref.policy_version, request_id=ref.request_id,
    invocation_id=ref.invocation_id, context_digest=ref.context_digest,
)
assert wire_ref.request_id == ref.request_id
assert wire_ref.context_digest == ref.context_digest
```

- [ ] **A5.4 Implement nested execution:** Replace hardcoded depth zero with verified stored parent lineage. Workflow-as-Tool consumes NW1 child continuation instead of `pause_state_config=None` for marked tests; ordinary calls retain current semantics. Child waiting suspends the parent, child terminal results persist before parent continuation, and duplicate callback delivery cannot launch another parent. Never synthesize a successful child response from a waiting event.
- [ ] **A5.5 Implement pinned/retry behavior:** Resolve the original binding/snapshot/Home through execution state on resume. Recheck actor/reference permission, snapshot availability and cancellation without switching to latest published config. Preserve operation cursors/call IDs across output retries; replay same-Run completed results from execution storage and mark cross-Run reuse simulated. A retry requiring changed/new effects must reenter authorization; it cannot use a new backend idempotency key to reset effect allowance.
- [ ] **A5.6 Green:** Rerun A5.2; exercise backend restart, API worker restart, SSE reconnect, duplicate continuation and child completion, stale generation, source Agent republish, revoked permission, cancellation and unknown outcomes. Assert no duplicate dispatch, no Agent catch converts control into tool text/failure/default, no shared budgets reset, and existing ordinary Agent/WorkflowTool tests pass.
- [ ] **A5.7 Commit when executing:** `git add api/services/dify_builder/native_testing/agent_execution.py api/clients/agent_backend api/core/workflow/nodes/agent_v2/agent_node.py api/core/workflow/nodes/agent_v2/runtime_request_builder.py api/core/workflow/nodes/agent_v2/session_store.py api/services/agent_tool_inner_service.py api/core/tools/workflow_as_tool/tool.py api/tests/unit_tests/services/dify_builder/test_agent_execution_bridge.py api/tests/test_containers_integration_tests/core/workflow/test_builder_agent_continuation.py`; `git commit -m "feat(builder): resume native Agent and child Workflow calls"`.

### Task A6: First acceptance and failure matrix with real boundary evidence

**Files:** Create `api/tests/test_containers_integration_tests/core/workflow/test_builder_agent_native_acceptance.py`, `dify-agent/tests/local/dify_agent/server/test_native_testing_contract.py`, `e2e/features/agent-v2/builder-native-testing.feature`, `e2e/features/step-definitions/agent-v2/builder-native-testing.steps.ts`, `e2e/features/support/builder-native-testing.ts`, and `docs/dify-builder-native-agent-testing.md`. Modify existing `e2e/features/support/world.ts` only for typed `world.agentBuilder` scenario state; use current generated clients and register cleanup.

**Interfaces:** Consumes A1–A5, coordinator's authenticated start/status/approve/continue/cancel routes and generated contracts, native lane/code lane accepted runtimes. Produces per-scenario evidence linking Builder request/native Run/node execution/Agent run/pinned snapshot/pending key/approval receipt/dispatch count/output checks/cleanup to screenshot and Trace references. No test-only production bypass endpoint or handwritten public Console DTO.

- [ ] **A6.1 Red:** Create disposable published contract-risk fixture using native Agent services and explicitly label it synthetic; declare contract_text/jurisdiction inputs and risks/summary node-job outputs. Parameterize API integration for direct plugin, core tool, model, knowledge, files, bootstrap/shell/stdin, nested Workflow and output retry. A real installed plugin lacking credentials must bind needs-setup, wait on execution, and make zero calls.

```gherkin
@agent-v2 @prepared @agent-backend-runtime @external-model @external-tool @builder-native-testing
Scenario: Published Agent resumes the approved pending invocation
  Given the Agent v2 runtime backend is available
  And a disposable contract-risk Agent and bounded test action are prepared
  When the authenticated test client starts Start New Agent End with synthetic contract inputs
  Then the native test is waiting with zero action dispatches and the published snapshot recorded
  When the authenticated test client approves and continues the exact pending operation
  Then risks and summary match the declared contract and the action dispatched once
  And the existing native Run is visible with linked receipt and Trace evidence
```

- [ ] **A6.2 Red commands:** Normal CI runs the new API integration file and `uv --directory dify-agent run --project . --extra server python -m pytest tests/local/dify_agent/server/test_native_testing_contract.py -q`. Qualified Linux E2E, after explicit real-call scope is granted: `E2E_START_AGENT_BACKEND=1 pnpm -C e2e e2e:external -- --tags @builder-native-testing`. Expect unimplemented public journey/boundary assertions to fail; do not use permanent skips or count-only checks.
- [ ] **A6.3 Implement fixtures and assertions:** Setup/poll/approval actions use the coordinator's authenticated API contract because the approval UI is out of scope; the browser inspects the existing native Run/results. Parse real SQL/Redis and transport evidence, not a mocked final success. Synthetic model/daemon fixtures prove deterministic control wiring only; separately authorized runtime cases prove real provider/plugin/backend behavior. A1/v3 absence selects a labeled disposable fixture, never a fabricated existing Workspace claim.

```python
def assert_no_dispatch_before_approval(evidence):
    assert evidence.waiting_checkpoint_committed
    assert evidence.before_approval_dispatch_count == 0
    assert evidence.after_approval_dispatch_count == 1
    assert evidence.pending_operation_key == evidence.completed_operation_key
    assert evidence.snapshot_before_wait == evidence.snapshot_after_resume
```

- [ ] **A6.4 Implement crash/skew matrix:** Test capability endpoint 404, protocol mismatch and missing features with all I/O counters zero; checkpoint store failure; crash after claim/before enqueue acknowledgement; lost dispatch response→unknown; duplicate queues/claims; old snapshot republish; permission/credential/input/dependency change; expired OAuth metadata; lost shell job; two allowed batch calls and third/new-target waiting; deny/cancel prevents alternative tools/default/failure/Fix bypass.

Include configuration→normal setup→actual-account approval and native interaction→form submission journeys. Assert all three wait reasons survive backend/API/SSE restart and that approval decision cannot resolve the other two categories; executable target/parameters survive separately from their redacted public presentation.

Expired OAuth is an explicit acceptance case: setup metadata does no refresh, refresh waiting has no spent business permit, approved refresh persists once before the business gate, and final refresh/business dispatch counts are each one after duplicate continuation.
- [ ] **A6.5 Green:** Run A6.2 and focused regression from A1–A5. Add `Start → Code → Iteration(New Agent) → Tool → End` with real Python and JavaScript variants, dynamic pending Agent tool call and child Workflow wait/continue. Assert shared cost/call/depth limits, schema/output/file ownership, ordinary Agent compatibility, no saved Home contamination and actual runtime cancellation/cleanup. Coordinator owns the broader native registry matrix and Dev rollout; this lane supplies artifacts, not a deployment shortcut.
- [ ] **A6.6 Record evidence:** Document capabilities/runtime image/dependency revisions, test commands, synthetic-versus-real boundaries, exact approvals, native IDs, output/business assertions, unknown/error cases and cleanup failures in `docs/dify-builder-native-agent-testing.md`. Keep sensitive execution state private, link redacted API receipt/Trace/screenshots, and state frontend confirmation UI is absent. No fresh Local/Dev success is claimed by this plan.
- [ ] **A6.7 Commit when executing:** `git add api/tests/test_containers_integration_tests/core/workflow/test_builder_agent_native_acceptance.py dify-agent/tests/local/dify_agent/server/test_native_testing_contract.py e2e/features/agent-v2/builder-native-testing.feature e2e/features/step-definitions/agent-v2/builder-native-testing.steps.ts e2e/features/support/builder-native-testing.ts e2e/features/support/world.ts docs/dify-builder-native-agent-testing.md`; `git commit -m "test(builder): prove New Agent native approval continuation"`.

### Task A7: Enforcing local Agent runtime scope for Local and Dev

**Files:** Create `dify-agent-runtime/internal/testscope/{types,supervisor_linux,mounts_linux,limits_linux,network_linux,jobs}.go`, `supervisor_linux_test.go`, `limits_linux_test.go`, `network_linux_test.go`, `dify-agent-runtime/tests/native_test_scope_test.go`, `dify-agent-runtime/docker/native-test-seccomp.json` and `native-test-apparmor.profile`. Modify existing `dify-agent-runtime/internal/server/{types,api,service,db,tmux,config}.go`, `cmd/shellctl/main.go`, `cmd/runner/{main,main_test}.go`, `internal/landlock/{config,landlock_linux}.go`, `docker/Dockerfile`, `Makefile`, and `README.md`. Extend `dify-agent/src/shellctl/{shared/schemas,client/sdk}.py`, `dify-agent/src/dify_agent/adapters/shell/shellctl.py`, `runtime_backend/{local,profile}.py` and existing `tests/local/dify_agent/runtime_backend/test_profile.py` for actual scope transport/settings. Root sequentially integrates `.github/workflows/sandbox-runtime-tests.yml`, `e2e/scripts/setup.ts`, `docker/docker-compose.yaml` and `docker/envs/core-services/dify-agent.env.example` contributions; deployment manifests remain I02/I03-owned.

**Interfaces:** Consumes A2's versioned reference semantics and C01's checked capability scope, never API Python imports. Produce authenticated `POST /v1/test-scopes`, `GET /v1/test-scopes/{scope_id}`, `DELETE /v1/test-scopes/{scope_id}`; `NativeScopeSpec(scope_id, generation, binding_ref, base_snapshot_ref, input_file_refs, capability_digest, deadline, limits, network_targets)` is immutable after creation. Snapshot/file references resolve under trusted source roots, never arbitrary client mount paths. Jobs require a scope-bound token and matching generation; ordinary `/v1/jobs` behavior remains unchanged. Python `LocalNativeScopeClient.create(spec)`, `inspect(scope_id, generation)`, `destroy(scope_id, generation)` supplies A4's actual driver.

- [ ] **A7.1 Red:** Add Go scope API tests for missing/wrong generation/token and cross-scope job operations; these must execute zero submitted instructions. Add actual Linux integration for two scopes, a writable workspace, a foreign workspace canary, direct network canary and a child process tree. A test-scope execution must fail when user namespaces, strict filesystem restriction or delegated cgroup controllers are unavailable; it must never follow current Landlock warning-and-continue behavior.

```go
func TestMissingNativeScopePrimitivesRejectStart(t *testing.T) {
    caps := HostCapabilities{UserNamespaces: false, DelegatedCgroup: false}
    if err := ValidateHostCapabilities(caps); err == nil {
        t.Fatal("native test scope accepted without enforceable isolation")
    }
}
```

- [ ] **A7.2 Red commands:** Qualified Linux only, from `dify-agent-runtime/`: `go test ./internal/testscope ./internal/server ./cmd/runner`; expect absent scoped owner/rejection failures. Normal runtime CI runs existing `make integration` extended with its scoped supervisor fixture and `tests/native_test_scope_test.go`; do not run Go/runtime tests on the host or substitute pure mocks for kernel/network proofs.
- [ ] **A7.3 Implement concrete supervisor:** Add `--native-test-supervisor` mode to the existing Go runtime service. Use a deployment-qualified rootless supervisor with kernel user namespaces, per-scope mount/PID/network namespaces and a finite delegated cgroup-v2 subtree. Namespace setup may use capabilities within its new user namespace only; drop all submitted-job capabilities, set no-new-privileges and isolate `/proc` before opening the script start gate. Use a narrow reviewed seccomp/AppArmor profile and only the delegated subtree, never `privileged:true`, a Docker socket, broad host cgroup mounts or unbounded host access.
- [ ] **A7.4 Implement actual bounds:** `HostCapabilities` and `ValidateHostCapabilities` inspect required primitives, not booleans supplied by a client. The supervisor creates the scope's immutable base/readonly mounts, isolated Home/workspace and size-bounded scratch mount; attaches every job descendant to its cgroup before execution; enforces CPU/memory/PID/FD/wall/input/output/disk limits. Job environment cannot alter mount paths, isolation flags, cgroup identity or supervisor secrets. Existing `landlock.Restrict` failure is fatal on this marked path; ordinary runner compatibility stays explicit.

```go
if err := landlock.Restrict(scope.LandlockConfig()); err != nil {
    return fmt.Errorf("native test scope isolation: %w", err)
}
```

- [ ] **A7.5 Implement real egress:** A test namespace has loopback and no direct route. A trusted local proxy relays only through an inherited supervisor broker channel that submitted jobs cannot control; the broker enforces the scope's server-resolved/pinned target hosts/ports, byte/time bounds and revocation. Dify Agent Stub/file endpoints are explicit scoped mediated capabilities; no route reaches control-plane APIs or another scope. Approved bounded networking changes scope generation/capability digest; unset proxy variables, raw sockets, alternate DNS and subprocesses cannot bypass the namespace. Opaque invocation approval still discloses uncertainty inside its allowed network/data scope.
- [ ] **A7.6 Implement durable jobs/cleanup:** Extend runtime-owned SQLite migrations with scope/generation and job association; persist before the script gate opens. Define `HostCapabilities`, `ValidateHostCapabilities` and `Scope.LandlockConfig` in this owner. Reattach existing tmux/runner state only if scope/job generation matches; server reconnect may retain an existing process, while lost namespace/runtime returns unavailable/unknown without recreation. Cancel/expiry uses the delegated scope's `cgroup.kill`, bounded empty verification and namespace/spool cleanup; failed cleanup quarantines the scope, never returns capacity early.
- [ ] **A7.7 Green and integrate selected backend:** Rerun A7.2 and existing ordinary runtime acceptance. Prove file/process/secret separation, actual denied raw egress and allowed broker canary, output-spool bound, forced child cancellation and shell stdin continuation after Agent worker restart. In Local and Dev, keep `DIFY_AGENT_RUNTIME_BACKEND=local`; add private `DIFY_AGENT_LOCAL_NATIVE_TEST_ENDPOINT`/auth-token settings for this scoped supervisor, leaving ordinary shared-shellctl traffic on its original endpoint. Build the existing runtime image through normal CI/release; I02/I03 configure measured minimal namespace/cgroup delegation and the reviewed profile through normal Compose/Helm. No new cloud account/provider credentials are assumed.
- [ ] **A7.8 Commit when executing:** `git add dify-agent-runtime/internal/testscope dify-agent-runtime/internal/server dify-agent-runtime/cmd/shellctl/main.go dify-agent-runtime/cmd/runner dify-agent-runtime/internal/landlock dify-agent-runtime/tests/native_test_scope_test.go dify-agent-runtime/docker dify-agent-runtime/Makefile dify-agent-runtime/README.md dify-agent/src/shellctl/shared/schemas.py dify-agent/src/shellctl/client/sdk.py dify-agent/src/dify_agent/adapters/shell/shellctl.py dify-agent/src/dify_agent/runtime_backend/local.py dify-agent/src/dify_agent/runtime_backend/profile.py dify-agent/tests/local/dify_agent/runtime_backend/test_profile.py`; `git commit -m "feat(agent-runtime): enforce isolated native test scopes"`. Root stages its configuration/CI contributions separately after the single-writer integration review.

## Dependencies, Review Gates and Real Blockers

| Task | Must consume before integration | Independently reviewable deliverable |
| --- | --- | --- |
| A1 | C01 reference/selection agreement; NW2/NW7 draft transaction | Permission-filtered catalog, honest schemas, native binding and drift rejection |
| A2 | C01 wire field agreement; no API database dependency | Version negotiation and durable backend waiting/continuation |
| A3 | C01 authorization, A2, shared credential/OAuth owner | Actual boundary gates, inert metadata and opaque-call disclosure |
| A4 | C03 workspace lifecycle, A2/A3, A7 scoped local runtime | Disposable test scope and durable shell job identity |
| A5 | C03, NW1 typed native control/child ports, A1–A4 | One native Run across Agent/child wait and retries |
| A6 | A1–A5, shared public schemas, native/code lanes | First required native business acceptance and failure proofs |
| A7 | C01 checked scope, A2 wire contract; normal runtime CI/delegation | Required enforcing local runtime, actual scope bounds and scoped job persistence |

A1 and A2 can proceed in parallel after C01; A7 follows A2's scope contract and precedes A4's local-driver edits. A3 and A7 avoid overlapping shellctl/layer files; A4/A5 take their owners after review. Root schedules broader `node_policy.py`, NW2/NW7's `dify_port.py`, native shared inner guards, WorkflowTool and CI/config edits in single-writer order. Run a whole-branch independent review after A6; do not broaden scope into ENG-1117.

Real engineering dependencies before complete coverage: A7's local runtime and actual Local/Dev namespace/cgroup delegation/profile must be delivered, durable stdin requires its surviving job identity, and native Graphon/WorkflowTool continuation may require a compatible upstream extension. Missing host primitives are a concrete configuration dependency; A7 cannot be omitted by returning unavailable for every backend. Finish the runtime/environment work before acceptance; never approve an unconstrained substitute or mark the scenario skipped.

Real-call acceptance additionally needs a prepared test account/plugin/model and explicit bounded user authorization. This plan's approval authorizes implementation planning/work, not consuming provider calls, running CI now, deploying or sending messages. API schema generation, normal Linux CI, Local/Dev E2E, Helm rollout and Linear status/evidence changes remain the coordinator's execution-time delivery gates.
