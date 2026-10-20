"""Normal CI only: actual PostgreSQL/root lock/encrypted C03 HTTP binding composition.

Never import, collect or run on the development host. No network transport is
invoked. Native public node IDs are attached/bound by the actual preparation
owner. UUID values here are synthetic fixtures bound through the public Node API,
not production worker-issued occurrence evidence; SQL races and encrypted input ownership are exercised independently of
whole-run Graphon trace/privacy/driver activation.
"""

import json
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import select

from core.dify_builder.models import Actor
from graphon.nodes.http_request import HttpRequestNode
from graphon.nodes.http_request.entities import HttpRequestNodeData
from graphon.runtime import InitParams, RuntimeState, VariablePool
from models.account import Tenant
from models.dify_builder import DifyBuilderExecutionRequest, DifyBuilderTestInput
from models.dify_builder_native_tests import NativeInvocationState, NativeTestInvocation, NativeTestScope
from models.workflow import Workflow
from runtime_contracts.builder.execution import BuilderExecutionPolicyError, canonical_digest
from runtime_contracts.builder.native.approval_contracts import NativeApprovalProposal, NativeApprovalTerms
from runtime_contracts.builder.native.contracts import ApprovalWait, DispatchPermit, PolicyStop, operation_digest
from runtime_contracts.builder.native.runtime_contracts import NativeCheckpointPayload, ResolvedNativeTestContext
from services.dify_builder.native_testing.authorization import EffectAuthorizationService
from services.dify_builder.native_testing.call_adapter import NativeCallAdapter
from services.dify_builder.native_testing.control import BoundaryOwnerState
from services.dify_builder.native_testing.http_adapter import NativeHttpClient, PreparedHttpBinding
from services.dify_builder.native_testing.http_binding import (
    DeferredNativeHttpClient,
    NativeHttpBindingProducer,
    NativeHttpBindingResolver,
    NativeHttpDisclosure,
    NativeHttpResourceSnapshot,
    RefusingNativeHttpFiles,
    build_native_http_profile,
    describe_http_resource,
    native_http_config,
    native_http_request,
)
from services.dify_builder.native_testing.lifecycle import NativeTestLifecycleService
from services.dify_builder.native_testing.operation_journal import NodeOperationJournal
from services.dify_builder.native_testing.pending_intents import (
    PendingDecisionGuard,
    ProtectedPendingIntentReader,
    ResolvedPendingIntent,
)
from services.dify_builder.native_testing.private_reads import validate_private_read
from services.dify_builder.native_testing.public_contracts import NativeTestPublicReceipt
from services.dify_builder.native_testing.repository import OwnedNativeTestLoader, native_workflow_revision
from services.dify_builder.native_testing.runtime_bridge import NativeCollaborators, NativeRuntimeBridge
from services.dify_builder.native_testing.state_store import NativeExecutionStateStore
from tests.test_containers_integration_tests.core.workflow.test_builder_native_continuation import (
    migrated_continuation_tables as migrated_continuation_tables,  # noqa: PLC0414 - shared pytest fixture
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_dispatch_claims import (
    migrated_dispatch_claims as migrated_dispatch_claims,  # noqa: PLC0414 - shared pytest fixture
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_effect_ledger import (
    ledger_case as ledger_case,  # noqa: PLC0414 - shared pytest fixture
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_effect_ledger import (
    migrated_native_tables as migrated_native_tables,  # noqa: PLC0414 - shared pytest fixture
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_effect_ledger import (
    native_owner as native_owner,  # noqa: PLC0414 - shared pytest fixture
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_effect_ledger import (
    no_live as no_live,  # noqa: PLC0414 - shared pytest fixture
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_effect_ledger import raw_ledger_case


def literal_data():
    return {
        "type": "http-request",
        "version": "1",
        "title": "HTTP",
        "method": "post",
        "url": "https://example.com/private/SENTINEL?token=SENTINEL",
        "headers": "",
        "params": "",
        "authorization": {"type": "no-auth"},
        "body": {"type": "json", "data": [{"type": "text", "key": "", "value": '{"private":"SENTINEL","flag":true}'}]},
    }


@pytest.fixture
def http_case(native_owner, no_live, migrated_continuation_tables, migrated_dispatch_claims):
    """Reuse shared migration/owner fixtures unchanged; initialize one real private HTTP context."""
    ledger_case = raw_ledger_case(native_owner, no_live)
    assert migrated_continuation_tables is None
    assert migrated_dispatch_claims is None
    from extensions.ext_database import db
    from libs.key_providers import generate_key_pair

    _, _, app, workflow, _, _ = native_owner
    assert app.id
    assert workflow.id
    db.session.expunge(app)
    db.session.expunge(workflow)
    db.session.close()
    public_key = generate_key_pair(ledger_case.actor.tenant_id)
    graph = {"nodes": [{"id": "http", "data": literal_data()}], "edges": []}
    inputs = {"flag": True}
    run_id = str(uuid4())
    with ledger_case.factory.begin() as session:
        session.get(Tenant, ledger_case.actor.tenant_id).encrypt_public_key = public_key
        request = session.get(DifyBuilderExecutionRequest, ledger_case.ref.request_id)
        workflow = session.get(Workflow, request.workflow_id)
        workflow.graph = json.dumps(graph)
        revision = native_workflow_revision(workflow)
        descriptor = describe_http_resource(
            node_id="http",
            raw=literal_data(),
            workflow_revision=revision,
            app_id=workflow.app_id,
            workflow_id=workflow.id,
        )
        request.context = {
            **request.context,
            "request_id": request.id,
            "invocation_id": ledger_case.ref.invocation_id,
            "native_run_id": run_id,
            "mode": "native",
            "tenant_id": request.tenant_id,
            "actor_id": request.actor_id,
            "app_id": request.app_id,
            "workflow_id": request.workflow_id,
            "session_id": request.session_id,
            "test_input_id": request.test_input_id,
            "execution_revision": revision,
            "input_revision": canonical_digest(inputs),
            "resource_manifest_digest": canonical_digest([descriptor]),
            "profile": build_native_http_profile().model_dump(mode="json"),
        }
        request.context_digest = canonical_digest(request.context)
        ref = ledger_case.ref.model_copy(update={"context_digest": request.context_digest})
        app_id, workflow_id = request.app_id, request.workflow_id
        session.get(DifyBuilderTestInput, request.test_input_id).inputs = inputs
        scope = session.scalar(select(NativeTestScope).where(NativeTestScope.request_id == ref.request_id))
        scope.max_calls = scope.max_dispatches = scope.max_cost_units = 16
        scope.budget_limits = scope.budget_spent = {}
        scope.profile = build_native_http_profile().limits
    loader = OwnedNativeTestLoader(ledger_case.factory, actor=ledger_case.actor, resolver=NativeHttpBindingResolver())
    store = NativeExecutionStateStore(loader)
    context = ResolvedNativeTestContext(
        ref=ref,
        tenant_id=ledger_case.actor.tenant_id,
        actor_id=ledger_case.actor.account_id,
        app_id=app_id,
        workflow_id=workflow_id,
        graph=graph,
        inputs=inputs,
        graph_revision=revision,
        input_revision=canonical_digest(inputs),
        resource_manifest=(descriptor,),
        generation=0,
        root_native_run_id=run_id,
        native_run_id=run_id,
        parent_invocation_id=None,
        call_depth=0,
        budget_ref=ref.request_id,
        cancellation_ref=ref.request_id,
        execution_mode="native",
    )
    store.initialize_context(context=context)
    return SimpleNamespace(
        ref=ref,
        loader=loader,
        store=store,
        context=context,
        factory=ledger_case.factory,
        actor=ledger_case.actor,
        auth=EffectAuthorizationService(loader),
        descriptor=descriptor,
    )


def prepare(c, execution_id=None, *, ref=None):
    """Compose the SQL component fixture; this does not establish actual host ownership."""
    selected_ref = ref or c.ref
    journal = NodeOperationJournal(state=c.store, authorization=c.auth)
    captured = {"prepared": []}
    files = RefusingNativeHttpFiles()

    def on_prepared(*, binding: PreparedHttpBinding) -> None:
        captured["prepared"].append(binding)

    def collaborators(*, association):
        producer = NativeHttpBindingProducer(
            association=association, loader=c.loader, state_store=c.store, journal=journal
        )
        captured["producer"] = producer
        client = DeferredNativeHttpClient(
            producer=producer, authorization=c.auth, calls_factory=NativeCallAdapter, on_prepared=on_prepared
        )
        return NativeCollaborators(
            **{name: client if name == "http" else files for name in NativeCollaborators.__dataclass_fields__}
        )

    def arguments(**kwargs):
        return {
            "http_request_config": native_http_config(),
            "http_client": kwargs["collaborators"].http,
            "file_manager": files,
            "tool_file_manager_factory": files,
            "file_reference_factory": files,
        }

    bridge = NativeRuntimeBridge(
        state=c.store,
        collaborators=collaborators,
        node_arguments=arguments,
        boundary_owner=BoundaryOwnerState(ref=selected_ref),
        control_sink=SimpleNamespace(record_control=lambda **_kw: None),
    )
    runtime = RuntimeState(workflow_id="workflow", variable_pool=VariablePool(), start_at=0)
    association = bridge.prepare_node(
        ref=selected_ref,
        node_id="http",
        node_data=HttpRequestNodeData.model_validate(literal_data()),
        node_class=HttpRequestNode,
        runtime_state=runtime,
    )
    node = association.node_class(
        node_id="http",
        data=HttpRequestNodeData.model_validate(literal_data()),
        init_params=InitParams(
            workflow_id=c.context.workflow_id, graph_config=c.context.graph, run_context={}, call_depth=0
        ),
        runtime_state=runtime,
        **association.arguments,
    )
    association.attach(node)
    # Synthetic fixture UUID bound through the real public API; no worker/host execution claim.
    node.bind_execution_id(execution_id or str(uuid4()))
    producer = captured["producer"]
    producer.begin()
    arguments = native_http_request(raw=literal_data(), variable_pool=runtime.variable_pool)
    client = NativeHttpClient(
        ref=selected_ref, calls=object(), intents=object(), max_redirect_hops=0, max_response_bytes=1048576
    )
    request = client._prepare("POST", arguments.pop("url"), arguments)
    binding = producer.prepare(request=request, hop=0, previous_response=None)
    return SimpleNamespace(producer=producer, binding=binding, journal=journal, association=association)


def bindings(c):
    with c.factory() as session:
        row = session.scalar(
            select(NativeTestInvocation).where(
                NativeTestInvocation.request_id == c.ref.request_id,
                NativeTestInvocation.invocation_id == c.ref.invocation_id,
            )
        )
        return row.bindings


def test_real_http_snapshot_and_equal_install_preserve_other_entries(http_case):
    c = http_case
    old = bindings(c)
    manifest = NativeHttpResourceSnapshot(session_factory=c.factory)(
        actor=c.actor,
        app_id=c.context.app_id,
        workflow_id=c.context.workflow_id,
        graph=c.context.graph,
        profile=build_native_http_profile(),
    )
    assert manifest == c.context.resource_manifest
    first = prepare(c)
    second = prepare(c, first.association.execution_id)
    assert first.binding.intent == second.binding.intent
    current = bindings(c)
    assert all(current[key] == value for key, value in old.items())
    assert len(current) == len(old) + 1
    stored = current[operation_digest(first.binding.intent.key)]
    assert stored["execution_id"] == first.association.execution_id
    assert stored["invocation_digest"] == canonical_digest(first.binding.intent.model_dump(mode="json"))
    assert stored["cost_units"] == 1
    assert stored["budget"] == {}
    assert stored["approval_scope"] == "operation"
    input_ref = first.journal.snapshot(ref=c.ref)[0].input_result_ref
    assert c.store.load_result(ref=c.ref, result_ref=input_ref) == first.binding.request.material()


def test_real_http_conflict_is_immutable_and_concurrent_merge_preserves_entries(http_case):
    from threading import Barrier

    from flask import current_app

    c = http_case
    first = prepare(c)
    before = bindings(c)
    conflict = first.binding.intent.model_copy(update={"target": "https://other.example"})
    with pytest.raises(BuilderExecutionPolicyError, match="native_binding_conflict"):
        first.producer._install(
            context=c.context,
            authority=validate_private_read(c.loader, c.ref),
            descriptor=c.descriptor,
            intent=conflict,
        )
    assert bindings(c) == before
    app = current_app._get_current_object()
    start = Barrier(2)

    def prepare_in_worker(_):
        # Flask's scoped RSA public-key lookup requires an independent worker app context.
        with app.app_context():
            start.wait(timeout=10)
            return prepare(c)

    with ThreadPoolExecutor(max_workers=2) as pool:
        prepared = list(pool.map(prepare_in_worker, range(2)))
    current = bindings(c)
    assert len(current) == len(before) + 2
    assert all(current[key] == value for key, value in before.items())
    assert len({operation_digest(item.binding.intent.key) for item in prepared}) == 2


def test_real_http_opaque_wait_disclosure_and_known_destructive_never_auto_grants(http_case):
    c = http_case
    p = prepare(c)
    with c.factory.begin() as session:
        session.scalar(
            select(NativeTestScope).where(NativeTestScope.request_id == c.ref.request_id)
        ).task_approved = True
    cursor = p.journal.resolve_cursor(ref=c.ref, key=p.binding.intent.key)
    waiting = cursor.before_call(intent=p.binding.intent)
    assert isinstance(waiting, ApprovalWait)
    expiry = c.loader.load(ref=c.ref).expires_at.isoformat()
    terms = NativeApprovalTerms(max_calls=1, max_dispatches=1, max_cost_units=1, expires_at=expiry)
    checkpoint = c.store.commit_checkpoint(
        ref=c.ref,
        generation=0,
        payload=NativeCheckpointPayload(
            schema_version="1",
            native_run_id=c.context.native_run_id,
            generation=0,
            generate_entity_json="{}",
            graph_runtime_state_json="{}",
            response_stream_filter_json="{}",
            node_journals=p.journal.snapshot(ref=c.ref),
            child_refs=(),
            input_result_refs=(),
            approval_proposals=(NativeApprovalProposal(key=p.binding.intent.key, terms=terms),),
        ),
    )
    NativeTestLifecycleService(c.loader, state_store=c.store).pause(
        ref=c.ref, checkpoint=checkpoint, pending_operation_ids=(waiting.pending_operation_id,), expected_generation=0
    )
    disclosure = NativeHttpDisclosure(loader=c.loader, state_store=c.store).describe(
        actor=c.actor,
        resolved=ResolvedPendingIntent(ref=c.ref, generation=0, checkpoint=checkpoint, intent=p.binding.intent),
    )
    assert disclosure.approval_limits == terms
    assert disclosure.target == {"method": "POST", "origin": "https://example.com"}
    assert "internal actions are unknown" in disclosure.risk_notice
    assert "SENTINEL" not in disclosure.model_dump_json()
    # Changing stored classification does not rewrite the current policy or authorize.
    with c.factory.begin() as session:
        row = session.scalar(select(NativeTestInvocation).where(NativeTestInvocation.request_id == c.ref.request_id))
        identity = operation_digest(p.binding.intent.key)
        row.bindings = {**row.bindings, identity: {**row.bindings[identity], "destructive": True}}
    assert isinstance(c.auth.before_call(ref=c.ref, intent=p.binding.intent), PolicyStop)


@pytest.mark.parametrize("phase", ["before_call", "claim"])
def test_real_http_current_config_drift_stops_before_dispatch(http_case, monkeypatch, phase):
    from configs import dify_config

    c = http_case
    p = prepare(c)
    intent = p.binding.intent
    if phase == "claim":
        assert isinstance(c.auth.before_call(ref=c.ref, intent=intent), ApprovalWait)
        c.auth.decide(
            ref=c.ref,
            intent=intent,
            decision="approved",
            max_calls=1,
            max_dispatches=1,
            max_cost_units=1,
            expires_at=c.loader.load(ref=c.ref).expires_at,
        )
        permit = c.auth.before_call(ref=c.ref, intent=intent)
        assert isinstance(permit, DispatchPermit)
    monkeypatch.setattr(dify_config, "HTTP_REQUEST_MAX_READ_TIMEOUT", dify_config.HTTP_REQUEST_MAX_READ_TIMEOUT + 1)
    if phase == "before_call":
        assert isinstance(c.auth.before_call(ref=c.ref, intent=intent), PolicyStop)
    else:
        with pytest.raises(BuilderExecutionPolicyError):
            c.auth.claim_dispatch(ref=c.ref, intent=intent, permit=permit)


def test_real_http_input_ack_and_external_work_stay_outside_install_writer(http_case, monkeypatch):
    c = http_case
    active = False
    original_lock = c.loader.locked

    @contextmanager
    def tracked_lock(**kwargs):
        nonlocal active
        with original_lock(**kwargs) as value:
            active = True
            try:
                yield value
            finally:
                active = False

    monkeypatch.setattr(c.loader, "locked", tracked_lock)
    for name in ("prepare_object", "load_result", "load_context"):
        original = getattr(c.store, name)

        def checked(*args, _original=original, **kwargs):
            assert not active, "protected/storage work under root writer"
            return _original(*args, **kwargs)

        monkeypatch.setattr(c.store, name, checked)
    p = prepare(c)
    assert p.journal.snapshot(ref=c.ref)[0].input_result_ref
    assert operation_digest(p.binding.intent.key) in bindings(c)


def test_real_http_unrelated_scope_advance_retains_invocation_generation(http_case):
    c = http_case
    with c.factory.begin() as session:
        session.scalar(select(NativeTestScope).where(NativeTestScope.request_id == c.ref.request_id)).generation = 4
    assert c.store.load_context(ref=c.ref).generation == 0
    p = prepare(c)
    assert operation_digest(p.binding.intent.key) in bindings(c)


def test_real_http_foreign_actor_and_local_generation_drift_refuse_input_and_binding(http_case, monkeypatch):
    c = http_case
    before = bindings(c)
    foreign = OwnedNativeTestLoader(
        c.factory,
        actor=Actor(tenant_id=c.actor.tenant_id, account_id=str(uuid4())),
        resolver=NativeHttpBindingResolver(),
    )
    with pytest.raises(BuilderExecutionPolicyError):
        foreign.load(ref=c.ref)
    original_prepare = c.store.prepare_object
    changed = False

    def advance_after_private_read(**kwargs):
        nonlocal changed
        receipt = original_prepare(**kwargs)
        if kwargs.get("kind") == "result" and not changed:
            changed = True
            with c.factory.begin() as session:
                row = session.scalar(
                    select(NativeInvocationState).where(
                        NativeInvocationState.request_id == c.ref.request_id,
                        NativeInvocationState.invocation_id == c.ref.invocation_id,
                    )
                )
                row.generation += 1
        return receipt

    monkeypatch.setattr(c.store, "prepare_object", advance_after_private_read)
    with pytest.raises(BuilderExecutionPolicyError):
        prepare(c)
    assert bindings(c) == before


def test_real_http_qualified_same_workflow_child_uses_local_generation_and_ancestor_authority(http_case):
    from runtime_contracts.builder.native.contracts import OperationKey
    from services.dify_builder.native_testing.child_invocations import NativeChildInvocationService

    c = http_case

    class SameWorkflowChild:
        """Test-owned child compiler; exact same actual Workflow descriptor is qualified."""

        def resolve_child(self, *, parent, ref, child_app_id, child_workflow_revision, inputs):
            assert child_app_id == parent.app_id
            assert child_workflow_revision == parent.graph_revision
            return parent.model_copy(
                update={
                    "ref": ref,
                    "parent_invocation_id": parent.ref.invocation_id,
                    "call_depth": 1,
                    "inputs": inputs,
                    "input_revision": canonical_digest(inputs),
                    "native_run_id": str(uuid4()),
                }
            )

    inputs = {"child": True}
    input_ref = c.store.store_node_inputs(ref=c.ref, generation=0, native_execution_id=str(uuid4()), inputs=inputs)
    child = NativeChildInvocationService(c.store, resolver=SameWorkflowChild()).get_or_create(
        parent_ref=c.ref,
        key=OperationKey(invocation_id=c.ref.invocation_id, occurrence_path=("child",), cursor=0),
        child_app_id=c.context.app_id,
        child_workflow_revision=c.context.graph_revision,
        input_digest=canonical_digest(inputs),
        input_result_ref=input_ref,
    )
    with c.factory.begin() as session:
        session.scalar(select(NativeTestScope).where(NativeTestScope.request_id == c.ref.request_id)).generation = 7
    p = prepare(c, ref=child)
    assert p.binding.intent.key.invocation_id == child.invocation_id
    assert c.store.load_context(ref=child).generation == 0
    with c.factory() as session:
        child_row = session.scalar(
            select(NativeTestInvocation).where(
                NativeTestInvocation.request_id == child.request_id,
                NativeTestInvocation.invocation_id == child.invocation_id,
            )
        )
        assert operation_digest(p.binding.intent.key) in child_row.bindings
    with c.factory.begin() as session:
        state = session.scalar(
            select(NativeInvocationState).where(
                NativeInvocationState.request_id == c.ref.request_id,
                NativeInvocationState.invocation_id == c.ref.invocation_id,
            )
        )
        state.state = "unknown"
    with pytest.raises(BuilderExecutionPolicyError, match="native_ancestor_quarantined"):
        prepare(c, ref=child)


@pytest.mark.parametrize("outcome", ["completed", "unknown"])
def test_real_http_one_accounting_unit_and_native_correlation_spent_once(http_case, outcome):
    from models.dify_builder_native_tests import NativeEffectAttempt
    from runtime_contracts.builder.native.contracts import RecordedResult

    c = http_case
    p = prepare(c)
    intent = p.binding.intent
    assert isinstance(c.auth.before_call(ref=c.ref, intent=intent), ApprovalWait)
    c.auth.decide(
        ref=c.ref,
        intent=intent,
        decision="approved",
        max_calls=1,
        max_dispatches=1,
        max_cost_units=1,
        expires_at=c.loader.load(ref=c.ref).expires_at,
    )
    permit = c.auth.before_call(ref=c.ref, intent=intent)
    assert isinstance(permit, DispatchPermit)
    c.auth.claim_dispatch(ref=c.ref, intent=intent, permit=permit)
    with pytest.raises(BuilderExecutionPolicyError, match="dispatch_already_consumed"):
        c.auth.claim_dispatch(ref=c.ref, intent=intent, permit=permit)
    c.auth.decide(
        ref=c.ref,
        intent=intent,
        decision="approved",
        max_calls=1,
        max_dispatches=1,
        max_cost_units=1,
        expires_at=c.loader.load(ref=c.ref).expires_at,
    )
    assert isinstance(c.auth.before_call(ref=c.ref, intent=intent), PolicyStop)
    # A bounded local result witness qualifies ledger settlement, not remote IO.
    result_ref = (
        c.store.store_result(ref=c.ref, key=intent.key, result={"closed": True}) if outcome == "completed" else None
    )
    c.auth.record_outcome(permit=permit, outcome=outcome, result_ref=result_ref)
    c.auth.decide(
        ref=c.ref,
        intent=intent,
        decision="approved",
        max_calls=1,
        max_dispatches=1,
        max_cost_units=1,
        expires_at=c.loader.load(ref=c.ref).expires_at,
    )
    decision = c.auth.before_call(ref=c.ref, intent=intent)
    assert isinstance(decision, RecordedResult if outcome == "completed" else PolicyStop)
    with c.factory() as session:
        scope = session.scalar(select(NativeTestScope).where(NativeTestScope.request_id == c.ref.request_id))
        assert (scope.spent_calls, scope.spent_dispatches, scope.spent_cost_units) == (1, 1, 1)
        attempt = session.scalar(select(NativeEffectAttempt).where(NativeEffectAttempt.request_id == c.ref.request_id))
        assert attempt.execution_id == p.association.execution_id
        assert attempt.invocation_digest == canonical_digest(intent.model_dump(mode="json"))


def _confirmed_http_resume(c, prepared, lifecycle, *, prior_journals=()):
    """Actual protected proposal/guard/resume, with explicit native snapshot fixture values."""
    from models.dify_builder_native_tests import NativeEffectGrant

    context = c.store.load_context(ref=c.ref)
    cursor = prepared.journal.resolve_cursor(ref=c.ref, key=prepared.binding.intent.key)
    wait = cursor.before_call(intent=prepared.binding.intent)
    assert isinstance(wait, ApprovalWait)
    proposals = prepared.producer.approval_proposals()
    assert len(proposals) == 1
    assert proposals[0].terms.max_calls == proposals[0].terms.max_dispatches == 1
    assert proposals[0].terms.max_cost_units == 1
    checkpoint = c.store.commit_checkpoint(
        ref=c.ref,
        generation=context.generation,
        payload=NativeCheckpointPayload(
            schema_version="1",
            native_run_id=context.native_run_id,
            generation=context.generation,
            generate_entity_json="{}",
            graph_runtime_state_json="{}",
            response_stream_filter_json="{}",
            node_journals=(*prior_journals, *prepared.journal.snapshot(ref=c.ref)),
            child_refs=(),
            input_result_refs=(),
            approval_proposals=proposals,
        ),
    )
    lifecycle.pause(
        ref=c.ref,
        checkpoint=checkpoint,
        pending_operation_ids=(wait.pending_operation_id,),
        expected_generation=context.generation,
    )
    reader = ProtectedPendingIntentReader(loader=c.loader, state_store=c.store)
    resolved = reader.load(actor=c.actor, request_id=c.ref.request_id, pending_operation_id=wait.pending_operation_id)
    assert resolved.intent == prepared.binding.intent
    assert reader.load_terms(resolved=resolved) == proposals[0].terms
    disclosure = NativeHttpDisclosure(loader=c.loader, state_store=c.store).describe(actor=c.actor, resolved=resolved)
    assert disclosure.approval_limits == proposals[0].terms
    receipt = NativeTestPublicReceipt(
        request_id=c.ref.request_id,
        generation=context.generation,
        version=context.generation + 1,
        status="waiting",
        wait_reason="approval",
        native_run_id=context.native_run_id,
        native_status=None,
        pending=(disclosure,),
        outcome=None,
        evidence_refs=(),
    )
    guard = PendingDecisionGuard(
        resolved=resolved,
        pending_operation_id=wait.pending_operation_id,
        expected_version=context.generation + 1,
        scope_digest=disclosure.scope_digest,
        idempotency_digest=canonical_digest({"decision": wait.pending_operation_id}),
        body_digest=canonical_digest(
            {"decision": "confirm", "scope": disclosure.scope_digest, "version": context.generation + 1}
        ),
        receipt=receipt,
        terms=reader.load_terms(resolved=resolved),
        invocation_app_id=context.app_id,
        invocation_workflow_id=context.workflow_id,
        invocation_revision=context.graph_revision,
    )
    command = {
        "ref": c.ref,
        "intent": resolved.intent,
        "decision": "approved",
        "max_calls": guard.terms.max_calls,
        "max_dispatches": guard.terms.max_dispatches,
        "max_cost_units": guard.terms.max_cost_units,
        "expires_at": datetime.fromisoformat(guard.terms.expires_at),
        "pending_guard": guard,
    }
    with c.factory() as session:
        request = session.get(DifyBuilderExecutionRequest, c.ref.request_id)
        prior_decisions = sum(record.get("public_decision_saved") is True for record in request.observations)
    saved_receipt = receipt.model_copy(
        update={
            "pending": (disclosure.model_copy(update={"decision": "confirm", "decision_status": "confirmed"}),),
            "decision_public_revision": prior_decisions + 1,
        }
    )
    # The command returns the saved decision fact, not the undecided disclosure.
    # Identical replay must retain that entire canonical receipt byte-for-byte.
    assert c.auth.decide(**command) == saved_receipt
    assert c.auth.decide(**command) == saved_receipt
    # A duplicate authenticated command saved one receipt and still reserves no dispatch.
    with c.factory() as session:
        grants = session.scalars(
            select(NativeEffectGrant).where(
                NativeEffectGrant.request_id == c.ref.request_id,
                NativeEffectGrant.scope_digest == disclosure.scope_digest,
            )
        ).all()
        assert len(grants) == 1
        assert grants[0].spent_calls == grants[0].spent_dispatches == grants[0].spent_cost_units == 0
        grant_id = grants[0].id
    resumed = lifecycle.resume(
        actor=c.actor,
        request_id=c.ref.request_id,
        expected_generation=context.generation,
        idempotency_key="resume-" + wait.pending_operation_id,
    )
    assert resumed.generation == context.generation + 1
    assert lifecycle.claim_dispatch(ref=c.ref, generation=resumed.generation, dispatch_id=resumed.dispatch_id)
    assert lifecycle.claim_dispatch(ref=c.ref, generation=resumed.generation, dispatch_id=resumed.dispatch_id) is False
    return SimpleNamespace(
        pending_id=wait.pending_operation_id,
        scope=disclosure.scope_digest,
        guard=guard,
        command=command,
        grant_id=grant_id,
    )


def _complete_confirmed_http(c, prepared):
    """Manual fixture redelivery preserves the same bound public ID/key after real resume."""
    from runtime_contracts.builder.native.contracts import RecordedResult

    restored = prepare(c, prepared.association.execution_id)
    assert restored.binding.intent == prepared.binding.intent
    cursor = restored.journal.resolve_cursor(ref=c.ref, key=restored.binding.intent.key)
    permit = cursor.before_call(intent=restored.binding.intent)
    assert isinstance(permit, DispatchPermit)
    c.auth.claim_dispatch(ref=c.ref, intent=restored.binding.intent, permit=permit)
    with pytest.raises(BuilderExecutionPolicyError, match="dispatch_already_consumed"):
        c.auth.claim_dispatch(ref=c.ref, intent=restored.binding.intent, permit=permit)
    # Local complete result witness: this SQL test invokes no HTTP transport.
    result_ref = c.store.store_result(ref=c.ref, key=restored.binding.intent.key, result={"closed": True})
    c.auth.record_outcome(permit=permit, outcome="completed", result_ref=result_ref)
    assert cursor.before_call(intent=restored.binding.intent) == RecordedResult(
        operation_id=permit.operation_id, result_ref=result_ref
    )
    restored.producer.finish()
    return restored


def test_real_identical_http_occurrences_require_independent_guarded_one_call_confirmations(http_case):
    from sqlalchemy import func

    from models.dify_builder_native_tests import NativeEffectAttempt, NativeEffectDispatchClaim, NativeEffectGrant
    from runtime_contracts.builder.native.contracts import RecordedResult

    c = http_case
    lifecycle = NativeTestLifecycleService(c.loader, state_store=c.store)
    first = prepare(c)
    approved_first = _confirmed_http_resume(c, first, lifecycle)
    completed_first = _complete_confirmed_http(c, first)
    first_intent = first.binding.intent
    assert isinstance(c.auth.before_call(ref=c.ref, intent=first_intent), RecordedResult)
    second = prepare(c)
    assert second.association.execution_id != first.association.execution_id
    assert second.binding.intent.parameters == first_intent.parameters
    assert second.binding.intent.input_digest == first_intent.input_digest
    second_wait = c.auth.before_call(ref=c.ref, intent=second.binding.intent)
    assert isinstance(second_wait, ApprovalWait)
    assert second_wait.pending_operation_id != approved_first.pending_id
    with pytest.raises(BuilderExecutionPolicyError, match="native_pending_conflict"):
        c.auth.decide(**{**approved_first.command, "intent": second.binding.intent})
    approved_second = _confirmed_http_resume(
        c, second, lifecycle, prior_journals=completed_first.journal.snapshot(ref=c.ref)
    )
    assert approved_second.pending_id == second_wait.pending_operation_id
    assert approved_second.scope != approved_first.scope
    assert approved_second.grant_id != approved_first.grant_id
    _complete_confirmed_http(c, second)
    # A trusted immutable reconfirmation never renews either completed operation.
    for prepared, approved in ((first, approved_first), (second, approved_second)):
        reconfirm = {key: value for key, value in approved.command.items() if key != "pending_guard"}
        assert c.auth.decide(**reconfirm) == approved.grant_id
        assert isinstance(c.auth.before_call(ref=c.ref, intent=prepared.binding.intent), RecordedResult)
    with c.factory() as session:
        scope = session.get(NativeTestScope, c.ref.request_id)
        assert (scope.max_calls, scope.max_dispatches, scope.max_cost_units) == (16, 16, 16)
        assert (scope.spent_calls, scope.spent_dispatches, scope.spent_cost_units) == (2, 2, 2)
        assert scope.generation == 2
        grants = session.scalars(
            select(NativeEffectGrant).where(NativeEffectGrant.request_id == c.ref.request_id)
        ).all()
        assert len(grants) == 2
        assert all(
            (
                grant.max_calls,
                grant.max_dispatches,
                grant.max_cost_units,
                grant.spent_calls,
                grant.spent_dispatches,
                grant.spent_cost_units,
            )
            == (1, 1, 1, 1, 1, 1)
            for grant in grants
        )
        for model in (NativeEffectAttempt, NativeEffectDispatchClaim):
            assert (
                session.scalar(select(func.count()).select_from(model).where(model.request_id == c.ref.request_id)) == 2
            )
