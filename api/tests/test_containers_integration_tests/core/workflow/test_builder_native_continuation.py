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
from sqlalchemy import inspect, select, text

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
            _migration("2026_10_15_0900-f47a1c90d2e8_bind_native_invocation_read_owners.py").upgrade()
        connection.execute(text("COMMENT ON TABLE dify_builder_native_dispatches IS 'ci-alembic:d28f0e3c912a'"))


class ResolutionOwner:
    resolved = False

    def resolve(self, *, session, owned, pending):
        from services.dify_builder.native_testing.lifecycle import NativePendingResolution

        assert session.in_transaction()
        assert pending.tenant_id == owned.tenant_id
        return NativePendingResolution(
            category=pending.category,
            invocation_id=pending.invocation_id,
            pending_action_id=pending.id,
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
def continuation_case(ledger_case, native_owner):
    from extensions.ext_database import db
    from libs.key_providers import generate_key_pair
    from services.dify_builder.native_testing.lifecycle import NativeTestLifecycleService
    from services.dify_builder.native_testing.repository import OwnedNativeTestLoader
    from services.dify_builder.native_testing.state_store import NativeExecutionStateStore

    # native_owner commits with expire_on_commit=True and leaves materialized
    # setup objects in the scoped identity map. Close those committed setup
    # reads before updating the key through a separate service Session. Keep
    # its strict teardown's original app/workflow IDs materialized and detached.
    _, _, app, workflow, _, _ = native_owner
    assert app.id
    assert workflow.id
    db.session.expunge(app)
    db.session.expunge(workflow)
    db.session.close()
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
    replayed = child_service.get_outcome(child_ref=child)
    assert replayed.output_result_ref == result_ref
    assert c.store.load_result(ref=child, result_ref=replayed.output_result_ref) == {"ok": True}


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
    # Spawn initializes every owner independently; no inherited Flask contexts,
    # threaded OpenDAL runtime, SQL pool, Redis sockets or crypto provider cache.
    try:
        from sqlalchemy.orm import sessionmaker
        from sqlalchemy.pool import NullPool

        from app_factory import create_flask_app_with_configs
        from core.db.session_factory import session_factory
        from extensions import ext_database, ext_key_provider, ext_redis, ext_storage
        from services.dify_builder.native_testing.lifecycle import NativeTestLifecycleService
        from services.dify_builder.native_testing.repository import OwnedNativeTestLoader
        from services.dify_builder.native_testing.state_store import NativeExecutionStateStore
        from tests.test_containers_integration_tests.core.workflow.test_builder_native_effect_ledger import (
            MetadataOwner,
        )

        app = create_flask_app_with_configs()
        app.config["SQLALCHEMY_DATABASE_URI"] = url
        app.config["SQLALCHEMY_ENGINE_OPTIONS"] = {"poolclass": NullPool}
        ext_database.init_app(app)
        ext_redis.init_app(app)
        ext_storage.init_app(app)
        ext_key_provider.init_app(app)
        with app.app_context():
            session_factory.configure(ext_database.db.engine)
            factory = sessionmaker(bind=ext_database.db.engine, expire_on_commit=False)
            loader = OwnedNativeTestLoader(factory, actor=actor, resolver=MetadataOwner())
            service = NativeTestLifecycleService(loader, state_store=NativeExecutionStateStore(loader))
            barrier.wait(timeout=60)
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
    ctx = multiprocessing.get_context("spawn")
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
            process.join(timeout=60)
        assert all(not process.is_alive() and process.exitcode == 0 for process in processes)
        assert all(pair[0].poll(5) for pair in pairs)
        rows = [pair[0].recv() for pair in pairs]
        assert all(row[0] != "error" for row in rows), rows
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


@pytest.mark.parametrize("fault", ["missing", "corrupt"])
def test_resume_rechecks_checkpoint_before_consuming_generation(continuation_case, monkeypatch, fault):
    from extensions.ext_storage import storage
    from models.dify_builder_native_tests import NativeContinuation, NativeDispatch, NativeTestScope

    c = continuation_case
    cp = c.pause().checkpoint
    c.ledger.confirm()
    with c.factory() as session:
        storage_key = session.scalar(
            select(NativeContinuation.payload_ref).where(NativeContinuation.checkpoint_id == cp.checkpoint_id)
        )
    original = storage.load

    def unavailable(key, *args, **kwargs):
        if key == storage_key:
            if fault == "missing":
                raise FileNotFoundError("checkpoint deleted")
            return b"corrupt ciphertext"
        return original(key, *args, **kwargs)

    monkeypatch.setattr(storage, "load", unavailable)
    with pytest.raises(BuilderExecutionPolicyError, match="checkpoint_unavailable"):
        c.resume()
    with c.factory() as session:
        assert session.get(NativeTestScope, c.ref.request_id).generation == 0
        assert session.scalar(select(NativeDispatch).where(NativeDispatch.request_id == c.ref.request_id)) is None


def test_resumed_child_can_checkpoint_a_second_native_wait(continuation_case):
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
    key = OperationKey(invocation_id=c.ref.invocation_id, occurrence_path=("repeat-child",), cursor=0)
    input_ref = c.store.store_result(ref=c.ref, key=key, result={"nested": True})
    child = service.get_or_create(
        parent_ref=c.ref,
        key=key,
        child_app_id=c.context.app_id,
        child_workflow_revision=c.context.graph_revision,
        input_digest=canonical_digest({"nested": True}),
        input_result_ref=input_ref,
    )
    pending_service = NativePendingActionService(c.store.loader)
    first = pending_service.configuration(ref=child, requirements_ref="configuration-1", expected_generation=0)
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
    c.lifecycle.pause(
        ref=child,
        checkpoint=child_checkpoint,
        pending_operation_ids=(first.pending_operation_id,),
        expected_generation=0,
    )
    parent_checkpoint = c.store.commit_checkpoint(
        ref=c.ref,
        generation=0,
        payload=payload.model_copy(update={"native_run_id": "native-run", "child_refs": (child,)}),
    )
    c.lifecycle.pause(
        ref=c.ref,
        checkpoint=parent_checkpoint,
        pending_operation_ids=(first.pending_operation_id,),
        expected_generation=0,
    )
    c.resolution.resolved = True
    resumed = c.resume()
    assert c.lifecycle.claim_dispatch(ref=c.ref, generation=resumed.generation, dispatch_id=resumed.dispatch_id)
    assert c.store.load_context(ref=child).generation == 1
    second = pending_service.configuration(ref=child, requirements_ref="configuration-1", expected_generation=1)
    second_checkpoint = c.store.commit_checkpoint(
        ref=child, generation=1, payload=payload.model_copy(update={"generation": 1})
    )
    second_wait = c.lifecycle.pause(
        ref=child,
        checkpoint=second_checkpoint,
        pending_operation_ids=(second.pending_operation_id,),
        expected_generation=1,
    )
    assert second_wait.generation == 1
    assert second_checkpoint.checkpoint_id != child_checkpoint.checkpoint_id


def test_unknown_root_quarantines_active_child_tree(continuation_case):
    from models.dify_builder_native_tests import NativeDispatch, NativeTestInvocation
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
                    "call_depth": 1,
                    "inputs": inputs,
                    "input_revision": canonical_digest(inputs),
                    "native_run_id": "child-run",
                }
            )

    service = NativeChildInvocationService(c.store, resolver=ChildOwner())
    key = OperationKey(invocation_id=c.ref.invocation_id, occurrence_path=("parallel-child",), cursor=0)
    input_ref = c.store.store_result(ref=c.ref, key=key, result={"nested": True})
    child = service.get_or_create(
        parent_ref=c.ref,
        key=key,
        child_app_id=c.context.app_id,
        child_workflow_revision=c.context.graph_revision,
        input_digest=canonical_digest({"nested": True}),
        input_result_ref=input_ref,
    )
    c.pause()
    c.ledger.confirm()
    resumed = c.resume()
    assert c.lifecycle.claim_dispatch(ref=c.ref, generation=resumed.generation, dispatch_id=resumed.dispatch_id)
    with c.factory.begin() as session:
        session.get(NativeDispatch, resumed.dispatch_id).claim_expires_at = datetime.now(UTC) - timedelta(seconds=1)
    c.lifecycle.reconcile()
    with c.factory() as session:
        assert not any(
            session.scalars(
                select(NativeTestInvocation.active).where(NativeTestInvocation.request_id == c.ref.request_id)
            )
        )
    with pytest.raises(BuilderExecutionPolicyError):
        c.store.load_context(ref=child)


def _child_case(c, parent_ref=None, app_id=None, workflow_id=None):
    from services.dify_builder.native_testing.child_invocations import NativeChildInvocationService
    from services.dify_builder.native_testing.repository import native_workflow_revision

    parent_ref = parent_ref or c.ref
    with c.factory() as session:
        workflow = session.get(Workflow, workflow_id or c.context.workflow_id)
        revision, graph = native_workflow_revision(workflow), json.loads(workflow.graph)
        workflow_id, app_id = workflow.id, app_id or workflow.app_id

    class ChildOwner:
        def resolve_child(self, *, parent, ref, child_app_id, child_workflow_revision, inputs):
            return parent.model_copy(
                update={
                    "ref": ref,
                    "parent_invocation_id": parent.ref.invocation_id,
                    "call_depth": parent.call_depth + 1,
                    "inputs": inputs,
                    "input_revision": canonical_digest(inputs),
                    "app_id": child_app_id,
                    "workflow_id": workflow_id,
                    "graph": graph,
                    "graph_revision": child_workflow_revision,
                    "native_run_id": "child-" + ref.invocation_id,
                }
            )

    service = NativeChildInvocationService(c.store, resolver=ChildOwner())
    key = OperationKey(invocation_id=parent_ref.invocation_id, occurrence_path=(str(uuid4()),), cursor=0)
    result = c.store.store_result(ref=parent_ref, key=key, result={"child": True})
    ref = service.get_or_create(
        parent_ref=parent_ref,
        key=key,
        child_app_id=app_id,
        child_workflow_revision=revision,
        input_digest=canonical_digest({"child": True}),
        input_result_ref=result,
    )
    return service, ref


def _unknown_outcome(c, ref):
    return NativeWorkflowOutcome(
        status="unknown",
        ref=ref,
        native_run_id=c.store.load_context(ref=ref).native_run_id,
        checkpoint_ref=None,
        pending_operation_ids=(),
        reason_code="native_lost",
        wait_reason=None,
        native_status=None,
        output_result_ref=None,
    )


def _bind_child_effect(c, ref):
    from models.dify_builder_native_tests import NativeTestInvocation
    from services.dify_builder.native_testing.contracts import operation_digest
    from services.dify_builder.native_testing.repository import NativeBinding

    intent = c.ledger.intent.model_copy(
        update={"key": c.ledger.intent.key.model_copy(update={"invocation_id": ref.invocation_id})}
    )
    with c.factory.begin() as session:
        root = session.scalar(
            select(NativeTestInvocation).where(
                NativeTestInvocation.request_id == c.ref.request_id,
                NativeTestInvocation.invocation_id == c.ref.invocation_id,
            )
        )
        child = session.scalar(
            select(NativeTestInvocation).where(
                NativeTestInvocation.request_id == ref.request_id,
                NativeTestInvocation.invocation_id == ref.invocation_id,
            )
        )
        binding = NativeBinding.model_validate(root.bindings[operation_digest(c.ledger.intent.key)])
        child.bindings = {
            operation_digest(intent.key): binding.model_copy(
                update={"intent_digest": canonical_digest(intent.model_dump(mode="json"))}
            ).model_dump(mode="json")
        }
    # A valid owned occurrence reaches approval before quarantine; mismatch-based
    # rejection would not prove that authority was actually revoked.
    assert c.ledger.guard.before_call(ref=ref, intent=intent).kind == "waiting"
    return intent


def test_returned_unknown_root_quarantines_descendants(continuation_case):
    from models.dify_builder_native_tests import NativeTestInvocation

    c = continuation_case
    _, child = _child_case(c)
    _, grandchild = _child_case(c, child)
    completed_service, completed = _child_case(c)
    saved = _private_material(c, completed)
    completed_outcome = NativeWorkflowOutcome(
        status="completed",
        ref=completed,
        native_run_id=c.store.load_context(ref=completed).native_run_id,
        checkpoint_ref=None,
        pending_operation_ids=(),
        reason_code=None,
        wait_reason=None,
        native_status="succeeded",
        output_result_ref=None,
    )
    completed_service.complete(child_ref=completed, outcome=completed_outcome)
    effects = {ref.invocation_id: _bind_child_effect(c, ref) for ref in (child, grandchild)}
    outcome = _unknown_outcome(c, c.ref)
    c.pause()
    c.ledger.confirm()
    receipt = c.resume()

    class RuntimeOwner:
        def resume(self, **_kwargs):
            return outcome

        def recovery_evidence(self, **_kwargs):
            return None

    c.lifecycle.runtime = RuntimeOwner()
    assert (
        c.lifecycle.execute_dispatch(ref=c.ref, generation=receipt.generation, dispatch_id=receipt.dispatch_id)
        == outcome
    )
    with c.factory() as session:
        assert not any(
            session.scalars(
                select(NativeTestInvocation.active).where(NativeTestInvocation.request_id == c.ref.request_id)
            )
        )
    assert completed_service.get_outcome(child_ref=completed) == completed_outcome
    assert saved["result"]() == {"secret": 42}
    assert saved["checkpoint"]().generation == 0
    for ref in (child, grandchild):
        assert c.ledger.guard.before_call(ref=ref, intent=effects[ref.invocation_id]).kind == "stop"
    with pytest.raises(BuilderExecutionPolicyError, match="native_recovery_unproven"):
        c.lifecycle.recover_dispatch(ref=c.ref, dispatch_id=receipt.dispatch_id)
    assert c.ledger.dispatched_attempt_count() == 0


def test_unknown_child_does_not_wake_parent_or_leave_grandchild_active(continuation_case):
    from models.dify_builder_native_tests import NativeDispatch, NativeTestInvocation

    c = continuation_case
    service, child = _child_case(c)
    _, grandchild = _child_case(c, child)
    effect = _bind_child_effect(c, grandchild)
    outcome = _unknown_outcome(c, child)
    c.pause()
    service.complete(child_ref=child, outcome=outcome)
    with c.factory() as session:
        assert session.scalar(select(NativeDispatch.id).where(NativeDispatch.request_id == c.ref.request_id)) is None
        assert not any(
            session.scalars(
                select(NativeTestInvocation.active).where(
                    NativeTestInvocation.request_id == c.ref.request_id,
                    NativeTestInvocation.invocation_id.in_((child.invocation_id, grandchild.invocation_id)),
                )
            )
        )
    c.ledger.confirm()
    assert c.ledger.guard.before_call(ref=grandchild, intent=effect).kind == "stop"
    with pytest.raises(BuilderExecutionPolicyError):
        c.resume()
    assert c.ledger.dispatched_attempt_count() == 0


def _private_material(c, ref):
    context = c.store.load_context(ref=ref)
    result = c.store.store_result(
        ref=ref,
        key=OperationKey(invocation_id=ref.invocation_id, occurrence_path=("private",), cursor=0),
        result={"secret": 42},
    )
    checkpoint = c.store.commit_checkpoint(
        ref=ref,
        generation=0,
        payload=NativeCheckpointPayload(
            schema_version="1",
            native_run_id=context.native_run_id,
            generation=0,
            generate_entity_json="{}",
            graph_runtime_state_json="{}",
            response_stream_filter_json="{}",
            node_journals=(),
            child_refs=(),
            input_result_refs=(),
        ),
    )
    return {
        "result": lambda: c.store.load_result(ref=ref, result_ref=result),
        "checkpoint": lambda: c.store.read_checkpoint(ref=ref, checkpoint=checkpoint),
        "recovery": lambda: c.store.load_recovery_context(ref=ref),
        "context": lambda: c.store.load_context(ref=ref),
    }


@pytest.mark.parametrize("child", [False, True])
@pytest.mark.parametrize("read", ["result", "checkpoint", "recovery", "context"])
@pytest.mark.parametrize("revocation", ["removed", "downgraded"])
def test_current_membership_required_before_private_decrypt(continuation_case, monkeypatch, child, read, revocation):
    from configs import dify_config
    from models.account import TenantAccountJoin

    c = continuation_case
    monkeypatch.setattr(dify_config, "RBAC_ENABLED", False)
    ref = _child_case(c)[1] if child else c.ref
    readers = _private_material(c, ref)
    with c.factory.begin() as session:
        membership = session.scalar(
            select(TenantAccountJoin).where(
                TenantAccountJoin.tenant_id == c.ledger.actor.tenant_id,
                TenantAccountJoin.account_id == c.ledger.actor.account_id,
            )
        )
        if revocation == "removed":
            session.delete(membership)
        else:
            membership.role = "normal"
    monkeypatch.setattr(c.store, "_read_object", lambda *_: pytest.fail("private decrypt after revocation"))
    with pytest.raises(BuilderExecutionPolicyError):
        readers[read]()


@pytest.mark.parametrize("read", ["result", "checkpoint", "recovery", "context"])
def test_actual_child_app_permission_checked_before_decrypt(continuation_case, monkeypatch, read):
    from configs import dify_config
    from models.model import App
    from services.enterprise.rbac_service import RBACService

    c = continuation_case
    # Copy actual database-owned app/workflow metadata into a distinct app.
    with c.factory.begin() as session:
        original = session.get(App, c.context.app_id)
        app = App(**{attr.key: getattr(original, attr.key) for attr in inspect(App).column_attrs if attr.key != "id"})
        app.id, app.maintainer = str(uuid4()), str(uuid4())
        original_workflow = session.get(Workflow, c.context.workflow_id)
        workflow = Workflow(
            **{
                attr.key: getattr(original_workflow, attr.key)
                for attr in inspect(Workflow).column_attrs
                if attr.key != "id"
            }
        )
        workflow.id, workflow.app_id = str(uuid4()), app.id
        app.workflow_id = workflow.id
        session.add_all((app, workflow))
        app_id, workflow_id = app.id, workflow.id
    try:
        _, child = _child_case(c, app_id=app_id, workflow_id=workflow_id)
        readers = _private_material(c, child)
        root_readers = _private_material(c, c.ref)
        monkeypatch.setattr(dify_config, "RBAC_ENABLED", True)
        calls = []

        def check(tenant_id, actor_id, *, scene, resource_type, resource_id):
            assert (tenant_id, actor_id) == (c.ledger.actor.tenant_id, c.ledger.actor.account_id)
            assert scene is not None
            assert resource_type is not None
            calls.append(resource_id)
            return resource_id == c.context.app_id

        monkeypatch.setattr(RBACService.CheckAccess, "check", check)
        assert root_readers["result"]() == {"secret": 42}
        monkeypatch.setattr(c.store, "_read_object", lambda *_: pytest.fail("child private decrypt before permission"))
        with pytest.raises(BuilderExecutionPolicyError, match="execution_permission_denied"):
            readers[read]()
        assert app_id in calls
    finally:
        with c.factory.begin() as session:
            session.delete(session.get(Workflow, workflow_id))
            session.delete(session.get(App, app_id))


def test_spent_result_write_survives_membership_revocation_but_read_does_not(continuation_case):
    from models.account import TenantAccountJoin

    c = continuation_case
    c.ledger.confirm()
    permit = c.ledger.guard.before_call(ref=c.ref, intent=c.ledger.intent)
    assert permit.kind == "dispatch"
    with c.factory.begin() as session:
        membership = session.scalar(
            select(TenantAccountJoin).where(
                TenantAccountJoin.tenant_id == c.ledger.actor.tenant_id,
                TenantAccountJoin.account_id == c.ledger.actor.account_id,
            )
        )
        session.delete(membership)
    result = c.store.store_result(ref=c.ref, key=c.ledger.intent.key, result={"spent": True})
    c.ledger.guard.record_outcome(permit=permit, outcome="completed", result_ref=result)
    with pytest.raises(BuilderExecutionPolicyError):
        c.store.load_result(ref=c.ref, result_ref=result)
    assert c.ledger.guard.before_call(ref=c.ref, intent=c.ledger.intent).kind == "stop"


@pytest.mark.parametrize(
    "field",
    [
        "id",
        "tenant_id",
        "request_id",
        "invocation_id",
        "app_id",
        "workflow_id",
        "context_object_id",
        "parent_invocation_id",
        "parent_operation_digest",
        "child_identity_digest",
    ],
)
def test_invocation_read_owner_is_sql_immutable(continuation_case, field):
    from sqlalchemy.exc import DBAPIError

    from models.dify_builder_native_tests import NativeInvocationState

    c = continuation_case
    with c.factory() as session:
        state = session.scalar(
            select(NativeInvocationState).where(NativeInvocationState.request_id == c.ref.request_id)
        )
        assert (state.app_id, state.workflow_id) == (c.context.app_id, c.context.workflow_id)
        setattr(state, field, str(uuid4()))
        with pytest.raises(DBAPIError, match="read owner is immutable"):
            session.commit()
    with c.factory.begin() as session:
        state = session.scalar(
            select(NativeInvocationState).where(NativeInvocationState.request_id == c.ref.request_id)
        )
        state.generation, state.state = 1, "queued"
    with c.factory() as session:
        state = session.scalar(
            select(NativeInvocationState).where(NativeInvocationState.request_id == c.ref.request_id)
        )
        assert state.generation == 1
        assert state.state == "queued"


def test_legacy_null_owner_fails_closed_without_decrypt(continuation_case, monkeypatch):
    from models.dify_builder_native_tests import NativeInvocationState, NativeTestInvocation

    c = continuation_case
    with c.factory.begin() as session:
        original = session.scalar(
            select(NativeInvocationState).where(NativeInvocationState.request_id == c.ref.request_id)
        )
        state = NativeInvocationState(
            **{
                attr.key: getattr(original, attr.key)
                for attr in inspect(NativeInvocationState).column_attrs
                if attr.key != "id"
            }
        )
        state.id, state.invocation_id = str(uuid4()), str(uuid4())
        state.app_id = state.workflow_id = None
        session.add(state)
        session.add(
            NativeTestInvocation(
                tenant_id=c.ledger.actor.tenant_id,
                request_id=c.ref.request_id,
                invocation_id=state.invocation_id,
                active=True,
                bindings={},
            )
        )
        ref = c.ref.model_copy(update={"invocation_id": state.invocation_id})
    monkeypatch.setattr(c.store, "_read_object", lambda *_: pytest.fail("legacy owner must not decrypt"))
    with pytest.raises(BuilderExecutionPolicyError, match="native_read_owner_unavailable"):
        c.store.load_recovery_context(ref=ref)


def test_invocation_read_owner_must_be_paired(continuation_case):
    from sqlalchemy.exc import IntegrityError

    from models.dify_builder_native_tests import NativeInvocationState

    c = continuation_case
    with c.factory() as session:
        original = session.scalar(
            select(NativeInvocationState).where(NativeInvocationState.request_id == c.ref.request_id)
        )
        state = NativeInvocationState(
            **{
                attr.key: getattr(original, attr.key)
                for attr in inspect(NativeInvocationState).column_attrs
                if attr.key != "id"
            }
        )
        state.id, state.invocation_id, state.workflow_id = str(uuid4()), str(uuid4()), None
        session.add(state)
        with pytest.raises(IntegrityError):
            session.commit()
