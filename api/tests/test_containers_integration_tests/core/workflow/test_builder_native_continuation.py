"""Normal-CI-only PostgreSQL + real storage/key owner continuation tests.

Explicit queue/runtime counters prove orchestration, not native Graphon reconstruction.
"""

import json
import multiprocessing
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import select, text

from core.dify_builder.models import Actor
from models.account import Tenant
from models.dify_builder import DifyBuilderExecutionRequest, DifyBuilderTestInput
from models.workflow import Workflow
from services.dify_builder.execution_contracts import BuilderExecutionPolicyError, canonical_digest
from services.dify_builder.native_testing.contracts import CheckpointRef, OperationKey
from services.dify_builder.native_testing.runtime_contracts import (
    NativeCheckpointPayload,
    NativeWorkflowOutcome,
    ResolvedNativeTestContext,
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_effect_ledger import (
    _migration,
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


@pytest.fixture(scope="module", autouse=True)
def migrated_continuation_tables(flask_app_with_containers, migrated_native_tables):
    from extensions.ext_database import db

    assert migrated_native_tables is None
    with flask_app_with_containers.app_context(), db.engine.begin() as connection:
        for name in ("dispatches", "invocation_states", "payload_objects"):
            connection.execute(text("DROP TABLE IF EXISTS dify_builder_native_" + name))
        context = MigrationContext.configure(connection, opts={"target_metadata": db.metadata})
        with Operations.context(context):
            _migration("2026_10_14_1500-d28f0e3c912a_add_native_continuation_dispatch.py").upgrade()
        connection.execute(text("COMMENT ON TABLE dify_builder_native_dispatches IS 'ci-alembic:d28f0e3c912a'"))


class ResolutionOwner:
    resolved = False

    def resolve(self, *, session, owned, pending):
        from services.dify_builder.native_testing.lifecycle import NativePendingResolution

        assert session.in_transaction()
        assert pending.tenant_id == owned.tenant_id
        return NativePendingResolution(
            category=pending.category,
            owner_ref=pending.owner_ref,
            reference=pending.reference,
            resolved=self.resolved,
            account_ref="actual-account" if self.resolved and pending.category == "configuration" else None,
            answer_result_ref=self.answer_ref if self.resolved and pending.category == "interaction" else None,
        )


@dataclass
class ContinuationCase:
    ledger: object
    store: object
    lifecycle: object
    resolution: object
    context: object

    @property
    def ref(self):
        return self.ledger.ref

    @property
    def factory(self):
        return self.ledger.factory

    def checkpoint(self, generation=0):
        return self.store.commit_checkpoint(
            ref=self.ref,
            generation=generation,
            payload=NativeCheckpointPayload(
                schema_version="1",
                native_run_id="native-run",
                generation=generation,
                generate_entity_json='{"secret_history":"private-value"}',
                graph_runtime_state_json='{"cursor":0}',
                response_stream_filter_json="{}",
                node_journals=(),
                child_refs=(),
                input_result_refs=(),
            ),
        )

    def pause(self):
        pending = self.ledger.guard.before_call(ref=self.ref, intent=self.ledger.intent)
        cp = self.checkpoint()
        return self.lifecycle.pause(
            ref=self.ref, checkpoint=cp, pending_operation_ids=(pending.pending_operation_id,), expected_generation=0
        )

    def resume(self, key="resume-1", generation=0):
        return self.lifecycle.resume(
            actor=self.ledger.actor, request_id=self.ref.request_id, expected_generation=generation, idempotency_key=key
        )


@pytest.fixture
def continuation_case(ledger_case):
    from libs.key_providers import generate_key_pair
    from services.dify_builder.native_testing.lifecycle import NativeTestLifecycleService
    from services.dify_builder.native_testing.repository import OwnedNativeTestLoader
    from services.dify_builder.native_testing.state_store import NativeExecutionStateStore

    # The existing tenant key owner provisions real synthetic RSA/hybrid storage.
    public_key = generate_key_pair(ledger_case.actor.tenant_id)
    with ledger_case.factory.begin() as session:
        session.get(Tenant, ledger_case.actor.tenant_id).encrypt_public_key = public_key
        request = session.get(DifyBuilderExecutionRequest, ledger_case.ref.request_id)
        app_id, workflow_id = request.app_id, request.workflow_id
        graph = json.loads(session.get(Workflow, workflow_id).graph)
        revision = request.context["execution_revision"]
        session.get(DifyBuilderTestInput, request.test_input_id).inputs = {"boolean": True}
    loader = OwnedNativeTestLoader(ledger_case.factory, actor=ledger_case.actor, resolver=ledger_case.metadata)
    store = NativeExecutionStateStore(loader)
    context = ResolvedNativeTestContext(
        ref=ledger_case.ref,
        tenant_id=ledger_case.actor.tenant_id,
        actor_id=ledger_case.actor.account_id,
        app_id=app_id,
        workflow_id=workflow_id,
        graph=graph,
        inputs={"boolean": True},
        graph_revision=revision,
        input_revision=canonical_digest({"boolean": True}),
        resource_manifest=(),
        generation=0,
        root_native_run_id="native-run",
        native_run_id="native-run",
        parent_invocation_id=None,
        call_depth=0,
        budget_ref=ledger_case.ref.request_id,
        cancellation_ref=ledger_case.ref.request_id,
        execution_mode="native",
    )
    store.initialize_context(context=context)
    resolution = ResolutionOwner()
    lifecycle = NativeTestLifecycleService(loader, state_store=store, resolution=resolution)
    return ContinuationCase(ledger_case, store, lifecycle, resolution, context)


def test_checkpoint_real_encrypted_storage_roundtrip_and_snapshot(continuation_case):
    from extensions.ext_storage import storage
    from models.dify_builder_native_tests import NativeContinuation

    c = continuation_case
    cp = c.checkpoint()
    payload = c.store.read_checkpoint(ref=c.ref, checkpoint=cp)
    assert payload.generate_entity_json == '{"secret_history":"private-value"}'
    with c.factory() as session:
        row = session.scalar(select(NativeContinuation).where(NativeContinuation.checkpoint_id == cp.checkpoint_id))
        storage_key = row.payload_ref
    encrypted = storage.load(storage_key)
    assert b"private-value" not in encrypted
    c.context.inputs["boolean"] = "true"
    assert c.store.load_context(ref=c.ref).inputs == {"boolean": True}


def test_missing_checkpoint_ack_never_reports_resumable_waiting(continuation_case, monkeypatch):
    from extensions.ext_storage import storage
    from models.dify_builder_native_tests import NativeContinuation

    c = continuation_case
    monkeypatch.setattr(storage, "save", lambda *_args: (_ for _ in ()).throw(OSError("storage unavailable")))
    with pytest.raises(BuilderExecutionPolicyError, match="checkpoint_unavailable"):
        c.checkpoint()
    with c.factory() as session:
        assert (
            session.scalar(select(NativeContinuation).where(NativeContinuation.request_id == c.ref.request_id)) is None
        )
        assert session.get(DifyBuilderExecutionRequest, c.ref.request_id).state == "running"
    assert c.ledger.dispatched_attempt_count() == 0


def test_fake_checkpoint_and_cross_invocation_reference_rejected(continuation_case):
    c = continuation_case
    pending = c.ledger.guard.before_call(ref=c.ref, intent=c.ledger.intent)
    with pytest.raises(BuilderExecutionPolicyError):
        c.lifecycle.pause(
            ref=c.ref,
            checkpoint=CheckpointRef(checkpoint_id=str(uuid4()), payload_digest="a" * 64),
            pending_operation_ids=(pending.pending_operation_id,),
            expected_generation=0,
        )
    cp = c.checkpoint()
    with pytest.raises(BuilderExecutionPolicyError):
        c.store.read_checkpoint(ref=c.ref.model_copy(update={"invocation_id": "foreign"}), checkpoint=cp)


def test_result_owner_digest_and_completed_effect_replay(continuation_case):
    c = continuation_case
    result_ref = c.store.store_result(ref=c.ref, key=c.ledger.intent.key, result={"sent": True})
    c.ledger.confirm()
    permit = c.ledger.guard.before_call(ref=c.ref, intent=c.ledger.intent)
    c.ledger.guard.record_outcome(permit=permit, outcome="completed", result_ref=result_ref)
    replay = c.ledger.guard.before_call(ref=c.ref, intent=c.ledger.intent)
    assert c.store.load_result(ref=c.ref, result_ref=replay.result_ref) == {"sent": True}
    with pytest.raises(BuilderExecutionPolicyError):
        c.store.store_result(ref=c.ref, key=c.ledger.intent.key, result={"sent": "true"})
    assert c.ledger.dispatched_attempt_count() == 1


def test_resume_double_submit_same_generation_and_single_worker_claim(continuation_case):
    c = continuation_case
    c.pause()
    c.ledger.confirm()
    first = c.resume()
    assert c.resume() == first
    with pytest.raises(BuilderExecutionPolicyError):
        c.resume(key="different")
    assert c.lifecycle.claim_dispatch(ref=c.ref, generation=first.generation, dispatch_id=first.dispatch_id)
    assert not c.lifecycle.claim_dispatch(ref=c.ref, generation=first.generation, dispatch_id=first.dispatch_id)


def test_enqueue_ack_loss_republishes_same_dispatch(continuation_case):
    c = continuation_case
    c.pause()
    c.ledger.confirm()
    receipt = c.resume()
    deliveries = []

    def lose_ack(**payload):
        deliveries.append(payload)
        raise OSError("queue ack lost")

    assert c.lifecycle.publish_pending(publish=lose_ack) == 0
    assert c.lifecycle.publish_pending(publish=lambda **payload: deliveries.append(payload)) == 1
    assert len(deliveries) == 2
    assert deliveries[0] == deliveries[1]
    assert deliveries[0]["generation"] == receipt.generation
    assert c.lifecycle.claim_dispatch(ref=c.ref, generation=receipt.generation, dispatch_id=receipt.dispatch_id)
    assert not c.lifecycle.claim_dispatch(ref=c.ref, generation=receipt.generation, dispatch_id=receipt.dispatch_id)


def test_crash_after_worker_claim_is_unknown_never_new_effect(continuation_case):
    from models.dify_builder_native_tests import NativeDispatch

    c = continuation_case
    c.pause()
    c.ledger.confirm()
    receipt = c.resume()
    assert c.lifecycle.claim_dispatch(ref=c.ref, generation=receipt.generation, dispatch_id=receipt.dispatch_id)
    with c.factory.begin() as session:
        session.get(NativeDispatch, receipt.dispatch_id).claim_expires_at = datetime.now(UTC) - timedelta(seconds=1)
    c.lifecycle.reconcile()
    assert not c.lifecycle.claim_dispatch(ref=c.ref, generation=receipt.generation, dispatch_id=receipt.dispatch_id)
    with c.factory() as session:
        assert session.get(NativeDispatch, receipt.dispatch_id).state == "unknown"
    assert c.ledger.dispatched_attempt_count() == 0


@pytest.mark.parametrize("reason", ["configuration", "interaction"])
def test_pending_resolution_requires_actual_owner_completion(continuation_case, reason):
    from services.dify_builder.native_testing.pending_actions import NativePendingActionService

    c = continuation_case
    pending_service = NativePendingActionService(c.store.loader)
    pending = (
        pending_service.configuration(ref=c.ref, requirements_ref="configuration-1", expected_generation=0)
        if reason == "configuration"
        else pending_service.interaction(ref=c.ref, native_form_ref="form-1", expected_generation=0)
    )
    receipt = c.lifecycle.pause(
        ref=c.ref,
        checkpoint=c.checkpoint(),
        pending_operation_ids=(pending.pending_operation_id,),
        expected_generation=0,
    )
    assert receipt.wait_reason == reason
    c.ledger.confirm()  # An outbound approval does not resolve either owner.
    with pytest.raises(BuilderExecutionPolicyError, match="native_pending_unresolved"):
        c.resume()
    c.resolution.resolved = True
    if reason == "interaction":
        c.resolution.answer_ref = c.store.store_result(
            ref=c.ref,
            key=OperationKey(invocation_id=c.ref.invocation_id, occurrence_path=("form",), cursor=0),
            result={"answer": "authentic"},
        )
    assert c.resume().status == "queued"
    assert c.ledger.dispatched_attempt_count() == 0


def test_cancellation_stops_tree_and_projects_claimed_unknown(continuation_case):
    c = continuation_case
    c.ledger.confirm()
    permit = c.ledger.guard.before_call(ref=c.ref, intent=c.ledger.intent)
    receipt = c.lifecycle.cancel(actor=c.ledger.actor, request_id=c.ref.request_id, idempotency_key="cancel-1")
    assert receipt.status == "unknown"
    assert receipt.operation_states[permit.operation_id] == "unknown"
    with pytest.raises(BuilderExecutionPolicyError):
        c.store.load_context(ref=c.ref)
    # Already-spent effects retain their C02 settlement path after cancellation.
    late_ref = c.store.store_result(ref=c.ref, key=c.ledger.intent.key, result={"accepted": True})
    c.ledger.guard.record_outcome(permit=permit, outcome="completed", result_ref=late_ref)
    assert c.ledger.dispatched_attempt_count() == 1


def test_expiry_and_foreign_actor_fail_resume(continuation_case):
    from models.dify_builder_native_tests import NativeTestScope

    c = continuation_case
    c.pause()
    c.ledger.confirm()
    with pytest.raises(BuilderExecutionPolicyError):
        c.lifecycle.resume(
            actor=Actor(account_id=str(uuid4()), tenant_id=c.ledger.actor.tenant_id),
            request_id=c.ref.request_id,
            expected_generation=0,
            idempotency_key="foreign",
        )
    with c.factory.begin() as session:
        session.get(NativeTestScope, c.ref.request_id).expires_at = datetime.now(UTC) - timedelta(seconds=1)
    with pytest.raises(BuilderExecutionPolicyError, match="native_expired"):
        c.resume()


def test_production_dispatch_without_native_collaborator_fails_closed(continuation_case):
    c = continuation_case
    c.pause()
    c.ledger.confirm()
    receipt = c.resume()
    with pytest.raises(BuilderExecutionPolicyError, match="native_runtime_unavailable"):
        c.lifecycle.execute_dispatch(ref=c.ref, generation=receipt.generation, dispatch_id=receipt.dispatch_id)
    assert c.ledger.dispatched_attempt_count() == 0


def test_child_input_owner_and_unique_identity_and_completion_wakeup(continuation_case):
    from models.dify_builder_native_tests import NativeDispatch
    from services.dify_builder.native_testing.child_invocations import NativeChildInvocationService

    c = continuation_case

    class ChildOwner:
        def resolve_child(self, *, parent, ref, child_app_id, child_workflow_revision, inputs):
            assert child_app_id == parent.app_id
            assert child_workflow_revision == parent.graph_revision
            return parent.model_copy(
                update={
                    "ref": ref,
                    "parent_invocation_id": parent.ref.invocation_id,
                    "call_depth": parent.call_depth + 1,
                    "inputs": inputs,
                    "input_revision": canonical_digest(inputs),
                    "app_id": child_app_id,
                    "graph_revision": child_workflow_revision,
                    "native_run_id": "child-run",
                }
            )

    child_service = NativeChildInvocationService(c.store, resolver=ChildOwner())
    key = OperationKey(invocation_id=c.ref.invocation_id, occurrence_path=("child",), cursor=0)
    input_ref = c.store.store_result(ref=c.ref, key=key, result={"nested": True})
    args = {
        "parent_ref": c.ref,
        "key": key,
        "child_app_id": c.context.app_id,
        "child_workflow_revision": c.context.graph_revision,
        "input_digest": canonical_digest({"nested": True}),
        "input_result_ref": input_ref,
    }
    with pytest.raises(BuilderExecutionPolicyError):
        child_service.get_or_create(**{**args, "input_digest": "f" * 64})
    child = child_service.get_or_create(**args)
    assert child_service.get_or_create(**args) == child
    assert c.store.load_context(ref=child).parent_invocation_id == c.ref.invocation_id
    result_ref = c.store.store_result(
        ref=child,
        key=OperationKey(invocation_id=child.invocation_id, occurrence_path=("output",), cursor=0),
        result={"ok": True},
    )
    outcome = NativeWorkflowOutcome(
        status="completed",
        ref=child,
        native_run_id="child-run",
        checkpoint_ref=None,
        pending_operation_ids=(),
        reason_code=None,
        wait_reason=None,
        native_status="succeeded",
        output_result_ref=result_ref,
    )
    c.pause()
    child_service.complete(child_ref=child, outcome=outcome)
    child_service.complete(child_ref=child, outcome=outcome)
    with c.factory() as session:
        rows = session.scalars(select(NativeDispatch).where(NativeDispatch.request_id == c.ref.request_id)).all()
        assert len(rows) == 1
        assert rows[0].invocation_id == c.ref.invocation_id
    assert c.store.load_result(ref=child, result_ref=result_ref) == {"ok": True}


def test_revision_drift_fix_does_not_mutate_old_run(continuation_case):
    from models.dify_builder_native_tests import NativeInvocationState, NativePayloadObject

    c = continuation_case
    cp = c.pause().checkpoint
    with c.factory() as session:
        before = session.scalar(
            select(NativeInvocationState).where(NativeInvocationState.request_id == c.ref.request_id)
        )
        context_id = before.context_object_id
    with c.factory.begin() as session:
        session.get(Workflow, c.context.workflow_id).graph += " "
    with pytest.raises(BuilderExecutionPolicyError, match="native_revision_drift"):
        c.resume()
    with c.factory() as session:
        state = session.scalar(
            select(NativeInvocationState).where(NativeInvocationState.request_id == c.ref.request_id)
        )
        assert state.context_object_id == context_id
        assert state.checkpoint_id == cp.checkpoint_id
        assert state.generation == 0
        assert session.get(NativePayloadObject, context_id) is not None


def test_actual_membership_revocation_stops_resume(continuation_case):
    from models.account import TenantAccountJoin

    c = continuation_case
    c.pause()
    c.ledger.confirm()
    with c.factory.begin() as session:
        membership = session.scalar(
            select(TenantAccountJoin).where(
                TenantAccountJoin.tenant_id == c.ledger.actor.tenant_id,
                TenantAccountJoin.account_id == c.ledger.actor.account_id,
            )
        )
        membership.role = "normal"
    with pytest.raises(BuilderExecutionPolicyError):
        c.resume()
    assert c.ledger.dispatched_attempt_count() == 0


def _resume_process(url, actor, ref, barrier, pipe):
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import NullPool

    from services.dify_builder.native_testing.lifecycle import NativeTestLifecycleService
    from services.dify_builder.native_testing.repository import OwnedNativeTestLoader
    from services.dify_builder.native_testing.state_store import NativeExecutionStateStore
    from tests.test_containers_integration_tests.core.workflow.test_builder_native_effect_ledger import MetadataOwner

    factory = sessionmaker(bind=create_engine(url, poolclass=NullPool), expire_on_commit=False)
    loader = OwnedNativeTestLoader(factory, actor=actor, resolver=MetadataOwner())
    service = NativeTestLifecycleService(loader, state_store=NativeExecutionStateStore(loader))
    barrier.wait(timeout=15)
    try:
        receipt = service.resume(
            actor=actor, request_id=ref.request_id, expected_generation=0, idempotency_key="concurrent"
        )
        claimed = service.claim_dispatch(ref=ref, generation=receipt.generation, dispatch_id=receipt.dispatch_id)
        pipe.send((receipt.generation, receipt.dispatch_id, claimed))
    except BaseException as error:
        pipe.send(("error", type(error).__name__, str(error)))
    finally:
        pipe.close()


def test_real_process_resume_and_worker_claim_race(continuation_case):
    c = continuation_case
    c.pause()
    c.ledger.confirm()
    ctx = multiprocessing.get_context("fork")
    barrier = ctx.Barrier(2)
    pairs = [ctx.Pipe(duplex=False) for _ in range(2)]
    url = c.factory.kw["bind"].url.render_as_string(hide_password=False)
    processes = [
        ctx.Process(target=_resume_process, args=(url, c.ledger.actor, c.ref, barrier, pair[1])) for pair in pairs
    ]
    try:
        for process in processes:
            process.start()
        for process in processes:
            process.join(timeout=25)
        assert all(not process.is_alive() and process.exitcode == 0 for process in processes)
        rows = [pair[0].recv() for pair in pairs]
        assert rows[0][0:2] == rows[1][0:2]
        assert rows[0][0] == 1
        assert sum(row[2] is True for row in rows) == 1
    finally:
        for process in processes:
            if process.is_alive():
                process.kill()
                process.join()
        for pair in pairs:
            for pipe in pair:
                pipe.close()


def test_checkpoint_sql_commit_failure_never_acknowledges_wait(continuation_case):
    from sqlalchemy import event
    from sqlalchemy.orm import Session

    from models.dify_builder_native_tests import NativeContinuation

    c = continuation_case

    def fail_flush(session, _flush_context):
        if any(isinstance(row, NativeContinuation) for row in session.new):
            raise RuntimeError("commit interrupted")

    event.listen(Session, "after_flush", fail_flush)
    try:
        with pytest.raises(BuilderExecutionPolicyError, match="checkpoint_unavailable"):
            c.checkpoint()
    finally:
        event.remove(Session, "after_flush", fail_flush)
    with c.factory() as session:
        assert (
            session.scalar(select(NativeContinuation).where(NativeContinuation.request_id == c.ref.request_id)) is None
        )
        assert session.get(DifyBuilderExecutionRequest, c.ref.request_id).state == "running"


def test_checkpoint_readback_corruption_never_acknowledges_wait(continuation_case, monkeypatch):
    from extensions.ext_storage import storage
    from models.dify_builder_native_tests import NativeContinuation

    c = continuation_case
    original, original_save = storage.load, storage.save
    newly_saved = set()

    def save(key, data):
        original_save(key, data)
        newly_saved.add(key)

    def corrupt(key, *args, **kwargs):
        return b"invalid encrypted payload" if key in newly_saved else original(key, *args, **kwargs)

    monkeypatch.setattr(storage, "save", save)
    monkeypatch.setattr(storage, "load", corrupt)
    with pytest.raises(BuilderExecutionPolicyError):
        c.checkpoint()
    with c.factory() as session:
        assert (
            session.scalar(select(NativeContinuation).where(NativeContinuation.request_id == c.ref.request_id)) is None
        )


def test_claim_recovery_requires_native_fencing_proof(continuation_case):
    from models.dify_builder_native_tests import NativeDispatch

    c = continuation_case
    c.pause()
    c.ledger.confirm()
    receipt = c.resume()
    assert c.lifecycle.claim_dispatch(ref=c.ref, generation=receipt.generation, dispatch_id=receipt.dispatch_id)
    with c.factory.begin() as session:
        session.get(NativeDispatch, receipt.dispatch_id).claim_expires_at = datetime.now(UTC) - timedelta(seconds=1)
    c.lifecycle.reconcile()

    class RuntimeOwner:
        proof = "unknown"

        def recovery_evidence(self, **_kwargs):
            return self.proof

    owner = RuntimeOwner()
    c.lifecycle.runtime = owner
    with pytest.raises(BuilderExecutionPolicyError, match="native_recovery_unproven"):
        c.lifecycle.recover_dispatch(ref=c.ref, dispatch_id=receipt.dispatch_id)
    owner.proof = "not_started"
    c.lifecycle.recover_dispatch(ref=c.ref, dispatch_id=receipt.dispatch_id)
    assert c.lifecycle.claim_dispatch(ref=c.ref, generation=receipt.generation, dispatch_id=receipt.dispatch_id)
    assert c.ledger.dispatched_attempt_count() == 0


def test_child_wait_requires_committed_child_and_parent_checkpoints(continuation_case):
    from models.dify_builder_native_tests import NativeDispatch, NativeInvocationState
    from services.dify_builder.native_testing.child_invocations import NativeChildInvocationService
    from services.dify_builder.native_testing.pending_actions import NativePendingActionService

    c = continuation_case

    class ChildOwner:
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
                    "native_run_id": "child-run",
                }
            )

    service = NativeChildInvocationService(c.store, resolver=ChildOwner())
    key = OperationKey(invocation_id=c.ref.invocation_id, occurrence_path=("child-wait",), cursor=0)
    input_ref = c.store.store_result(ref=c.ref, key=key, result={"nested": True})
    child = service.get_or_create(
        parent_ref=c.ref,
        key=key,
        child_app_id=c.context.app_id,
        child_workflow_revision=c.context.graph_revision,
        input_digest=canonical_digest({"nested": True}),
        input_result_ref=input_ref,
    )
    pending = NativePendingActionService(c.store.loader).interaction(
        ref=child, native_form_ref="form-1", expected_generation=0
    )
    payload = NativeCheckpointPayload(
        schema_version="1",
        native_run_id="child-run",
        generation=0,
        generate_entity_json="{}",
        graph_runtime_state_json="{}",
        response_stream_filter_json="{}",
        node_journals=(),
        child_refs=(),
        input_result_refs=(),
    )
    child_checkpoint = c.store.commit_checkpoint(ref=child, generation=0, payload=payload)
    service.complete(
        child_ref=child,
        outcome=NativeWorkflowOutcome(
            status="waiting",
            ref=child,
            native_run_id="child-run",
            checkpoint_ref=child_checkpoint,
            pending_operation_ids=(pending.pending_operation_id,),
            wait_reason="interaction",
            reason_code=None,
            native_status=None,
            output_result_ref=None,
        ),
    )
    parent_checkpoint = c.store.commit_checkpoint(
        ref=c.ref,
        generation=0,
        payload=payload.model_copy(update={"native_run_id": "native-run", "child_refs": (child,)}),
    )
    receipt = c.lifecycle.pause(
        ref=c.ref,
        checkpoint=parent_checkpoint,
        pending_operation_ids=(pending.pending_operation_id,),
        expected_generation=0,
    )
    assert receipt.wait_reason == "interaction"
    with c.factory() as session:
        assert session.scalar(select(NativeDispatch).where(NativeDispatch.request_id == c.ref.request_id)) is None
    service.complete(
        child_ref=child,
        outcome=NativeWorkflowOutcome(
            status="completed",
            ref=child,
            native_run_id="child-run",
            checkpoint_ref=None,
            pending_operation_ids=(),
            wait_reason=None,
            reason_code=None,
            native_status="succeeded",
            output_result_ref=None,
        ),
    )
    with c.factory() as session:
        dispatch = session.scalar(select(NativeDispatch).where(NativeDispatch.request_id == c.ref.request_id))
        assert dispatch.invocation_id == c.ref.invocation_id
        state = session.scalar(
            select(NativeInvocationState).where(
                NativeInvocationState.request_id == c.ref.request_id,
                NativeInvocationState.invocation_id == c.ref.invocation_id,
            )
        )
        assert state.checkpoint_id == parent_checkpoint.checkpoint_id
        assert state.state == "queued"


def test_cancellation_of_unclaimed_dispatch_never_launches(continuation_case):
    c = continuation_case
    c.pause()
    c.ledger.confirm()
    receipt = c.resume()
    cancelled = c.lifecycle.cancel(actor=c.ledger.actor, request_id=c.ref.request_id, idempotency_key="cancel-1")
    assert cancelled.status == "cancelling"  # no native physical cleanup evidence
    assert set(cancelled.operation_states.values()) == {"not_dispatched"}
    with pytest.raises(BuilderExecutionPolicyError):
        c.lifecycle.claim_dispatch(ref=c.ref, generation=receipt.generation, dispatch_id=receipt.dispatch_id)
    assert c.lifecycle.publish_pending(publish=lambda **_kwargs: pytest.fail("cancelled request published")) == 0
    assert c.ledger.dispatched_attempt_count() == 0


def test_migration_keeps_checkpoint_and_payload_evidence_immutable(continuation_case):
    from sqlalchemy.exc import DBAPIError

    from models.dify_builder_native_tests import NativeContinuation, NativePayloadObject

    c = continuation_case
    cp = c.checkpoint()
    with c.factory() as session:
        assert (
            session.scalar(text("SELECT obj_description('dify_builder_native_dispatches'::regclass)"))
            == "ci-alembic:d28f0e3c912a"
        )
        row = session.get(NativePayloadObject, cp.checkpoint_id)
        row.storage_key = "replacement"
        with pytest.raises(DBAPIError, match="append-only"):
            session.commit()
    with c.factory() as session:
        row = session.scalar(select(NativeContinuation).where(NativeContinuation.checkpoint_id == cp.checkpoint_id))
        session.delete(row)
        with pytest.raises(DBAPIError, match="append-only"):
            session.commit()


def test_native_runtime_uses_same_checkpoint_and_terminal_stops_new_effects(continuation_case):
    c = continuation_case
    cp = c.pause().checkpoint
    c.ledger.confirm()
    receipt = c.resume()
    calls = []

    class RuntimeOwner:
        def resume(self, *, context, checkpoint, resolutions):
            calls.append((context.native_run_id, checkpoint.native_run_id, resolutions))
            return NativeWorkflowOutcome(
                status="completed",
                ref=context.ref,
                native_run_id=context.native_run_id,
                checkpoint_ref=None,
                pending_operation_ids=(),
                reason_code=None,
                wait_reason=None,
                native_status="succeeded",
                output_result_ref=None,
            )

    c.lifecycle.runtime = RuntimeOwner()
    outcome = c.lifecycle.execute_dispatch(ref=c.ref, generation=receipt.generation, dispatch_id=receipt.dispatch_id)
    assert outcome.status == "completed"
    assert calls == [("native-run", "native-run", ())]
    assert not c.lifecycle.claim_dispatch(ref=c.ref, generation=receipt.generation, dispatch_id=receipt.dispatch_id)
    assert c.ledger.guard.before_call(ref=c.ref, intent=c.ledger.intent).kind == "stop"
    with c.factory() as session:
        assert session.get(DifyBuilderExecutionRequest, c.ref.request_id).state == "sealed"
    assert cp.checkpoint_id


def test_cancel_cleanup_reconciles_actual_native_evidence(continuation_case):
    from models.dify_builder_native_tests import NativeInvocationState

    c = continuation_case
    c.pause()
    receipt = c.lifecycle.cancel(actor=c.ledger.actor, request_id=c.ref.request_id, idempotency_key="cancel")
    assert receipt.status == "cancelling"

    class RuntimeOwner:
        def cancel(self, *, refs):
            return tuple(ref.invocation_id for ref in refs)

    c.lifecycle.runtime = RuntimeOwner()
    assert c.lifecycle.reconcile() == 1
    with c.factory() as session:
        state = session.scalar(
            select(NativeInvocationState).where(NativeInvocationState.request_id == c.ref.request_id)
        )
        assert state.cleanup_complete is True
        assert session.get(DifyBuilderExecutionRequest, c.ref.request_id).state == "sealed"
    assert (
        c.lifecycle.cancel(actor=c.ledger.actor, request_id=c.ref.request_id, idempotency_key="cancel").status
        == "cancelled"
    )
