"""Full run events and the separate repair/retest command boundary."""

from datetime import datetime
from unittest.mock import MagicMock

import pytest

from core.dify_builder.handlers_build import build_registry, handle_test_and_repair
from core.dify_builder.handlers_edit import edit_registry, handle_test_affected_paths
from core.dify_builder.handlers_fix import handle_verify
from core.dify_builder.models import (
    Action,
    Actor,
    DifyBuilderContext,
    EntryMode,
    MutationIntent,
    Run,
    Session,
    TestInput,
    Turn,
)
from core.dify_builder.runner import Env, Runner
from core.dify_builder.state import PcState
from tests.unit_tests.core.dify_builder.fakes import FakeDifyPort, FakeEditDifyPort, InMemoryRepository, StubAgent


@pytest.mark.parametrize(
    ("handler", "state", "mode"),
    [
        (handle_test_and_repair, PcState.BUILD_TEST_AND_REPAIR, EntryMode.BUILD),
        (handle_test_affected_paths, PcState.EDIT_TEST_AFFECTED_PATHS, EntryMode.EDIT),
        (handle_verify, PcState.FIX_VERIFY, EntryMode.FIX),
    ],
)
def test_all_test_flows_forward_native_events(handler, state, mode):
    port = FakeDifyPort()
    port.workflow_events = [
        {"event": "workflow_started", "workflow_run_id": "run-1", "data": {"inputs": {"query": "hello"}}},
        {"event": "text_chunk", "workflow_run_id": "run-1", "data": {"text": "42"}},
        {"event": "workflow_finished", "workflow_run_id": "run-1", "data": {"status": "succeeded"}},
    ]
    received = []
    env = Env(
        dify=port,
        agent=StubAgent(),
        repo=InMemoryRepository(),
        now=lambda: datetime.min,
        emit_workflow=received.append,
    )
    session = Session(app_id="app", tenant_id="tenant", entry_mode=mode, current_state=state)

    handler(env, Turn(actor=Actor(account_id="account", tenant_id="tenant")), session, DifyBuilderContext())

    assert received == port.workflow_events


@pytest.mark.parametrize(
    ("registry", "mode", "repair_state", "ready_state", "test_action", "review_state"),
    [
        (
            build_registry,
            EntryMode.BUILD,
            PcState.BUILD_AWAIT_REPAIR,
            PcState.BUILD_EXECUTION,
            "run_test",
            PcState.BUILD_REVIEW,
        ),
        (
            edit_registry,
            EntryMode.EDIT,
            PcState.EDIT_AWAIT_REPAIR,
            PcState.EDIT_APPLY_CHANGES,
            "run_affected_tests",
            PcState.EDIT_REVIEW,
        ),
    ],
)
def test_structural_repair_is_committed_before_a_separate_retest(
    registry, mode, repair_state, ready_state, test_action, review_state
):
    port = FakeEditDifyPort()
    port.run_draft = MagicMock(wraps=port.run_draft)
    repo = InMemoryRepository()
    env = Env(dify=port, agent=StubAgent(), repo=repo, now=lambda: datetime.min)
    session = Session(app_id="app", tenant_id="tenant", entry_mode=mode, current_state=repair_state)
    actor = Actor(account_id="account", tenant_id="tenant")
    repo.create_session(
        session,
        DifyBuilderContext(
            test_input_ref="input-1",
            staged_repair=[
                MutationIntent(op="create_node", args={"node_id": "new-code", "node_type": "code", "config": {}})
            ],
        ),
        [],
    )
    repo.save_test_input(TestInput(id="input-1", session_id=session.id, source="mock", inputs={}))
    runner = Runner(env, registry())

    applied = runner.advance(
        session.id, Turn(actor=actor, action=Action(kind="approve_repair", base_version=session.version))
    )

    assert applied.current_state == ready_state
    assert "new-code" in {node["id"] for node in port.graph["nodes"]}
    port.run_draft.assert_not_called()

    tested = runner.advance(
        session.id, Turn(actor=actor, action=Action(kind=test_action, base_version=applied.version))
    )

    assert tested.current_state == review_state
    port.run_draft.assert_called_once()


def test_edit_unknown_result_does_not_stage_a_failure_or_repair():
    port = FakeEditDifyPort()
    port.run_draft = MagicMock(return_value=Run(status="running", dify_run_id="run-1"))
    env = Env(dify=port, agent=StubAgent(), repo=InMemoryRepository(), now=lambda: datetime.min)
    session = Session(
        app_id="app", tenant_id="tenant", entry_mode=EntryMode.EDIT, current_state=PcState.EDIT_TEST_AFFECTED_PATHS
    )

    result = handle_test_affected_paths(
        env, Turn(actor=Actor(account_id="account", tenant_id="tenant")), session, DifyBuilderContext()
    )

    assert result.next == PcState.EDIT_APPLY_CHANGES
    assert result.run.status == "running"
    assert not result.context.staged_repair
    assert not any(item.kind in {"test_result", "error", "change_set"} for item in result.items)
