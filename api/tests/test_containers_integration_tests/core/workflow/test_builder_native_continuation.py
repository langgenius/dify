"""Normal-CI-only PostgreSQL + real storage/key owner continuation tests.

Explicit queue/runtime counters prove orchestration, not native Graphon reconstruction.
"""
from datetime import UTC, datetime, timedelta
from dataclasses import dataclass
from uuid import uuid4

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import select, text

from core.dify_builder.models import Actor
from models.account import Tenant
from models.dify_builder import DifyBuilderExecutionRequest
from services.dify_builder.execution_contracts import BuilderExecutionPolicyError, canonical_digest
from services.dify_builder.native_testing.contracts import CheckpointRef, OperationKey, PolicyStop
from services.dify_builder.native_testing.runtime_contracts import NativeCheckpointPayload, NativeWorkflowOutcome, ResolvedNativeTestContext
from tests.test_containers_integration_tests.core.workflow.test_builder_native_effect_ledger import (
    _migration, ledger_case as ledger_case, migrated_native_tables as migrated_native_tables,
    native_owner as native_owner, no_live as no_live,
)


@pytest.fixture(scope="module", autouse=True)
def migrated_continuation_tables(flask_app_with_containers, migrated_native_tables):
    from extensions.ext_database import db
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
        return NativePendingResolution(category=pending.category, owner_ref=pending.owner_ref,
            reference=pending.reference, resolved=self.resolved,
            account_ref="actual-account" if self.resolved and pending.category == "configuration" else None,
            answer_result_ref=self.answer_ref if self.resolved and pending.category == "interaction" else None)


@dataclass
class ContinuationCase:
    ledger: object
    store: object
    lifecycle: object
    resolution: object
    context: object
    @property
    def ref(self): return self.ledger.ref
    @property
    def factory(self): return self.ledger.factory
    def checkpoint(self, generation=0):
        return self.store.commit_checkpoint(ref=self.ref, generation=generation, payload=NativeCheckpointPayload(
            schema_version="1", native_run_id="native-run", generation=generation,
            generate_entity_json='{"secret_history":"private-value"}', graph_runtime_state_json='{"cursor":0}',
            response_stream_filter_json='{}', node_journals=(), child_refs=(), input_result_refs=()))
    def pause(self):
        pending = self.ledger.guard.before_call(ref=self.ref, intent=self.ledger.intent)
        cp = self.checkpoint()
        return self.lifecycle.pause(ref=self.ref, checkpoint=cp, pending_operation_ids=(pending.pending_operation_id,), expected_generation=0)
    def resume(self, key="resume-1", generation=0):
        return self.lifecycle.resume(actor=self.ledger.actor, request_id=self.ref.request_id, expected_generation=generation, idempotency_key=key)


@pytest.fixture
def continuation_case(ledger_case):
    from libs.key_providers import generate_key_pair
    from services.dify_builder.native_testing.repository import OwnedNativeTestLoader
    from services.dify_builder.native_testing.state_store import NativeExecutionStateStore
    from services.dify_builder.native_testing.lifecycle import NativeTestLifecycleService
    # The existing tenant key owner provisions real synthetic RSA/hybrid storage.
    public_key = generate_key_pair(ledger_case.actor.tenant_id)
    with ledger_case.factory.begin() as session:
        session.get(Tenant, ledger_case.actor.tenant_id).encrypt_public_key = public_key
        request = session.get(DifyBuilderExecutionRequest, ledger_case.ref.request_id)
        app_id, workflow_id = request.app_id, request.workflow_id
    loader = OwnedNativeTestLoader(ledger_case.factory, actor=ledger_case.actor, resolver=ledger_case.metadata)
    store = NativeExecutionStateStore(loader)
    context = ResolvedNativeTestContext(ref=ledger_case.ref, tenant_id=ledger_case.actor.tenant_id,
        actor_id=ledger_case.actor.account_id, app_id=app_id, workflow_id=workflow_id,
        graph={"nodes": []}, inputs={"boolean": True}, graph_revision="graph-v1",
        input_revision=canonical_digest({"boolean": True}), resource_manifest=(), generation=0,
        root_native_run_id="native-run", native_run_id="native-run", parent_invocation_id=None,
        call_depth=0, budget_ref=ledger_case.ref.request_id, cancellation_ref=ledger_case.ref.request_id, execution_mode="native")
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
        encrypted = storage.load(row.payload_ref)
    assert b"private-value" not in encrypted
    c.context.inputs["boolean"] = "true"
    assert c.store.load_context(ref=c.ref).inputs == {"boolean": True}


def test_missing_checkpoint_ack_never_reports_resumable_waiting(continuation_case, monkeypatch):
    from extensions.ext_storage import storage
    from models.dify_builder_native_tests import NativeContinuation
    c = continuation_case
    monkeypatch.setattr(storage, "save", lambda *args: (_ for _ in ()).throw(OSError("storage unavailable")))
    with pytest.raises(BuilderExecutionPolicyError, match="checkpoint_unavailable"):
        c.checkpoint()
    with c.factory() as session:
        assert session.scalar(select(NativeContinuation).where(NativeContinuation.request_id == c.ref.request_id)) is None
        assert session.get(DifyBuilderExecutionRequest, c.ref.request_id).state == "running"
    assert c.ledger.dispatched_attempt_count() == 0


def test_fake_checkpoint_and_cross_invocation_reference_rejected(continuation_case):
    c = continuation_case
    pending = c.ledger.guard.before_call(ref=c.ref, intent=c.ledger.intent)
    with pytest.raises(BuilderExecutionPolicyError):
        c.lifecycle.pause(ref=c.ref, checkpoint=CheckpointRef(checkpoint_id=str(uuid4()), payload_digest="a"*64),
            pending_operation_ids=(pending.pending_operation_id,), expected_generation=0)
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
    c.pause(); c.ledger.confirm()
    first = c.resume()
    assert c.resume() == first
    with pytest.raises(BuilderExecutionPolicyError): c.resume(key="different")
    assert c.lifecycle.claim_dispatch(ref=c.ref, generation=first.generation, dispatch_id=first.dispatch_id)
    assert not c.lifecycle.claim_dispatch(ref=c.ref, generation=first.generation, dispatch_id=first.dispatch_id)


def test_enqueue_ack_loss_republishes_same_dispatch(continuation_case):
    c = continuation_case
    c.pause(); c.ledger.confirm(); receipt = c.resume()
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
    c.pause(); c.ledger.confirm(); receipt = c.resume()
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
    pending = (pending_service.configuration(ref=c.ref, requirements_ref="configuration-1", expected_generation=0)
        if reason == "configuration" else pending_service.interaction(ref=c.ref, native_form_ref="form-1", expected_generation=0))
    receipt = c.lifecycle.pause(ref=c.ref, checkpoint=c.checkpoint(), pending_operation_ids=(pending.pending_operation_id,), expected_generation=0)
    assert receipt.wait_reason == reason
    c.ledger.confirm()  # An outbound approval does not resolve either owner.
    with pytest.raises(BuilderExecutionPolicyError, match="native_pending_unresolved"): c.resume()
    c.resolution.resolved = True
    if reason == "interaction":
        c.resolution.answer_ref = c.store.store_result(ref=c.ref, key=OperationKey(invocation_id=c.ref.invocation_id, occurrence_path=("form",), cursor=0), result={"answer": "authentic"})
    assert c.resume().status == "queued"
    assert c.ledger.dispatched_attempt_count() == 0


def test_cancellation_stops_tree_and_projects_claimed_unknown(continuation_case):
    c = continuation_case
    c.ledger.confirm()
    permit = c.ledger.guard.before_call(ref=c.ref, intent=c.ledger.intent)
    receipt = c.lifecycle.cancel(actor=c.ledger.actor, request_id=c.ref.request_id, idempotency_key="cancel-1")
    assert receipt.status == "unknown"
    assert receipt.operation_states[permit.operation_id] == "unknown"
    with pytest.raises(BuilderExecutionPolicyError): c.store.load_context(ref=c.ref)
    # Already-spent effects retain their C02 settlement path after cancellation.
    c.ledger.guard.record_outcome(permit=permit, outcome="completed", result_ref="protected-result")
    assert c.ledger.dispatched_attempt_count() == 1


def test_expiry_revision_drift_and_actor_revocation_fail_resume(continuation_case, monkeypatch):
    from models.dify_builder_native_tests import NativeTestScope
    c = continuation_case
    c.pause(); c.ledger.confirm()
    with pytest.raises(BuilderExecutionPolicyError):
        c.lifecycle.resume(actor=Actor(account_id=str(uuid4()), tenant_id=c.ledger.actor.tenant_id), request_id=c.ref.request_id, expected_generation=0, idempotency_key="foreign")
    with c.factory.begin() as session:
        session.get(NativeTestScope, c.ref.request_id).expires_at = datetime.now(UTC) - timedelta(seconds=1)
    with pytest.raises(BuilderExecutionPolicyError, match="native_expired"): c.resume()


def test_production_dispatch_without_native_collaborator_fails_closed(continuation_case):
    c = continuation_case
    c.pause(); c.ledger.confirm(); receipt = c.resume()
    with pytest.raises(BuilderExecutionPolicyError, match="native_runtime_unavailable"):
        c.lifecycle.execute_dispatch(ref=c.ref, generation=receipt.generation, dispatch_id=receipt.dispatch_id)
    assert c.ledger.dispatched_attempt_count() == 0


def test_child_input_owner_and_unique_identity_and_completion_wakeup(continuation_case):
    from services.dify_builder.native_testing.child_invocations import NativeChildInvocationService
    from models.dify_builder_native_tests import NativeDispatch
    c = continuation_case
    class ChildOwner:
        def resolve_child(self, *, parent, ref, child_app_id, child_workflow_revision, inputs):
            return parent.model_copy(update={"ref": ref, "parent_invocation_id": parent.ref.invocation_id,
                "call_depth": parent.call_depth+1, "inputs": inputs, "input_revision": canonical_digest(inputs),
                "app_id": child_app_id, "graph_revision": child_workflow_revision, "native_run_id": "child-run"})
    child_service = NativeChildInvocationService(c.store, resolver=ChildOwner())
    key = OperationKey(invocation_id=c.ref.invocation_id, occurrence_path=("child",), cursor=0)
    input_ref = c.store.store_result(ref=c.ref, key=key, result={"nested": True})
    args = dict(parent_ref=c.ref, key=key, child_app_id=c.context.app_id, child_workflow_revision=c.context.graph_revision,
                input_digest=canonical_digest({"nested": True}), input_result_ref=input_ref)
    with pytest.raises(BuilderExecutionPolicyError): child_service.get_or_create(**{**args, "input_digest": "f"*64})
    child = child_service.get_or_create(**args)
    assert child_service.get_or_create(**args) == child
    assert c.store.load_context(ref=child).parent_invocation_id == c.ref.invocation_id
    result_ref = c.store.store_result(ref=child, key=OperationKey(invocation_id=child.invocation_id, occurrence_path=("output",), cursor=0), result={"ok": True})
    outcome = NativeWorkflowOutcome(status="completed", ref=child, native_run_id="child-run", checkpoint_ref=None,
        pending_operation_ids=(), reason_code=None, wait_reason=None, native_status="succeeded", output_result_ref=result_ref)
    child_service.complete(child_ref=child, outcome=outcome)
    child_service.complete(child_ref=child, outcome=outcome)
    with c.factory() as session:
        rows = session.scalars(select(NativeDispatch).where(NativeDispatch.request_id == c.ref.request_id)).all()
        assert len(rows) == 1
        assert rows[0].invocation_id == c.ref.invocation_id
    assert c.store.load_result(ref=child, result_ref=result_ref) == {"ok": True}
