"""Persisted Builder UI copy is projected without model calls on read paths."""

import json
from datetime import datetime
from types import SimpleNamespace

import pytest

from core.dify_builder.models import Action, Actor, ConversationItem, DifyBuilderContext, EntryMode, Session
from core.dify_builder.runner import Env, Runner
from core.dify_builder.state import PcState
from services.dify_builder.agent import localize as localize_mod
from services.dify_builder.serde import context_from_dict, context_to_dict
from services.dify_builder.service import DifyBuilderService
from tests.unit_tests.core.dify_builder.fakes import FakeDifyPort, InMemoryRepository, StubAgent


def _service_with_session(
    state: PcState,
    context: DifyBuilderContext,
    items: list[ConversationItem] | None = None,
) -> tuple[DifyBuilderService, Session]:
    repo = InMemoryRepository()
    session = Session(
        app_id="app-1",
        tenant_id="tenant-1",
        owner_account_id="account-1",
        entry_mode=EntryMode.BUILD,
        current_state=state,
    )
    repo.create_session(session, context, items or [])
    service = DifyBuilderService(
        repo,
        SimpleNamespace(exists=lambda _session_id: False),
        lambda *_args: None,
    )
    return service, session


def _actor() -> Actor:
    return Actor(account_id="account-1", tenant_id="tenant-1")


def _context(language: str, copy: dict[str, str]) -> DifyBuilderContext:
    context = DifyBuilderContext(reply_language=language)
    context.ui_copy_language = language
    context.ui_copy = copy
    return context


def test_ui_copy_survives_context_json_round_trip_and_old_context_defaults():
    context = _context("ja", {"Goal": "目標", "Approve plan": "プランを承認"})

    restored = context_from_dict(json.loads(json.dumps(context_to_dict(context))))
    legacy = context_from_dict({"reply_language": "ja"})

    assert restored.ui_copy_language == "ja"
    assert restored.ui_copy == {"Goal": "目標", "Approve plan": "プランを承認"}
    assert legacy.ui_copy_language == ""
    assert legacy.ui_copy == {}


def test_worker_refreshes_ui_copy_for_new_language_before_context_commit():
    context = _context("zh-Hans", {"Approve plan": "批准计划"})
    service, seeded = _service_with_session(PcState.BUILD_PLAN_APPROVAL, context)
    repo = service._repo
    session, working = repo.get_session(seeded.id)
    working.reply_language = "ja"
    env = Env(dify=FakeDifyPort(), agent=StubAgent(), repo=repo, now=lambda: datetime.min)
    env.prepare_ui_copy = lambda language: {"Approve plan": "プランを承認"} if language == "ja" else {}

    Runner(env, {})._commit(session, session.current_state, working, [], settled=True)

    _, stored = repo.get_session(seeded.id)
    assert stored.ui_copy_language == "ja"
    assert stored.ui_copy == {"Approve plan": "プランを承認"}


def test_confirmed_worker_commit_skips_ui_copy_translation():
    context = _context("zh-Hans", {"Approve plan": "批准计划"})
    service, seeded = _service_with_session(PcState.BUILD_PLAN_APPROVAL, context)
    repo = service._repo
    session, working = repo.get_session(seeded.id)
    working.reply_language = "ja"
    env = Env(dify=FakeDifyPort(), agent=StubAgent(), repo=repo, now=lambda: datetime.min)
    env.suppress_model_calls = True
    calls: list[str] = []
    env.prepare_ui_copy = lambda language: calls.append(language) or {}

    Runner(env, {})._commit(session, session.current_state, working, [], settled=True)

    assert calls == []


@pytest.mark.parametrize(
    ("language", "title", "approval"),
    [
        ("zh-Hans", "这个工作流计划可以应用了吗？", "批准计划"),
        ("ja", "このワークフロープランを適用しますか？", "プランを承認"),
    ],
)
def test_settled_view_localizes_action_and_decision_without_changing_guards(language, title, approval):
    context = _context(
        language,
        {
            "Is this workflow plan ready to apply?": title,
            "Choose one option to continue.": "続行する選択肢を選ぶ" if language == "ja" else "选择一个选项以继续。",
            "Approve plan": approval,
            "Submit": "送信" if language == "ja" else "提交",
        },
    )
    service, session = _service_with_session(PcState.BUILD_PLAN_APPROVAL, context)

    view = service.get_session_view(session.id, _actor())

    assert view.reply_language == language
    assert [(action.id, action.label, action.next_state) for action in view.actions] == [
        ("approve_plan", approval, "build.execution")
    ]
    assert view.decision is not None
    assert view.decision.title == title
    assert view.decision.options[0].id == "approve_plan"
    assert view.decision.options[0].label == approval
    assert view.decision.default_option_id == "approve_plan"
    assert view.decision.submit is not None
    assert (view.decision.submit.id, view.decision.submit.label) == (
        "confirm",
        "送信" if language == "ja" else "提交",
    )


@pytest.mark.parametrize(
    ("copy_language", "copy"),
    [("", {}), ("ja", {"Approve plan": "プランを承認"}), ("zh-Hans", {})],
)
def test_view_uses_english_when_ui_copy_is_missing_or_from_another_language(copy_language, copy):
    context = _context("zh-Hans", copy)
    context.ui_copy_language = copy_language
    service, session = _service_with_session(PcState.BUILD_PLAN_APPROVAL, context)

    view = service.get_session_view(session.id, _actor())

    assert view.actions[0].label == "Approve plan"
    assert view.decision is not None
    assert view.decision.title == "Is this workflow plan ready to apply?"


def test_get_session_view_preserves_historical_form_card_after_language_change():
    context = _context(
        "zh-Hans",
        {
            "Review the requirements": "检查需求",
            "Adjust any values before Builder continues.": "继续前调整数值。",
            "Goal": "目标",
            "Review": "检查",
            "Provide test data": "提供测试数据",
        },
    )
    card = ConversationItem(
        seq=0,
        kind="form",
        payload={
            "variant": "build_requirements",
            "title": "Review the requirements",
            "description": "Adjust any values before Builder continues.",
            "fields": [
                {
                    "key": "goal",
                    "label": "Goal",
                    "type": "select",
                    "options": ["Yes", "No"],
                    "default": "Yes",
                    "placeholder": "Review",
                    "hint": "Provide test data",
                }
            ],
            "values": {"goal": "Yes"},
        },
    )
    service, session = _service_with_session(PcState.BUILD_GOAL_ANALYSIS, context, [card])

    view = service.get_session_view(session.id, _actor())

    assert view.active_interaction is not None
    assert view.active_interaction.card.payload == card.payload


def test_choice_receipt_localizes_question_and_answer_but_preserves_selected_option():
    context = _context(
        "ja",
        {
            "Is this workflow plan ready to apply?": "このワークフロープランを適用しますか？",
            "Approve plan": "プランを承認",
        },
    )
    service, session = _service_with_session(PcState.BUILD_PLAN_APPROVAL, context)
    action = Action(kind="approve_repair", payload={"option_id": "approve_plan"}, base_version=1)

    service._prepare_action(session.id, _actor(), action)

    assert action.interaction_response == {
        "interaction_kind": "choice",
        "question": "このワークフロープランを適用しますか？",
        "answer": "プランを承認",
        "fields": [],
        "submitted_data": {"option_id": "approve_plan"},
    }


def test_form_receipt_localizes_boolean_display_but_preserves_literal_yes_and_raw_values():
    context = _context("zh-Hans", {"Review the requirements": "检查需求", "Goal": "目标", "Yes": "是"})
    card = ConversationItem(
        seq=0,
        kind="form",
        payload={
            "variant": "build_requirements",
            "title": "Review the requirements",
            "fields": [
                {"key": "goal", "label": "Goal"},
                {"key": "enabled", "label": "Goal"},
            ],
        },
    )
    service, session = _service_with_session(PcState.BUILD_GOAL_ANALYSIS, context, [card])
    action = Action(kind="submit_requirements", payload={"goal": "Yes", "enabled": True}, base_version=1)

    service._prepare_action(session.id, _actor(), action)

    assert action.interaction_response is not None
    assert action.interaction_response["question"] == "检查需求"
    assert action.interaction_response["fields"] == [
        {"key": "goal", "label": "目标", "value": "Yes", "display_value": "Yes"},
        {"key": "enabled", "label": "目标", "value": True, "display_value": "是"},
    ]
    assert action.interaction_response["submitted_data"] == {"goal": "Yes", "enabled": True}


def test_get_session_view_uses_persisted_copy_without_translation_calls(monkeypatch):
    context = _context("ja", {"Approve plan": "プランを承認"})
    service, session = _service_with_session(PcState.BUILD_PLAN_APPROVAL, context)
    calls: list[str] = []
    localize_mod._TRANSLATION_CACHE.clear()
    monkeypatch.setattr(localize_mod.llm, "invoke_json", lambda *_args, **_kwargs: calls.append("translate"))

    view = service.get_session_view(session.id, _actor())

    assert view.actions[0].label == "プランを承認"
    assert calls == []
