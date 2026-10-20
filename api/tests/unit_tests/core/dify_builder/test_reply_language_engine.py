"""Engine wiring: detect language before progress; preserve input and native streams."""

from collections.abc import Callable
from datetime import datetime

import pytest

from core.dify_builder.contract import ProgressEventData
from core.dify_builder.models import Action, Actor, DifyBuilderContext, EntryMode, MutationIntent, Session, Turn
from core.dify_builder.state import PcState
from runtime_contracts.builder.copy_ids import BuilderCopyId
from runtime_contracts.builder.presentation import copy_text
from services.dify_builder.application.handlers_build import build_registry
from services.dify_builder.application.handlers_edit import edit_registry
from services.dify_builder.application.handlers_fix import fix_registry
from services.dify_builder.application.placeholder_agent import PlaceholderAgent
from services.dify_builder.application.runner import Runner
from tests.unit_tests.core.dify_builder.fakes import FakeDifyPort, FixtureEnv, InMemoryRepository


def _env(
    *,
    detect_language: Callable[[str], str] | None = None,
    emit_progress: Callable[[ProgressEventData], None] | None = None,
) -> tuple[FixtureEnv, InMemoryRepository]:
    repo = InMemoryRepository()
    env = FixtureEnv(
        dify=FakeDifyPort(),
        agent=PlaceholderAgent(),
        repo=repo,
        now=lambda: datetime.min,
        detect_language=detect_language,
        emit_progress=emit_progress,
    )
    return env, repo


def test_context_has_reply_language_default() -> None:
    assert DifyBuilderContext().reply_language == ""


def test_user_input_is_never_rewritten_by_presentation() -> None:
    env, repo = _env()
    runner = Runner(env, {})
    session = Session(
        app_id="app",
        tenant_id="t",
        owner_account_id="a",
        entry_mode=EntryMode.FIX,
        current_state=PcState.FIX_AWAIT_DECISION,
    )
    repo.create_session(session, DifyBuilderContext(reply_language="zh-Hans"), [])
    runner.advance(
        session.id,
        Turn(
            action=Action(kind="message", payload={"text": "Goal", "client_turn_id": "Goal"}, base_version=1),
            actor=Actor(account_id="a", tenant_id="t"),
        ),
    )
    user, assistant = repo.list_conversation(session.id)
    assert user.payload == {"text": "Goal", "turn_id": "Goal"}
    assert assistant.payload["reply_language"] == "zh-Hans"
    assert assistant.payload["reply_mode"] == "stream"


def test_detect_language_sets_reply_language_from_message_text() -> None:
    detected = []

    def detect(text: str) -> str:
        detected.append(text)
        return "ja"

    env, repo = _env(detect_language=detect)
    runner = Runner(env, fix_registry() | build_registry() | edit_registry())
    s = Session(
        app_id="app",
        tenant_id="t",
        owner_account_id="a",
        entry_mode=EntryMode.FIX,
        current_state=PcState.FIX_AWAIT_DECISION,
    )
    repo.create_session(s, DifyBuilderContext(), [])
    runner.advance(
        s.id,
        Turn(
            action=Action(kind="message", payload={"text": "テスト", "client_turn_id": "t1"}, base_version=1),
            actor=Actor(account_id="a", tenant_id="t"),
        ),
    )
    _, fc = repo.get_session(s.id)
    assert fc.reply_language == "ja"
    assert "テスト" in detected


@pytest.mark.parametrize(
    ("goal", "language"),
    [("构建翻译流程", "zh-Hans"), ("翻訳ワークフローを作成", "ja"), ("Build a translator", "en")],
)
def test_initial_build_detects_language_before_first_progress(goal: str, language: str) -> None:
    calls: list[str] = []
    progress: list[ProgressEventData] = []

    def detect(text: str) -> str:
        assert text == goal
        calls.append("detect")
        return language

    def emit(event: ProgressEventData) -> None:
        assert calls == ["detect"]
        progress.append(event)

    env, repo = _env(detect_language=detect, emit_progress=emit)
    session = Session(
        app_id="app",
        tenant_id="t",
        owner_account_id="a",
        entry_mode=EntryMode.BUILD,
        current_state=PcState.BUILD_CAPABILITY_CHECK,
    )
    repo.create_session(session, DifyBuilderContext(goal_text=goal), [])

    Runner(env, build_registry()).advance(
        session.id,
        Turn(action=Action(kind="start_build", base_version=1), actor=Actor(account_id="a", tenant_id="t")),
    )

    assert progress[0].activity is not None
    assert progress[0].activity.label == copy_text(BuilderCopyId.PROGRESS_UNDERSTAND_THE_REQUESTED_WORKFLOW)
    assert progress[0].status == "running"
    assert all(event.reply_language == language for event in progress)
    _, context = repo.get_session(session.id)
    assert context.goal_text == goal
    assert context.reply_language == language


@pytest.mark.parametrize(
    ("state", "action_kind", "payload"),
    [
        (PcState.BUILD_INITIAL_PLAN, "", {}),
        (PcState.BUILD_AWAIT_TESTDATA, "provide_testdata", {"mode": "mock"}),
        (PcState.EDIT_AWAIT_TESTDATA, "provide_testdata", {"mode": "mock"}),
        (PcState.FIX_AWAIT_TESTDATA, "provide_testdata", {"mode": "mock"}),
        (PcState.BUILD_AWAIT_REPAIR, "approve_repair", {}),
        (PcState.EDIT_AWAIT_REPAIR, "approve_repair", {}),
        (PcState.BUILD_REVIEW, "re_fix", {}),
    ],
)
def test_progress_keeps_session_language_across_build_edit_and_fix_branches(
    state: PcState, action_kind: str, payload: dict[str, object]
) -> None:
    progress: list[ProgressEventData] = []
    env, _repo = _env(emit_progress=progress.append)
    env.fake_dify.graph = {"nodes": [{"id": "code", "data": {"type": "code", "code": "original"}}], "edges": []}
    context = DifyBuilderContext(
        reply_language="fr",
        goal_text="Goal / Yes / {{name}} / <tag>",
        staged_repair=[MutationIntent(op="set_node_config", args={"node_id": "code", "path": "code", "value": "Yes"})],
    )
    session = Session(id="session", app_id="app", current_state=state, entry_mode=EntryMode(str(state).split(".")[0]))
    turn = Turn(action=Action(kind=action_kind, payload=payload), actor=Actor(account_id="a", tenant_id="t"))

    registry = build_registry() | edit_registry() | fix_registry()
    registry[state](env, turn, session, context)

    assert progress
    assert all(event.reply_language == "fr" for event in progress)
    assert context.goal_text == "Goal / Yes / {{name}} / <tag>"
    assert turn.action is not None
    assert turn.action.payload == payload
