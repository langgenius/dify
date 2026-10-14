"""Tests for the ``Runner`` state-machine driver (version-CAS advance).

Port of dify-enterprise/server/pkg/enterprise/biz/dify_builder/runner_test.go.
Uses a toy two-state registry rather than the real fix-flow handlers
(handlers land in Task 6/7).
"""

import logging
from collections.abc import Callable
from datetime import datetime

import pytest

from core.dify_builder.contract import AgentMessageEventData, ConversationItemAppendedEventData, ExecutionProgress
from core.dify_builder.errors import ConflictError
from core.dify_builder.models import Action, Actor, ConversationItem, DifyBuilderContext, EntryMode, Session, Turn
from core.dify_builder.runner import Env, Handler, Runner, StepResult
from core.dify_builder.state import PcState
from tests.unit_tests.core.dify_builder.fakes import FakeDifyPort, InMemoryRepository, StubAgent
from tests.unit_tests.services.dify_builder.presentation_helpers import english_text


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


def test_first_transition_replaces_legacy_decision_with_interaction_response():
    env, repo = _new_env()
    session = _session(current_state=PcState.FIX_AWAIT_APPROVAL)
    repo.create_session(session, DifyBuilderContext(), [])

    def approve(_env: Env, _turn: Turn, _session: Session, context: DifyBuilderContext) -> StepResult:
        item = ConversationItem(
            seq=context.next_seq,
            kind="decision",
            payload={"text": "Approved the fix"},
        )
        context.next_seq += 1
        return StepResult(next=PcState.FIX_AWAIT_VERIFY, context=context, items=[item])

    response = {
        "interaction_kind": "choice",
        "question": "How should Builder proceed with this fix?",
        "answer": "Approve fix",
        "fields": [],
        "submitted_data": {"option_id": "approve_plan"},
    }
    result = Runner(env, {PcState.FIX_AWAIT_APPROVAL: approve}).advance(
        session.id,
        Turn(
            action=Action(
                kind="approve_repair",
                base_version=1,
                interaction_response=response,
            ),
            actor=_actor(),
        ),
    )

    assert result.current_state == PcState.FIX_AWAIT_VERIFY
    items = repo.list_conversation(session.id)
    assert [(item.seq, item.kind, item.at_version) for item in items] == [(0, "interaction_response", 2)]
    assert items[0].payload == response
    _stored, context = repo.get_session(session.id)
    assert context.next_seq == 1


def test_advance_stale_base_version_raises_conflict_with_nothing_applied():
    env, repo = _new_env()
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


def test_lost_commit_cas_leaves_no_durable_transition(monkeypatch: pytest.MonkeyPatch):
    env, repo = _new_env()
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

    stored, _context = repo.get_session(s.id)
    assert stored.version == 1
    assert stored.current_state == PcState.FIX_DIAGNOSE
    assert repo.list_conversation(s.id) == []


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
    messages = []
    item_events = []
    env.emit_message = messages.append
    env.emit_item = item_events.append
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
                "reply_mode": "stream",
                "reply_language": "",
                "execution": {"status": "completed", "activities": []},
                "reasoning_text": None,
                "reply_text": "reply 1: Make the change smaller",
                "cards": [],
                "card_state": None,
            },
        ),
    ]
    assert [item.at_version for item in items] == [2, 3]
    assert len(messages) == 2
    delta, finished = messages
    assert delta.session_id == s.id
    assert delta.operation_id
    assert delta.turn_id == "turn-1"
    assert delta.delta == "reply 1: Make the change smaller"
    assert delta.seq == 1
    assert delta.at_version == 3
    assert delta.revision == 1
    assert delta.stage_id == "fix.await_approval"
    assert delta.done is False
    assert delta.text_bytes == len(delta.delta.encode())
    assert finished.turn_id == delta.turn_id
    assert finished.seq == delta.seq
    assert finished.at_version == delta.at_version
    assert finished.delta == ""
    assert finished.done is True
    assert finished.text_bytes == delta.text_bytes
    assert finished.revision == 2
    assert finished.execution is not None
    assert finished.execution.status == "completed"
    assert [(event.item.kind, event.item.seq) for event in item_events] == [("user", 0)]


def test_complete_assistant_reply_emits_once_only_after_commit():
    env, repo = _new_env()
    session = _session()
    repo.create_session(session, DifyBuilderContext(), [])
    timeline: list[tuple[str, AgentMessageEventData | ConversationItemAppendedEventData, int]] = []

    def emit_message(event):
        stored, _context = repo.get_session(session.id)
        timeline.append(("message", event, stored.version))

    def emit_item(event):
        stored, _context = repo.get_session(session.id)
        timeline.append(("item", event, stored.version))

    env.emit_message = emit_message
    env.emit_item = emit_item
    reply = "The workflow was updated with a focused validation step."

    def diagnose(stream_env: Env, _turn: Turn, current: Session, fc: DifyBuilderContext) -> StepResult:
        assistant_items = stream_env.append_assistant_turn(
            current,
            fc,
            reply_text=reply,
            execution=ExecutionProgress(status="completed"),
        )
        notice = ConversationItem(seq=fc.next_seq, kind="notice", payload={"text": "Next item"})
        fc.next_seq += 1
        return StepResult(
            next=PcState.FIX_AWAIT_APPROVAL,
            context=fc,
            items=[*assistant_items, notice],
        )

    Runner(env, {PcState.FIX_DIAGNOSE: diagnose}).advance(
        session.id,
        Turn(action=Action(kind="request_fix", base_version=1), actor=_actor()),
    )

    assert not any(isinstance(event, AgentMessageEventData) for _kind, event, _version in timeline)
    assert [(event.item.kind, version) for _kind, event, version in timeline] == [("assistant_turn", 2), ("notice", 2)]
    assert timeline[0][1].item.payload["reply_mode"] == "complete"
    items = repo.list_conversation(session.id)
    assert [item.kind for item in items] == ["assistant_turn", "notice"]
    assert english_text(items[0].payload["reply_text"]) == reply


def test_message_streams_and_persists_reasoning_independently_from_answer():
    class ReasoningAgent(StubAgent):
        def __init__(self) -> None:
            super().__init__()
            self.reasoning_callback: Callable[[str, str], None] | None = None

        def set_reasoning_callback(self, callback: Callable[[str, str], None] | None) -> None:
            self.reasoning_callback = callback

        def respond_to_message(self, *args, **kwargs):
            assert self.reasoning_callback is not None
            self.reasoning_callback("respond-to-message", "Check the current approval gate.")
            return super().respond_to_message(*args, **kwargs)

    env, repo = _new_env()
    env.agent = ReasoningAgent()
    reasoning_events = []
    env.emit_reasoning = reasoning_events.append
    session = _session(current_state=PcState.FIX_AWAIT_APPROVAL)
    repo.create_session(session, DifyBuilderContext(), [])

    Runner(env, {}).advance(
        session.id,
        Turn(
            action=Action(
                kind="message",
                payload={"text": "Explain", "client_turn_id": "turn-reasoning"},
                base_version=1,
            ),
            actor=_actor(),
        ),
    )

    assistant = repo.list_conversation(session.id)[-1]
    assert assistant.payload["reasoning_text"] == "Check the current approval gate."
    assert english_text(assistant.payload["reply_text"]) == "reply 1: Explain"
    assert reasoning_events[0].delta == "Check the current approval gate."
    assert reasoning_events[0].span_id == "respond-to-message"
    assert reasoning_events[0].session_id == session.id


def test_message_persists_the_streamed_text_without_a_second_localization():
    class MismatchedAgent(StubAgent):
        def respond_to_message(self, _state, _context, _history, _graph, _text, on_delta=None):
            assert on_delta is not None
            on_delta("Streamed ")
            on_delta("answer")
            return "different returned answer"

    def localize(items, _language):
        for item in items:
            if item.kind == "assistant_turn":
                item.payload["reply_text"] = "localized replacement"
        return items

    env, repo = _new_env()
    env.agent = MismatchedAgent()
    messages = []
    env.emit_message = messages.append
    session = _session(current_state=PcState.FIX_AWAIT_APPROVAL)
    repo.create_session(session, DifyBuilderContext(reply_language="zh-Hans"), [])

    Runner(env, {}).advance(
        session.id,
        Turn(
            action=Action(
                kind="message",
                payload={"text": "Explain", "client_turn_id": "turn-stream"},
                base_version=1,
            ),
            actor=_actor(),
        ),
    )

    streamed_text = "".join(message.delta for message in messages if not message.done)
    assistant = repo.list_conversation(session.id)[-1]
    assert streamed_text == "Streamed answer"
    assert english_text(assistant.payload["reply_text"]) == streamed_text
    assert messages[-1].done is True
    assert messages[-1].seq == assistant.seq


def test_message_cognition_receives_prior_turns_and_completed_retry_is_idempotent():
    env, repo = _new_env()
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

    replies = [
        english_text(item.payload["reply_text"])
        for item in repo.list_conversation(s.id)
        if item.kind == "assistant_turn"
    ]
    assert replies == ["reply 1: First", "reply 3: Second"]
    version_before_retry = out.version
    items_before_retry = repo.list_conversation(s.id)

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
    assert repo.list_conversation(s.id) == items_before_retry


def test_message_cognition_reads_only_bounded_recent_history(monkeypatch: pytest.MonkeyPatch):
    env, repo = _new_env()
    s = _session(current_state=PcState.FIX_AWAIT_APPROVAL)
    history = [ConversationItem(seq=seq, kind="user", payload={"text": f"History {seq}"}) for seq in range(40)]
    history += [ConversationItem(seq=seq, kind="notice", payload={"text": "Legacy notice"}) for seq in range(40, 80)]
    repo.create_session(s, DifyBuilderContext(next_seq=80), history)
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
    assert [item.seq for item in received_history] == [*range(17, 40), 80]
    assert not any(item.kind == "notice" for item in received_history)


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
    assert english_text(items[-1].payload["reply_text"]) == "Recovered reply"


def test_message_retry_keeps_catalog_colliding_client_turn_id_and_raw_text():
    env, repo = _new_env()
    env.detect_language = lambda _text: "zh-Hans"
    session = _session(current_state=PcState.FIX_AWAIT_APPROVAL)
    repo.create_session(session, DifyBuilderContext(), [])
    action = Action(
        kind="message",
        payload={"text": "请构建目标工作流", "client_turn_id": "Goal"},
        base_version=1,
    )

    def fail_reply(*_args):
        raise RuntimeError("model unavailable")

    env.agent.respond_to_message = fail_reply  # type: ignore[method-assign]
    with pytest.raises(RuntimeError, match="model unavailable"):
        Runner(env, {}).advance(session.id, Turn(action=action, actor=_actor()))

    [stored_user] = repo.list_conversation(session.id)
    assert stored_user.payload == {"text": "请构建目标工作流", "turn_id": "Goal"}
    assert repo.get_conversation_turn_kinds(session.id, "Goal") == frozenset({"user"})

    env.agent.respond_to_message = lambda *_args: "Recovered reply"  # type: ignore[method-assign]
    Runner(env, {}).advance(session.id, Turn(action=action, actor=_actor()))

    items = repo.list_conversation(session.id)
    assert [item.kind for item in items] == ["user", "assistant_turn"]
    assert items[1].payload["turn_id"] == "Goal"
    assert repo.get_conversation_turn_kinds(session.id, "Goal") == frozenset({"user", "assistant_turn"})


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
        ("assistant_turn", 3),
    ]


def test_advance_logs_each_successful_cas_and_persists_ordered_items(caplog: pytest.LogCaptureFixture):
    env, repo = _new_env()
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
    with caplog.at_level(logging.INFO, logger="core.dify_builder.runner"):
        runner.advance(
            s.id,
            Turn(action=Action(kind="request_fix", base_version=1, command_id="command-1"), actor=_actor()),
        )

    transitions = [record for record in caplog.records if record.message == "dify_builder transition committed"]
    assert [record.version for record in transitions] == [2, 3]
    assert [record.to_state for record in transitions] == ["fix.propose", "fix.await_approval"]
    assert [record.settled for record in transitions] == [False, True]
    assert [record.item_count for record in transitions] == [1, 1]
    items = repo.list_conversation(s.id)
    assert [item.seq for item in items] == [0, 1]
    assert [item.at_version for item in items] == [2, 3]
    _stored, context = repo.get_session(s.id)
    assert context.last_command_id == "command-1"


def test_stop_and_resume_each_persist_a_settled_transition_without_items():
    env, repo = _new_env()
    s = _session()
    repo.create_session(s, DifyBuilderContext(), [])
    runner = Runner(env, {})

    stopped = runner.advance(
        s.id,
        Turn(action=Action(kind="stop", base_version=1, command_id="stop-1"), actor=_actor()),
    )
    resumed = runner.advance(
        s.id,
        Turn(action=Action(kind="resume", base_version=stopped.version, command_id="resume-1"), actor=_actor()),
    )

    assert resumed.version == 3
    assert repo.list_conversation(s.id) == []
    _stored, context = repo.get_session(s.id)
    assert context.paused is False
    assert context.last_command_id == "resume-1"


def test_fail_persists_terminal_assistant_message():
    env, repo = _new_env()
    session = _session(current_state=PcState.FIX_PROPOSE)
    repo.create_session(session, DifyBuilderContext(), [])

    failed = Runner(env, {}).fail(session.id)

    assert failed.current_state == PcState.FAILED
    assert failed.version == 2
    items = repo.list_conversation(session.id)
    assert [(item.kind, item.at_version) for item in items] == [("assistant_turn", 2)]
    assert items[0].payload["execution"]["status"] == "error"
    assert "Restart from the current draft" in english_text(items[0].payload["reply_text"])


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


def test_recovery_short_path_persists_its_items(monkeypatch: pytest.MonkeyPatch):
    env, repo = _new_env()
    s = _session(current_state=PcState.FIX_AWAIT_APPROVAL)
    repo.create_session(s, DifyBuilderContext(), [])

    def apply_recovery(_dify, _turn, session, fc):
        item = ConversationItem(seq=fc.next_seq, kind="notice", payload={"text": "Recovery checked"})
        fc.next_seq += 1
        return session.current_state, [item]

    monkeypatch.setattr("core.dify_builder.runner.recovery.apply_recovery_action", apply_recovery)
    Runner(env, {}).advance(
        s.id,
        Turn(
            action=Action(
                kind="check_recovery",
                base_version=1,
                interaction_response={
                    "interaction_kind": "choice",
                    "question": "How should Builder recover?",
                    "answer": "Review draft changes",
                    "fields": [],
                    "submitted_data": {"option_id": "check_recovery"},
                },
            ),
            actor=_actor(),
        ),
    )

    stored, _context = repo.get_session(s.id)
    assert stored.version == 2
    assert stored.current_state == PcState.FIX_AWAIT_APPROVAL
    assert [(item.kind, item.payload) for item in repo.list_conversation(s.id)] == [
        (
            "interaction_response",
            {
                "interaction_kind": "choice",
                "question": "How should Builder recover?",
                "answer": "Review draft changes",
                "fields": [],
                "submitted_data": {"option_id": "check_recovery"},
            },
        ),
        ("notice", {"text": "Recovery checked"}),
    ]


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


def test_confirmed_action_runs_working_handler_without_waiting_transition_or_model_calls() -> None:
    from typing import NoReturn

    from core.dify_builder.models import CONFIRMED_TOOL_ACTION

    env, repo = _new_env()

    def no_detection(_text: str) -> NoReturn:
        raise AssertionError("confirmed outcome must not detect a language with a model")

    def no_localization(_items: list[ConversationItem], _language: str) -> NoReturn:
        raise AssertionError("confirmed outcome must not localize with a model")

    env.detect_language = no_detection
    s = _session(entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_TEST_AND_REPAIR)
    repo.create_session(
        s,
        DifyBuilderContext(
            confirmed_consent_id="consent-1", confirmed_command_id="command-1", reply_language="fr", goal_text="g"
        ),
        [],
    )
    seen: list[Turn] = []

    def working(_env: Env, turn: Turn, _s: Session, fc: DifyBuilderContext) -> StepResult:
        seen.append(turn)
        return StepResult(next=PcState.BUILD_REVIEW, context=fc)

    action = Action(kind=CONFIRMED_TOOL_ACTION, base_version=1, command_id="command-1")
    out = Runner(env, {PcState.BUILD_TEST_AND_REPAIR: working}).advance(s.id, Turn(action=action, actor=_actor()))

    assert out.current_state == PcState.BUILD_REVIEW
    assert out.version == 2  # one commit: no waiting->working transition here
    assert [turn.action for turn in seen] == [action]


@pytest.mark.parametrize(
    ("state", "command"),
    [
        (PcState.BUILD_TEST_AND_REPAIR, "other-command"),
        (PcState.BUILD_REVIEW, "command-1"),
        (PcState.BUILD_AWAIT_TESTDATA, "command-1"),
    ],
)
def test_confirmed_action_refuses_unreserved_command_or_non_working_state(state: PcState, command: str) -> None:
    from core.dify_builder.models import CONFIRMED_TOOL_ACTION

    env, repo = _new_env()
    s = _session(entry_mode=EntryMode.BUILD, current_state=state)
    repo.create_session(s, DifyBuilderContext(confirmed_consent_id="consent-1", confirmed_command_id="command-1"), [])
    called: list[Turn] = []

    def handler(_env: Env, turn: Turn, _s: Session, fc: DifyBuilderContext) -> StepResult:
        called.append(turn)
        return StepResult(next=PcState.BUILD_REVIEW, context=fc)

    registry: dict[PcState, Handler] = {state: handler}
    action = Action(kind=CONFIRMED_TOOL_ACTION, base_version=1, command_id=command)
    with pytest.raises(ConflictError):
        Runner(env, registry).advance(s.id, Turn(action=action, actor=_actor()))
    assert called == []
    assert repo.get_session(s.id)[0].version == 1


def test_terminal_failure_clears_pending_confirmed_reference() -> None:
    env, repo = _new_env()
    s = _session(entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_TEST_AND_REPAIR)
    repo.create_session(s, DifyBuilderContext(confirmed_consent_id="consent-1", confirmed_command_id="command-1"), [])
    Runner(env, {}).fail(s.id)
    session_after, fc = repo.get_session(s.id)
    assert session_after.current_state == PcState.FAILED
    assert (fc.confirmed_consent_id, fc.confirmed_command_id) == ("", "")


def test_recovery_clears_pending_confirmed_reference() -> None:
    env, repo = _new_env()
    s = _session(entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_REVIEW)
    repo.create_session(
        s,
        DifyBuilderContext(confirmed_consent_id="consent-1", confirmed_command_id="command-1", recovery_class="drift"),
        [],
    )
    Runner(env, {}).advance(s.id, Turn(action=Action(kind="check_recovery", base_version=1), actor=_actor()))
    _session_after, fc = repo.get_session(s.id)
    assert (fc.confirmed_consent_id, fc.confirmed_command_id) == ("", "")
