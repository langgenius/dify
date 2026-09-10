"""Engine wiring: detect language from user input; localize items before commit."""

from datetime import datetime

from core.dify_builder.models import Action, Actor, DifyBuilderContext, EntryMode, Session, Turn
from core.dify_builder.runner import Env, Runner
from core.dify_builder.state import PcState
from core.dify_builder.handlers_build import build_registry
from core.dify_builder.handlers_edit import edit_registry
from core.dify_builder.handlers_fix import fix_registry
from tests.unit_tests.core.dify_builder.fakes import FakeDifyPort, InMemoryRepository
from core.dify_builder.placeholder_agent import PlaceholderAgent


def _env(**overrides):
    repo = InMemoryRepository()
    env = Env(dify=FakeDifyPort(), agent=PlaceholderAgent(), repo=repo, now=lambda: datetime.min, **overrides)
    return env, repo


def test_context_has_reply_language_default():
    assert DifyBuilderContext().reply_language == ""


def test_localize_items_called_on_commit_with_reply_language():
    seen = {}

    def localize(items, language):
        seen["language"] = language
        for it in items:
            if it.payload.get("text") == "PING":
                it.payload["text"] = "PONG"
        return items

    env, repo = _env(localize_items=localize)
    runner = Runner(env, fix_registry() | build_registry() | edit_registry())
    s = Session(app_id="app", tenant_id="t", owner_account_id="a",
                entry_mode=EntryMode.FIX, current_state=PcState.FIX_AWAIT_DECISION)
    fc = DifyBuilderContext(reply_language="zh-Hans")
    repo.create_session(s, fc, [])
    # a stop action produces a settled commit with no items -> localize still invoked
    runner.advance(s.id, Turn(action=Action(kind="stop", base_version=1), actor=Actor(account_id="a", tenant_id="t")))
    assert seen.get("language") == "zh-Hans"


def test_detect_language_sets_reply_language_from_message_text():
    detected = []

    def detect(text):
        detected.append(text)
        return "ja"

    env, repo = _env(detect_language=detect)
    runner = Runner(env, fix_registry() | build_registry() | edit_registry())
    s = Session(app_id="app", tenant_id="t", owner_account_id="a",
                entry_mode=EntryMode.FIX, current_state=PcState.FIX_AWAIT_DECISION)
    repo.create_session(s, DifyBuilderContext(), [])
    runner.advance(
        s.id,
        Turn(action=Action(kind="message", payload={"text": "テスト", "client_turn_id": "t1"}, base_version=1),
             actor=Actor(account_id="a", tenant_id="t")),
    )
    _, fc = repo.get_session(s.id)
    assert fc.reply_language == "ja"
    assert "テスト" in detected
