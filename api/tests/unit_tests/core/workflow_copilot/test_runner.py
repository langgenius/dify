"""Tests for the ``Runner`` state-machine driver (version-CAS advance).

Port of dify-enterprise/server/pkg/enterprise/biz/copilot/runner_test.go.
Uses a toy two-state registry rather than the real fix-flow handlers
(handlers land in Task 6/7).
"""

from datetime import datetime

import pytest

from core.workflow_copilot.errors import ConflictError
from core.workflow_copilot.models import Action, Actor, CopilotContext, EntryMode, Session, Turn
from core.workflow_copilot.runner import Env, Runner, StepResult
from core.workflow_copilot.state import PcState
from tests.unit_tests.core.workflow_copilot.fakes import FakeDifyPort, InMemoryRepository, StubAgent


def _actor() -> Actor:
    return Actor(account_id="acc-1", tenant_id="tenant-1")


def _session(**overrides) -> Session:
    fields: dict = {
        "app_id": "app",
        "tenant_id": "t",
        "owner_account_id": "u",
        "entry_mode": EntryMode.FIX,
        "current_state": PcState.FIX_DIAGNOSE,
    }
    fields.update(overrides)
    return Session(**fields)


def _toy_registry() -> dict[PcState, object]:
    """A working -> waiting toy machine: FIX_DIAGNOSE auto-advances to
    FIX_AWAIT_APPROVAL (a waiting state), where the loop stops."""

    def diagnose(_env: Env, _turn: Turn, _s: Session, fc: CopilotContext) -> StepResult:
        return StepResult(next=PcState.FIX_AWAIT_APPROVAL, context=fc)

    return {PcState.FIX_DIAGNOSE: diagnose}


def _new_env() -> tuple[Env, InMemoryRepository]:
    repo = InMemoryRepository()
    env = Env(
        dify=FakeDifyPort(),
        agent=StubAgent(),
        repo=repo,
        now=lambda: datetime.min,
    )
    return env, repo


def test_advance_commits_each_transition_and_stops_at_waiting():
    env, repo = _new_env()
    s = _session()
    repo.create_session(s, CopilotContext(), [])

    runner = Runner(env, _toy_registry())
    turn = Turn(action=Action(kind="request_fix", base_version=1), actor=_actor())
    out = runner.advance(s.id, turn)

    assert out.current_state == PcState.FIX_AWAIT_APPROVAL
    assert out.version == 2  # one transition committed

    stored, _ = repo.get_session(s.id)
    assert stored.version == 2
    assert stored.current_state == PcState.FIX_AWAIT_APPROVAL


def test_advance_stale_base_version_raises_conflict_with_nothing_applied():
    env, repo = _new_env()
    s = _session()
    repo.create_session(s, CopilotContext(), [])

    runner = Runner(env, _toy_registry())
    turn = Turn(action=Action(kind="request_fix", base_version=99), actor=_actor())

    with pytest.raises(ConflictError):
        runner.advance(s.id, turn)

    stored, _ = repo.get_session(s.id)
    assert stored.version == 1  # nothing committed
    assert stored.current_state == PcState.FIX_DIAGNOSE
    assert repo.list_conversation(s.id) == []


def test_advance_missing_handler_raises():
    env, repo = _new_env()
    s = _session()
    repo.create_session(s, CopilotContext(), [])

    runner = Runner(env, {})  # empty registry: no handler for FIX_DIAGNOSE
    turn = Turn(action=Action(kind="request_fix", base_version=1), actor=_actor())

    with pytest.raises(Exception):  # noqa: B017 - exact type asserted in test below
        runner.advance(s.id, turn)


def test_advance_missing_handler_error_message_names_the_state():
    env, repo = _new_env()
    s = _session()
    repo.create_session(s, CopilotContext(), [])

    runner = Runner(env, {})
    turn = Turn(action=Action(kind="request_fix", base_version=1), actor=_actor())

    with pytest.raises(RuntimeError, match="copilot: no handler for state fix.diagnose"):
        runner.advance(s.id, turn)


def test_advance_waiting_state_first_turn_no_action_returns_session_unchanged():
    env, repo = _new_env()
    s = _session(current_state=PcState.FIX_AWAIT_APPROVAL)
    repo.create_session(s, CopilotContext(), [])

    runner = Runner(env, {})  # never consulted: loop returns before handler lookup
    turn = Turn(actor=_actor())  # no action
    out = runner.advance(s.id, turn)

    assert out.current_state == PcState.FIX_AWAIT_APPROVAL
    assert out.version == 1


def test_advance_terminal_state_returns_session_unchanged():
    env, repo = _new_env()
    s = _session(current_state=PcState.SUCCESS)
    repo.create_session(s, CopilotContext(), [])

    runner = Runner(env, {})  # never consulted: terminal short-circuits first
    turn = Turn(actor=_actor())
    out = runner.advance(s.id, turn)

    assert out.current_state == PcState.SUCCESS
    assert out.version == 1


def test_advance_passes_full_turn_to_first_step_and_actor_only_turn_to_subsequent_steps():
    """Two working states chained: FIX_DIAGNOSE -> FIX_PROPOSE -> FIX_AWAIT_APPROVAL.
    The first handler sees the real Turn (with Action); the second (auto-advanced)
    handler must see a Turn with Action consumed (None) but the same Actor."""
    env, repo = _new_env()
    s = _session()
    repo.create_session(s, CopilotContext(), [])

    seen_turns: list[Turn] = []

    def diagnose(_env: Env, turn: Turn, _s: Session, fc: CopilotContext) -> StepResult:
        seen_turns.append(turn)
        return StepResult(next=PcState.FIX_PROPOSE, context=fc)

    def propose(_env: Env, turn: Turn, _s: Session, fc: CopilotContext) -> StepResult:
        seen_turns.append(turn)
        return StepResult(next=PcState.FIX_AWAIT_APPROVAL, context=fc)

    registry = {PcState.FIX_DIAGNOSE: diagnose, PcState.FIX_PROPOSE: propose}
    runner = Runner(env, registry)
    actor = _actor()
    action = Action(kind="request_fix", base_version=1)
    out = runner.advance(s.id, Turn(action=action, actor=actor))

    assert out.current_state == PcState.FIX_AWAIT_APPROVAL
    assert out.version == 3  # two transitions committed
    assert len(seen_turns) == 2
    assert seen_turns[0].action is action
    assert seen_turns[1].action is None
    assert seen_turns[1].actor == actor
