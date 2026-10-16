"""Normal CI only: actual PostgreSQL/root lock/encrypted C03 HTTP binding composition.

Never import, collect or run on the development host. No network transport is
invoked. Native public node IDs are attached/bound by the actual preparation
owner; SQL races and encrypted input ownership are exercised independently of
whole-run Graphon trace/privacy/driver activation.
"""

import json
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import select

from core.dify_builder.models import Actor
from graphon.entities.graph_init_params import GraphInitParams
from graphon.nodes.http_request import HttpRequestNode
from graphon.nodes.http_request.entities import HttpRequestNodeData
from graphon.runtime import GraphRuntimeState, VariablePool
from models.account import Tenant
from models.dify_builder import DifyBuilderExecutionRequest, DifyBuilderTestInput
from models.dify_builder_native_tests import NativeInvocationState, NativeTestInvocation, NativeTestScope
from models.workflow import Workflow
from services.dify_builder.execution_contracts import BuilderExecutionPolicyError, canonical_digest
from services.dify_builder.native_testing.approval_contracts import NativeApprovalProposal, NativeApprovalTerms
from services.dify_builder.native_testing.authorization import EffectAuthorizationService
from services.dify_builder.native_testing.contracts import ApprovalWait, DispatchPermit, PolicyStop, operation_digest
from services.dify_builder.native_testing.control import BoundaryOwnerState
from services.dify_builder.native_testing.http_adapter import NativeHttpClient
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
from services.dify_builder.native_testing.pending_intents import ResolvedPendingIntent
from services.dify_builder.native_testing.private_reads import validate_private_read
from services.dify_builder.native_testing.repository import OwnedNativeTestLoader, native_workflow_revision
from services.dify_builder.native_testing.runtime_bridge import NativeCollaborators, NativeRuntimeBridge
from services.dify_builder.native_testing.runtime_contracts import NativeCheckpointPayload, ResolvedNativeTestContext
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
def http_case(ledger_case, native_owner, migrated_continuation_tables, migrated_dispatch_claims):
    """Reuse shared migration/owner fixtures unchanged; initialize one real private HTTP context."""
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
    selected_ref = ref or c.ref
    journal = NodeOperationJournal(state=c.store, authorization=c.auth)
    captured = {}
    files = RefusingNativeHttpFiles()

    def collaborators(*, association):
        producer = NativeHttpBindingProducer(
            association=association, loader=c.loader, state_store=c.store, journal=journal
        )
        captured["producer"] = producer
        client = DeferredNativeHttpClient(producer=producer, authorization=c.auth)
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
    runtime = GraphRuntimeState(variable_pool=VariablePool(), start_at=0)
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
        graph_init_params=GraphInitParams(
            workflow_id=c.context.workflow_id, graph_config=c.context.graph, run_context={}, call_depth=0
        ),
        graph_runtime_state=runtime,
        **association.arguments,
    )
    association.attach(node)
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
    input_ref = first.journal.snapshot(ref=c.ref)[0].input_result_ref
    assert c.store.load_result(ref=c.ref, result_ref=input_ref) == first.binding.request.material()


def test_real_http_conflict_is_immutable_and_concurrent_merge_preserves_entries(http_case):
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
    with ThreadPoolExecutor(max_workers=2) as pool:
        prepared = list(pool.map(lambda _: prepare(c), range(2)))
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
    from services.dify_builder.native_testing.child_invocations import NativeChildInvocationService
    from services.dify_builder.native_testing.contracts import OperationKey

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
    from services.dify_builder.native_testing.contracts import RecordedResult

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
    # A bounded local result witness qualifies ledger settlement, not remote IO.
    result_ref = (
        c.store.store_result(ref=c.ref, key=intent.key, result={"closed": True}) if outcome == "completed" else None
    )
    c.auth.record_outcome(permit=permit, outcome=outcome, result_ref=result_ref)
    decision = c.auth.before_call(ref=c.ref, intent=intent)
    assert isinstance(decision, RecordedResult if outcome == "completed" else PolicyStop)
    with c.factory() as session:
        scope = session.scalar(select(NativeTestScope).where(NativeTestScope.request_id == c.ref.request_id))
        assert (scope.spent_calls, scope.spent_dispatches, scope.spent_cost_units) == (1, 1, 1)
        attempt = session.scalar(select(NativeEffectAttempt).where(NativeEffectAttempt.request_id == c.ref.request_id))
        assert attempt.execution_id == p.association.execution_id
        assert attempt.invocation_digest == canonical_digest(intent.model_dump(mode="json"))


def test_real_identical_http_second_occurrence_cannot_reset_exhausted_one_call_grant(http_case):
    """Known C02 renewal gate: identity correctness does not imply repeat-call acceptance."""
    from sqlalchemy import func

    from models.dify_builder_native_tests import NativeEffectAttempt, NativeEffectGrant
    from services.dify_builder.native_testing.contracts import RecordedResult

    c = http_case
    first = prepare(c)
    intent = first.binding.intent
    expiry = c.loader.load(ref=c.ref).expires_at
    assert isinstance(c.auth.before_call(ref=c.ref, intent=intent), ApprovalWait)
    grant_id = c.auth.decide(
        ref=c.ref,
        intent=intent,
        decision="approved",
        max_calls=1,
        max_dispatches=1,
        max_cost_units=1,
        expires_at=expiry,
    )
    permit = c.auth.before_call(ref=c.ref, intent=intent)
    assert isinstance(permit, DispatchPermit)
    c.auth.claim_dispatch(ref=c.ref, intent=intent, permit=permit)
    result_ref = c.store.store_result(ref=c.ref, key=intent.key, result={"closed": True})
    c.auth.record_outcome(permit=permit, outcome="completed", result_ref=result_ref)
    assert isinstance(c.auth.before_call(ref=c.ref, intent=intent), RecordedResult)
    second = prepare(c)
    assert second.association.execution_id != first.association.execution_id
    assert isinstance(c.auth.before_call(ref=c.ref, intent=second.binding.intent), ApprovalWait)
    assert (
        c.auth.decide(
            ref=c.ref,
            intent=second.binding.intent,
            decision="approved",
            max_calls=1,
            max_dispatches=1,
            max_cost_units=1,
            expires_at=expiry,
        )
        == grant_id
    )
    assert isinstance(c.auth.before_call(ref=c.ref, intent=second.binding.intent), ApprovalWait)
    with c.factory() as session:
        grant = session.get(NativeEffectGrant, grant_id)
        assert (grant.spent_calls, grant.spent_dispatches, grant.spent_cost_units) == (1, 1, 1)
        assert (
            session.scalar(
                select(func.count())
                .select_from(NativeEffectAttempt)
                .where(NativeEffectAttempt.request_id == c.ref.request_id)
            )
            == 1
        )
