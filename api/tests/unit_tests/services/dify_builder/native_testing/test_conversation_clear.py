"""A retained native Run is private audit after its conversation is cleared."""

import pytest

from models.dify_builder import DifyBuilderSession, DifyBuilderSessionCommit
from runtime_contracts.builder.execution import BuilderExecutionPolicyError
from tests.unit_tests.services.dify_builder.native_testing.test_native_runtime import CancellationCase

pytest_plugins = ["tests.unit_tests.services.dify_builder.native_testing.test_native_runtime"]


def test_clear_boundary_blocks_native_projection_and_commands(cancel_composition: CancellationCase):
    case = cancel_composition
    builder = case.rows[DifyBuilderSession][0]
    assert isinstance(builder, DifyBuilderSession)
    commit = case.rows[DifyBuilderSessionCommit][-1]
    assert isinstance(commit, DifyBuilderSessionCommit)
    commit.context = {
        **commit.context,
        "paused": True,
        "task_control": {"generation": 1, "conversation_clear": {"version": builder.version}},
    }
    assert case.api.snapshots(actor=case.actor, session_id=builder.id) == ()
    with pytest.raises(BuilderExecutionPolicyError, match="native_owner_mismatch"):
        case.api.get(actor=case.actor, session_id=builder.id, request_id=case.started.request_id)
    with pytest.raises(BuilderExecutionPolicyError, match="native_owner_mismatch"):
        case.api.resume(
            actor=case.actor,
            session_id=builder.id,
            request_id=case.started.request_id,
            expected_generation=0,
            idempotency_key="late-resume",
        )


def test_old_native_input_cannot_dispatch_after_a_new_task_cleared_active_input(cancel_composition: CancellationCase):
    from core.dify_builder.errors import ConflictError
    from services.dify_builder.task_controls import lock_task_admission

    case = cancel_composition
    builder = case.rows[DifyBuilderSession][0]
    assert isinstance(builder, DifyBuilderSession)
    commit = case.rows[DifyBuilderSessionCommit][-1]
    assert isinstance(commit, DifyBuilderSessionCommit)
    commit.context = {**commit.context, "test_input_ref": "", "task_control": {"generation": 1}}
    with case.api.sessions() as sql, pytest.raises(ConflictError, match="superseded"):
        lock_task_admission(sql, builder.id, test_input_id="old-input")
