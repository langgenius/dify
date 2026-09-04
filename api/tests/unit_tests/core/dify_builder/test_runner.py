"""Tests for the ``Runner`` state-machine driver (version-CAS advance).

Port of dify-enterprise/server/pkg/enterprise/biz/dify_builder/runner_test.go.
Uses a toy two-state registry rather than the real fix-flow handlers
(handlers land in Task 6/7).
"""

from datetime import datetime

import pytest

from core.dify_builder.errors import ConflictError
from core.dify_builder.models import Action, Actor, ConversationItem, DifyBuilderContext, EntryMode, Session, Turn
from core.dify_builder.runner import CommittedTransition, Env, Runner, StepResult
from core.dify_builder.state import PcState
from tests.unit_tests.core.dify_builder.fakes import FakeDifyPort, InMemoryRepository, StubAgent


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

    def diagnose(_env: Env, _turn: Turn, _s: Session, fc: DifyBuilderContext) -> StepResult:
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
    repo.create_session(s, DifyBuilderContext(), [])

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
    commits: list[CommittedTransition] = []
    env.emit_commit = commits.append
    s = _session()
    repo.create_session(s, DifyBuilderContext(), [])

    runner = Runner(env, _toy_registry())
    turn = Turn(action=Action(kind="request_fix", base_version=99), actor=_actor())

    with pytest.raises(ConflictError):
        runner.advance(s.id, turn)

    stored, _ = repo.get_session(s.id)
    assert stored.version == 1  # nothing committed
    assert stored.current_state == PcState.FIX_DIAGNOSE
    assert repo.list_conversation(s.id) == []
    assert commits == []


def test_lost_commit_cas_emits_no_committed_transition(monkeypatch: pytest.MonkeyPatch):
    env, repo = _new_env()
    commits: list[CommittedTransition] = []
    env.emit_commit = commits.append
    s = _session()
    repo.create_session(s, DifyBuilderContext(), [])

    def lose_cas(*_args, **_kwargs):
        raise ConflictError("lost race")

    monkeypatch.setattr(repo, "compare_and_advance", lose_cas)

    with pytest.raises(ConflictError, match="lost race"):
        Runner(env, _toy_registry()).advance(
            s.id,
            Turn(action=Action(kind="request_fix", base_version=1), actor=_actor()),
        )

    assert commits == []


def test_advance_missing_handler_raises():
    env, repo = _new_env()
    s = _session()
    repo.create_session(s, DifyBuilderContext(), [])

    runner = Runner(env, {})  # empty registry: no handler for FIX_DIAGNOSE
    turn = Turn(action=Action(kind="request_fix", base_version=1), actor=_actor())

    with pytest.raises(Exception):  # noqa: B017 - exact type asserted in test below
        runner.advance(s.id, turn)


def test_advance_missing_handler_error_message_names_the_state():
    env, repo = _new_env()
    s = _session()
    repo.create_session(s, DifyBuilderContext(), [])

    runner = Runner(env, {})
    turn = Turn(action=Action(kind="request_fix", base_version=1), actor=_actor())

    with pytest.raises(RuntimeError, match="dify_builder: no handler for state fix.diagnose"):
        runner.advance(s.id, turn)


def test_advance_waiting_state_first_turn_no_action_returns_session_unchanged():
    env, repo = _new_env()
    s = _session(current_state=PcState.FIX_AWAIT_APPROVAL)
    repo.create_session(s, DifyBuilderContext(), [])

    runner = Runner(env, {})  # never consulted: loop returns before handler lookup
    turn = Turn(actor=_actor())  # no action
    out = runner.advance(s.id, turn)

    assert out.current_state == PcState.FIX_AWAIT_APPROVAL
    assert out.version == 1


def test_advance_terminal_state_returns_session_unchanged():
    env, repo = _new_env()
    s = _session(current_state=PcState.SUCCESS)
    repo.create_session(s, DifyBuilderContext(), [])

    runner = Runner(env, {})  # never consulted: terminal short-circuits first
    turn = Turn(actor=_actor())
    out = runner.advance(s.id, turn)

    assert out.current_state == PcState.SUCCESS
    assert out.version == 1


def test_message_appends_user_and_assistant_turns_without_advancing_waiting_state():
    env, repo = _new_env()
    commits: list[CommittedTransition] = []
    messages = []
    env.emit_commit = commits.append
    env.emit_message = messages.append
    s = _session(current_state=PcState.FIX_AWAIT_APPROVAL)
    repo.create_session(s, DifyBuilderContext(), [])

    def must_not_run(*_args):
        raise AssertionError("message must not invoke a state handler")

    runner = Runner(env, {PcState.FIX_AWAIT_APPROVAL: must_not_run})
    turn = Turn(
        action=Action(
            kind="message",
            payload={"text": "Make the change smaller", "client_turn_id": "turn-1"},
            base_version=1,
        ),
        actor=_actor(),
    )
    out = runner.advance(s.id, turn)

    assert out.current_state == PcState.FIX_AWAIT_APPROVAL
    assert out.version == 3
    items = repo.list_conversation(s.id)
    assert [(item.kind, item.payload) for item in items] == [
        ("user", {"text": "Make the change smaller", "turn_id": "turn-1"}),
        (
            "assistant_turn",
            {
                "turn_id": "turn-1",
                "stage_id": "fix.await_approval",
                "trace": {"status": "completed", "steps": []},
                "reply_text": "reply 1: Make the change smaller",
                "cards": [],
                "card_state": None,
            },
        ),
    ]
    assert [item.at_version for item in items] == [2, 3]
    assert [(commit.version, commit.state, commit.settled) for commit in commits] == [
        (2, PcState.FIX_AWAIT_APPROVAL, False),
        (3, PcState.FIX_AWAIT_APPROVAL, True),
    ]
    assert commits[0].operation_id != commits[1].operation_id
    assert commits[0].items == items[:1]
    assert commits[1].items == items[1:]
    assert len(messages) == 1
    assert messages[0].session_id == s.id
    assert messages[0].operation_id == commits[-1].operation_id
    assert messages[0].id == "turn-1"
    assert messages[0].answer == "reply 1: Make the change smaller"
    assert messages[0].seq == 1
    assert messages[0].at_version == 3
    assert messages[0].revision == 1
    assert messages[0].stage_id == "fix.await_approval"


def test_message_cognition_receives_prior_turns_and_completed_retry_is_idempotent():
    env, repo = _new_env()
    commits: list[CommittedTransition] = []
    env.emit_commit = commits.append
    s = _session(current_state=PcState.FIX_AWAIT_APPROVAL)
    repo.create_session(s, DifyBuilderContext(), [])
    runner = Runner(env, {})

    first = Action(
        kind="message",
        payload={"text": "First", "client_turn_id": "turn-1"},
        base_version=1,
    )
    out = runner.advance(s.id, Turn(action=first, actor=_actor()))
    second = Action(
        kind="message",
        payload={"text": "Second", "client_turn_id": "turn-2"},
        base_version=out.version,
    )
    out = runner.advance(s.id, Turn(action=second, actor=_actor()))

    replies = [item.payload["reply_text"] for item in repo.list_conversation(s.id) if item.kind == "assistant_turn"]
    assert replies == ["reply 1: First", "reply 3: Second"]
    version_before_retry = out.version
    commit_count_before_retry = len(commits)

    # Retrying the same client turn after the assistant half committed is a
    # success even with the original now-stale session version.
    retried = runner.advance(
        s.id,
        Turn(
            action=Action(
                kind="message",
                payload={"text": "Second", "client_turn_id": "turn-2"},
                base_version=3,
            ),
            actor=_actor(),
        ),
    )
    assert retried.version == version_before_retry
    assert len(commits) == commit_count_before_retry


def test_message_cognition_reads_only_bounded_recent_history(monkeypatch: pytest.MonkeyPatch):
    env, repo = _new_env()
    s = _session(current_state=PcState.FIX_AWAIT_APPROVAL)
    history = [ConversationItem(seq=seq, kind="notice", payload={"text": f"History {seq}"}) for seq in range(40)]
    repo.create_session(s, DifyBuilderContext(next_seq=40), history)
    received_history: list[ConversationItem] = []

    def respond(_state, _context, recent, _graph, _text, _on_delta=None):
        received_history.extend(recent)
        return "Bounded reply"

    def reject_full_history(_session_id: str):
        raise AssertionError("message handling must not load the full conversation")

    env.agent.respond_to_message = respond  # type: ignore[method-assign]
    monkeypatch.setattr(repo, "list_conversation", reject_full_history)

    Runner(env, {}).advance(
        s.id,
        Turn(
            action=Action(
                kind="message",
                payload={"text": "Latest", "client_turn_id": "turn-latest"},
                base_version=1,
            ),
            actor=_actor(),
        ),
    )

    assert len(received_history) == 24
    assert [item.seq for item in received_history] == list(range(17, 41))


def test_message_retry_resumes_after_user_half_committed():
    env, repo = _new_env()
    s = _session(current_state=PcState.FIX_AWAIT_APPROVAL)
    repo.create_session(s, DifyBuilderContext(), [])
    action = Action(
        kind="message",
        payload={"text": "Retry me", "client_turn_id": "turn-retry"},
        base_version=1,
    )

    def fail_reply(*_args):
        raise RuntimeError("model unavailable")

    env.agent.respond_to_message = fail_reply  # type: ignore[method-assign]
    with pytest.raises(RuntimeError, match="model unavailable"):
        Runner(env, {}).advance(s.id, Turn(action=action, actor=_actor()))

    partial, _fc = repo.get_session(s.id)
    assert partial.version == 2
    assert [item.kind for item in repo.list_conversation(s.id)] == ["user"]

    env.agent.respond_to_message = lambda *_args: "Recovered reply"  # type: ignore[method-assign]
    completed = Runner(env, {}).advance(s.id, Turn(action=action, actor=_actor()))

    assert completed.version == 3
    items = repo.list_conversation(s.id)
    assert [item.kind for item in items] == ["user", "assistant_turn"]
    assert items[-1].payload["reply_text"] == "Recovered reply"


def test_fail_after_message_user_half_commits_against_the_new_head():
    env, repo = _new_env()
    session = _session(current_state=PcState.FIX_AWAIT_APPROVAL)
    repo.create_session(session, DifyBuilderContext(), [])

    def fail_reply(*_args):
        raise RuntimeError("model unavailable")

    env.agent.respond_to_message = fail_reply  # type: ignore[method-assign]
    runner = Runner(env, {})
    with pytest.raises(RuntimeError, match="model unavailable"):
        runner.advance(
            session.id,
            Turn(
                action=Action(
                    kind="message",
                    payload={"text": "Persist me", "client_turn_id": "turn-fail"},
                    base_version=1,
                ),
                actor=_actor(),
            ),
        )

    failed = runner.fail(session.id)

    assert failed.version == 3
    assert failed.current_state == PcState.FAILED
    assert [(item.kind, item.at_version) for item in repo.list_conversation(session.id)] == [
        ("user", 2),
        ("error", 3),
    ]


def test_advance_emits_each_successful_cas_as_an_ordered_commit():
    env, repo = _new_env()
    commits: list[CommittedTransition] = []
    env.emit_commit = commits.append
    s = _session()
    repo.create_session(s, DifyBuilderContext(), [])

    def diagnose(_env: Env, _turn: Turn, _s: Session, fc: DifyBuilderContext) -> StepResult:
        item = ConversationItem(seq=fc.next_seq, kind="notice", payload={"text": "Diagnosed"})
        fc.next_seq += 1
        return StepResult(next=PcState.FIX_PROPOSE, context=fc, items=[item])

    def propose(_env: Env, _turn: Turn, _s: Session, fc: DifyBuilderContext) -> StepResult:
        item = ConversationItem(seq=fc.next_seq, kind="notice", payload={"text": "Plan ready"})
        fc.next_seq += 1
        return StepResult(next=PcState.FIX_AWAIT_APPROVAL, context=fc, items=[item])

    runner = Runner(env, {PcState.FIX_DIAGNOSE: diagnose, PcState.FIX_PROPOSE: propose})
    runner.advance(s.id, Turn(action=Action(kind="request_fix", base_version=1), actor=_actor()))

    assert [(commit.version, commit.state, commit.settled) for commit in commits] == [
        (2, PcState.FIX_PROPOSE, False),
        (3, PcState.FIX_AWAIT_APPROVAL, True),
    ]
    assert [[item.seq for item in commit.items] for commit in commits] == [[0], [1]]
    assert [[item.at_version for item in commit.items] for commit in commits] == [[2], [3]]
    assert [commit.at_version for commit in commits] == [2, 3]
    assert commits[0].operation_id != commits[1].operation_id
    assert [commit.stage_id for commit in commits] == ["fix.diagnose", "fix.propose"]
    assert [item.seq for item in repo.list_conversation(s.id)] == [0, 1]


def test_stop_and_resume_each_emit_a_settled_commit_without_items():
    env, repo = _new_env()
    commits: list[CommittedTransition] = []
    env.emit_commit = commits.append
    s = _session()
    repo.create_session(s, DifyBuilderContext(), [])
    runner = Runner(env, {})

    stopped = runner.advance(s.id, Turn(action=Action(kind="stop", base_version=1), actor=_actor()))
    resumed = runner.advance(s.id, Turn(action=Action(kind="resume", base_version=stopped.version), actor=_actor()))

    assert resumed.version == 3
    assert [(commit.version, commit.state, commit.settled, commit.items) for commit in commits] == [
        (2, PcState.FIX_DIAGNOSE, True, []),
        (3, PcState.FIX_DIAGNOSE, True, []),
    ]


def test_fail_persists_terminal_error_card_and_commit():
    env, repo = _new_env()
    commits: list[CommittedTransition] = []
    env.emit_commit = commits.append
    session = _session(current_state=PcState.FIX_PROPOSE)
    repo.create_session(session, DifyBuilderContext(), [])

    failed = Runner(env, {}).fail(session.id)

    assert failed.current_state == PcState.FAILED
    assert failed.version == 2
    assert [(item.kind, item.at_version) for item in repo.list_conversation(session.id)] == [("error", 2)]
    assert [(commit.state, commit.settled) for commit in commits] == [(PcState.FAILED, True)]


def test_fail_refuses_to_overwrite_a_newer_non_terminal_session_head():
    env, repo = _new_env()
    session = _session(current_state=PcState.FIX_PROPOSE)
    repo.create_session(session, DifyBuilderContext(), [])
    env.begin_operation(session)

    latest, context = repo.get_session(session.id)
    repo.compare_and_advance(
        session.id,
        latest.version,
        PcState.FIX_AWAIT_APPROVAL,
        context,
        [],
    )

    with pytest.raises(ConflictError, match="refusing stale failure"):
        Runner(env, {}).fail(session.id)

    stored, _context = repo.get_session(session.id)
    assert stored.version == 2
    assert stored.current_state == PcState.FIX_AWAIT_APPROVAL
    assert repo.list_conversation(session.id) == []


def test_recovery_short_path_emits_its_items_as_a_settled_commit(monkeypatch: pytest.MonkeyPatch):
    env, repo = _new_env()
    commits: list[CommittedTransition] = []
    env.emit_commit = commits.append
    s = _session(current_state=PcState.FIX_AWAIT_APPROVAL)
    repo.create_session(s, DifyBuilderContext(), [])

    def apply_recovery(_dify, _turn, session, fc):
        item = ConversationItem(seq=fc.next_seq, kind="notice", payload={"text": "Recovery checked"})
        fc.next_seq += 1
        return session.current_state, [item]

    monkeypatch.setattr("core.dify_builder.runner.recovery.apply_recovery_action", apply_recovery)
    Runner(env, {}).advance(
        s.id,
        Turn(action=Action(kind="check_recovery", base_version=1), actor=_actor()),
    )

    assert [(commit.version, commit.state, commit.settled) for commit in commits] == [
        (2, PcState.FIX_AWAIT_APPROVAL, True)
    ]
    assert [item.payload for item in commits[0].items] == [{"text": "Recovery checked"}]


def test_advance_passes_full_turn_to_first_step_and_actor_only_turn_to_subsequent_steps():
    """Two working states chained: FIX_DIAGNOSE -> FIX_PROPOSE -> FIX_AWAIT_APPROVAL.
    The first handler sees the real Turn (with Action); the second (auto-advanced)
    handler must see a Turn with Action consumed (None) but the same Actor."""
    env, repo = _new_env()
    s = _session()
    repo.create_session(s, DifyBuilderContext(), [])

    seen_turns: list[Turn] = []

    def diagnose(_env: Env, turn: Turn, _s: Session, fc: DifyBuilderContext) -> StepResult:
        seen_turns.append(turn)
        return StepResult(next=PcState.FIX_PROPOSE, context=fc)

    def propose(_env: Env, turn: Turn, _s: Session, fc: DifyBuilderContext) -> StepResult:
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
