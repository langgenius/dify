"""Normal CI only: authentic C03 claimed checkpoint metadata; no local collection.

Actual encrypted checkpoints and SQL owner transitions, no provider or physical
host qualification. Metadata corruption branches are unit-boundary negatives;
immutable continuation/payload owner rows are never weakened to construct them.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from runtime_contracts.builder.native.contracts import CheckpointRef, ResumeReceipt
from tests.test_containers_integration_tests.core.workflow.builder_native_fixture_records import require_instance

if TYPE_CHECKING:
    from tests.test_containers_integration_tests.core.workflow.test_builder_native_continuation import ContinuationCase

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from tests.test_containers_integration_tests.core.workflow import (
        test_builder_native_continuation as _fixture_types_0,
    )

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from tests.test_containers_integration_tests.core.workflow import (
        test_builder_native_continuation as _fixture_types_0,
    )


from copy import deepcopy
from datetime import UTC, datetime, timedelta
from operator import itemgetter
from uuid import uuid4

import pytest
import pytest_mock
from sqlalchemy import inspect, select
from sqlalchemy import inspect as inspect_orm

from models.dify_builder import DifyBuilderExecutionRequest
from models.dify_builder_native_tests import (
    NativeContinuation,
    NativeDispatch,
    NativeInvocationState,
    NativePayloadObject,
    NativePendingAction,
    NativeTestScope,
)
from runtime_contracts.builder.execution import BuilderExecutionPolicyError
from services.dify_builder.native_testing.operation_journal import NodeOperationJournal
from services.dify_builder.native_testing.pending_actions import NativePendingActionService
from services.dify_builder.native_testing.runtime import DifyNativeRuntimeOwner
from tests.test_containers_integration_tests.core.workflow.test_builder_native_continuation import (
    ContinuationCase,
    _root_with_child_dispatch,
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_continuation import (
    continuation_case as continuation_case,  # noqa: PLC0414
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_continuation import (
    migrated_continuation_tables as migrated_continuation_tables,  # noqa: PLC0414
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_dispatch_claims import (
    migrated_dispatch_claims as migrated_dispatch_claims,  # noqa: PLC0414
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_effect_ledger import (
    migrated_native_tables as migrated_native_tables,  # noqa: PLC0414
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_effect_ledger import (
    native_owner as native_owner,  # noqa: PLC0414
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_effect_ledger import no_live as no_live  # noqa: PLC0414


@pytest.fixture
def checkpoint_case(
    continuation_case: _fixture_types_0.ContinuationCase, migrated_dispatch_claims: None
) -> ContinuationCase:
    assert migrated_dispatch_claims is None
    return continuation_case


def _claim(c: ContinuationCase) -> tuple[CheckpointRef, ResumeReceipt]:
    waiting = c.pause()
    c.ledger.confirm()
    dispatch = c.resume()
    assert c.lifecycle.claim_dispatch(ref=c.ref, generation=dispatch.generation, dispatch_id=dispatch.dispatch_id)
    return waiting.checkpoint, dispatch


def _snapshot(c: ContinuationCase) -> dict[str, list[dict[str, object]]]:
    result = {}
    with c.factory() as session:
        for model in (
            NativeDispatch,
            NativeInvocationState,
            NativeContinuation,
            NativePayloadObject,
            NativePendingAction,
            NativeTestScope,
        ):
            rows = session.scalars(select(model).where(model.request_id == c.ref.request_id)).all()
            result[model.__name__] = sorted(
                [
                    deepcopy(
                        {column.key: inspect_orm(row).attrs[column.key].value for column in inspect(model).column_attrs}
                    )
                    for row in rows
                ],
                key=itemgetter("request_id" if model is NativeTestScope else "id"),
            )
    return result


def test_actual_claimed_checkpoint_ref_is_acknowledged_and_metadata_only(
    checkpoint_case: ContinuationCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    from extensions.ext_storage import storage

    c = checkpoint_case
    checkpoint, dispatch = _claim(c)
    before = _snapshot(c)

    def forbidden(*_: object, **__: object) -> None:
        raise AssertionError("metadata port performed private I/O")

    with monkeypatch.context() as patch:
        patch.setattr(storage, "load", forbidden)
        patch.setattr(c.store, "_read_object", forbidden)
        actual = c.lifecycle.claimed_resume_checkpoint(
            ref=c.ref, generation=dispatch.generation, dispatch_id=dispatch.dispatch_id
        )
    assert actual == checkpoint
    assert _snapshot(c) == before
    payload = c.store.read_checkpoint(ref=c.ref, checkpoint=actual)
    assert payload.native_run_id == c.store.load_context(ref=c.ref).native_run_id
    with c.factory() as session:
        saved = session.scalar(
            select(NativeContinuation).where(NativeContinuation.checkpoint_id == actual.checkpoint_id)
        )
        obj = session.get(NativePayloadObject, actual.checkpoint_id)
        assert (
            actual.payload_digest
            == require_instance(saved, NativeContinuation).payload_digest
            == require_instance(obj, NativePayloadObject).payload_digest
        )
        assert (
            require_instance(saved, NativeContinuation).payload_ref
            == require_instance(obj, NativePayloadObject).storage_key
        )


def test_explicit_recovery_reclaims_same_dispatch_and_keeps_authentic_checkpoint(
    mocker: pytest_mock.MockerFixture, checkpoint_case: ContinuationCase
) -> None:
    c = checkpoint_case
    checkpoint, dispatch = _claim(c)
    with c.factory.begin() as session:
        require_instance(session.get(NativeDispatch, dispatch.dispatch_id), NativeDispatch).claim_expires_at = (
            datetime.now(UTC) - timedelta(seconds=1)
        )
    c.lifecycle.reconcile()
    # Existing trusted recovery port double; no physical lifetime qualification.
    runtime = DifyNativeRuntimeOwner()
    mocker.patch.object(runtime, "recovery_evidence", return_value="stopped")
    c.lifecycle.runtime = runtime
    c.lifecycle.recover_dispatch(ref=c.ref, dispatch_id=dispatch.dispatch_id)
    assert c.lifecycle.claim_dispatch(ref=c.ref, generation=dispatch.generation, dispatch_id=dispatch.dispatch_id)
    assert (
        c.lifecycle.claimed_resume_checkpoint(
            ref=c.ref, generation=dispatch.generation, dispatch_id=dispatch.dispatch_id
        )
        == checkpoint
    )


def test_child_local_claim_survives_unrelated_shared_scope_advance(checkpoint_case: ContinuationCase) -> None:
    c = checkpoint_case
    child, child_id, local_generation, root_dispatch, checkpoint, *_ = _root_with_child_dispatch(c, claimed=True)
    # Child completion woke a real parent checkpoint at a shared generation jump.
    with c.factory() as session:
        saved = session.scalar(
            select(NativeContinuation).where(NativeContinuation.checkpoint_id == checkpoint.checkpoint_id)
        )
        assert require_instance(saved, NativeContinuation).generation < local_generation - 1
    root_generation = root_dispatch.generation
    pending = NativePendingActionService(c.store.loader).configuration(
        ref=c.ref, requirements_ref="configuration-1", expected_generation=root_generation
    )
    root_checkpoint = c.checkpoint(generation=root_generation)
    c.lifecycle.pause(
        ref=c.ref,
        checkpoint=root_checkpoint,
        pending_operation_ids=(pending.pending_operation_id,),
        expected_generation=root_generation,
    )
    c.resolution.resolved = True
    later = c.resume(key="unrelated-root-resume", generation=root_generation)
    assert c.lifecycle.claim_dispatch(ref=c.ref, generation=later.generation, dispatch_id=later.dispatch_id)
    with c.factory() as session:
        state = session.scalar(
            select(NativeInvocationState).where(
                NativeInvocationState.request_id == child.request_id,
                NativeInvocationState.invocation_id == child.invocation_id,
            )
        )
        assert (
            require_instance(state, NativeInvocationState).generation
            == local_generation
            < require_instance(session.get(NativeTestScope, child.request_id), NativeTestScope).generation
        )
    actual = c.lifecycle.claimed_resume_checkpoint(ref=child, generation=local_generation, dispatch_id=child_id)
    assert actual == checkpoint
    assert (
        c.store.read_checkpoint(ref=child, checkpoint=actual).native_run_id
        == c.store.load_context(ref=child).native_run_id
    )
    payload = c.store.read_checkpoint(ref=child, checkpoint=actual)
    assert payload.generation == 0
    assert c.store.load_context(ref=child).generation == local_generation == 2
    with c.factory() as session:
        assert require_instance(session.get(NativeTestScope, child.request_id), NativeTestScope).generation == 3
    assert payload.node_journals == ()
    # This real checkpoint has no recorded journal operations. The witness is
    # SQL selector → encrypted readback → authenticated restore association;
    # successful nonempty reconstruction/C02 replay remains unit qualification.
    journal = NodeOperationJournal(state=c.store, authorization=c.ledger.guard)
    before_restore = _snapshot(c)
    with pytest.raises(BuilderExecutionPolicyError, match="native_generation_conflict"):
        journal.restore(ref=child, checkpoint=actual)
    assert journal.snapshot(ref=child) == ()
    journal.restore_claimed(
        ref=child,
        generation=local_generation,
        dispatch_id=child_id,
        lifecycle=c.lifecycle,
        expected_payload=payload,
    )
    assert journal.snapshot(ref=child) == payload.node_journals
    assert _snapshot(c) == before_restore


def test_generation_zero_claim_has_no_resume_checkpoint_authority(checkpoint_case: ContinuationCase) -> None:
    c = checkpoint_case
    dispatch = c.lifecycle.enqueue_initial_dispatch(ref=c.ref)
    assert c.lifecycle.claim_dispatch(ref=c.ref, generation=0, dispatch_id=dispatch.dispatch_id)
    before = _snapshot(c)
    with pytest.raises(BuilderExecutionPolicyError):
        c.lifecycle.claimed_resume_checkpoint(ref=c.ref, generation=0, dispatch_id=dispatch.dispatch_id)
    assert _snapshot(c) == before


@pytest.mark.parametrize(
    "fault",
    [
        "queued",
        "unknown",
        "expired_claim",
        "wrong_generation",
        "foreign_tenant",
        "checkpoint_drift",
        "sealed",
        "cancelled",
        "expired_scope",
        "wrong_ref_digest",
        "foreign_invocation",
        "missing_dispatch",
    ],
)
def test_actual_current_owner_or_claim_drift_refuses_without_projection(
    checkpoint_case: ContinuationCase, fault: str
) -> None:
    c = checkpoint_case
    _, dispatch = _claim(c)
    ref, generation, dispatch_id = c.ref, dispatch.generation, dispatch.dispatch_id
    if fault == "wrong_ref_digest":
        ref = ref.model_copy(update={"context_digest": "f" * 64})
    elif fault == "foreign_invocation":
        ref = ref.model_copy(update={"invocation_id": "not-the-owner"})
    else:
        with c.factory.begin() as session:
            row = session.get(NativeDispatch, dispatch_id)
            if fault == "queued":
                require_instance(row, NativeDispatch).state = "queued"
            elif fault == "unknown":
                require_instance(row, NativeDispatch).state = "unknown"
            elif fault == "expired_claim":
                require_instance(row, NativeDispatch).claim_expires_at = datetime.now(UTC) - timedelta(seconds=1)
            elif fault == "wrong_generation":
                generation += 1
            elif fault == "foreign_tenant":
                require_instance(row, NativeDispatch).tenant_id = str(uuid4())
            elif fault == "checkpoint_drift":
                require_instance(row, NativeDispatch).checkpoint_id = str(uuid4())
            elif fault == "sealed":
                require_instance(
                    session.get(DifyBuilderExecutionRequest, c.ref.request_id), DifyBuilderExecutionRequest
                ).state = "sealed"
            elif fault == "cancelled":
                require_instance(session.get(NativeTestScope, c.ref.request_id), NativeTestScope).cancelled = True
            elif fault == "expired_scope":
                require_instance(session.get(NativeTestScope, c.ref.request_id), NativeTestScope).expires_at = (
                    datetime.now(UTC) - timedelta(seconds=1)
                )
            elif fault == "missing_dispatch":
                session.delete(row)
    before = _snapshot(c)
    with pytest.raises(BuilderExecutionPolicyError):
        c.lifecycle.claimed_resume_checkpoint(ref=ref, generation=generation, dispatch_id=dispatch_id)
    assert _snapshot(c) == before
