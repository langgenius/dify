"""Fixed presentation is model-free and raw submission values remain immutable."""

import json
from types import SimpleNamespace

import pytest

from controllers.console.dify_builder_fields import DifyBuilderSubmitActionPayload
from core.dify_builder.contract import FormCard, FormField
from core.dify_builder.errors import BadRequestError
from core.dify_builder.models import Action, Actor, ConversationItem, DifyBuilderContext, EntryMode, Session
from core.dify_builder.state import PcState
from services.dify_builder.copy_ids import BuilderCopyId
from services.dify_builder.presentation import copy_text
from services.dify_builder.serde import context_from_dict, context_to_dict
from services.dify_builder.service import DifyBuilderService
from tests.unit_tests.core.dify_builder.fakes import InMemoryRepository


def _service(state, context, items=()):
    repo = InMemoryRepository()
    session = Session(
        app_id="app", tenant_id="tenant", owner_account_id="account", entry_mode=EntryMode.BUILD, current_state=state
    )
    repo.create_session(session, context, list(items))
    return DifyBuilderService(repo, SimpleNamespace(exists=lambda _: False), lambda *_: None), session


def _actor():
    return Actor(account_id="account", tenant_id="tenant")


@pytest.mark.parametrize("language", ["zh-Hans", "ja", "en"])
def test_cold_view_uses_references_without_resolving_models(monkeypatch, language):
    def forbidden(*_args, **_kwargs):
        pytest.fail("fixed presentation attempted to invoke a model")

    monkeypatch.setattr("services.dify_builder.agent.llm.invoke_text", forbidden)
    monkeypatch.setattr("services.dify_builder.agent.llm.invoke_json", forbidden)
    service, session = _service(PcState.BUILD_PLAN_APPROVAL, DifyBuilderContext(reply_language=language))
    view = service.get_session_view(session.id, _actor())
    assert view.reply_language == language
    assert view.actions[0].label == copy_text(BuilderCopyId.ACTIONS_APPROVE_PLAN)
    assert view.actions[0].id == "approve_plan"
    assert view.actions[0].next_state == "build.execution"
    assert view.decision.options[0].id == "approve_plan"
    assert view.decision.submit.id == "confirm"


def test_context_no_longer_persists_a_translation_cache():
    legacy = {"reply_language": "ja", "ui_copy_language": "ja", "ui_copy": {"Goal": "old translation"}}
    restored = context_from_dict(legacy)
    assert restored.reply_language == "ja"
    assert not {"ui_copy", "ui_copy_language"} & context_to_dict(restored).keys()


@pytest.mark.parametrize("text", ["Yes", "Goal {{name}} <tag> " + "字" * 20000])
def test_frontend_snapshot_freezes_display_without_modifying_raw_values(text):
    card = FormCard(
        variant="build_requirements",
        title=copy_text(BuilderCopyId.FORMS_REQUIREMENTS_TITLE),
        fields=[
            FormField(key="enabled", label=copy_text(BuilderCopyId.FORMS_GOAL), type="bool"),
            FormField(key="text", label="Goal", type="text"),
        ],
    ).to_item(seq=0, at_version=1)
    history = ConversationItem(
        seq=1,
        kind="interaction_response",
        payload={
            "interaction_kind": "choice",
            "question": "old literal",
            "answer": "Yes",
            "submitted_data": {"option_id": "approve"},
        },
    )
    service, session = _service(
        PcState.BUILD_GOAL_ANALYSIS, DifyBuilderContext(reply_language="ja", next_seq=2), [card, history]
    )
    raw = {"enabled": True, "text": text}
    snapshot = {
        "interaction_kind": "form",
        "reply_language": "ja",
        "question": "要件を確認",
        "fields": [
            {"key": "enabled", "label": "目標", "display_value": "はい"},
            {"key": "text", "label": "Goal", "display_value": text},
        ],
    }
    parsed = DifyBuilderSubmitActionPayload.model_validate(
        {
            "action_id": "submit_requirements",
            "payload": raw,
            "base_version": session.version,
            "base_app_revision": "revision",
            "receipt_snapshot": snapshot,
        }
    )
    action = Action(
        kind="submit_requirements",
        payload=parsed.payload,
        base_version=session.version,
        receipt_snapshot=parsed.receipt_snapshot.model_dump(),
    )
    service._prepare_action(session.id, _actor(), action)
    receipt = action.interaction_response
    assert action.payload == raw
    assert receipt["submitted_data"] == raw
    assert receipt["fields"][0]["value"] is True
    assert receipt["fields"][1]["value"] == text
    assert receipt["fields"][0]["display_value"] == "はい"
    assert receipt["question"] == "要件を確認"
    assert receipt["reply_language"] == "ja"
    assert service._repo.list_conversation(session.id)[1].payload == history.payload
    assert json.loads(json.dumps(receipt))["fields"][1]["display_value"] == text
    action.receipt_snapshot["fields"][0]["key"] = "different"
    with pytest.raises(BadRequestError, match="form fields"):
        service._prepare_action(session.id, _actor(), action)
