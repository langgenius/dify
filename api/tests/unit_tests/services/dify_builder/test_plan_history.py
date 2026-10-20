"""Plan snapshots retain their own overview across pagination and serialization."""

from copy import deepcopy
from unittest.mock import MagicMock

import pytest
from pydantic import ValidationError

import controllers.console.dify_builder as controller
from controllers.console.dify_builder_fields import DifyBuilderConversationPageResponse
from core.db.session_factory import get_session_maker
from core.dify_builder.contract import AssistantTurnItem, ExecutionProgress
from core.dify_builder.models import Actor, ConversationItem, DifyBuilderContext, EntryMode, Session
from core.dify_builder.state import PcState
from services.dify_builder.repository import SqlDifyBuilderRepository


def test_plan_history_pages_preserve_snapshots_and_cursors(monkeypatch: pytest.MonkeyPatch) -> None:
    repo = SqlDifyBuilderRepository(get_session_maker())
    session = Session(
        app_id="22222222-2222-2222-2222-222222222222",
        tenant_id="11111111-1111-1111-1111-111111111111",
        owner_account_id="33333333-3333-3333-3333-333333333333",
        entry_mode=EntryMode.EDIT,
        current_state=PcState.EDIT_PLAN_APPROVAL,
    )
    previous_payload = {
        "title": "Original plan",
        "items": ["Original step"],
        "input_summary": "原始输入。",
        "output_summary": "原始输出。",
        "reply_language": "zh-Hans",
    }
    new_payload = {
        "title": "Updated plan",
        "items": ["Updated step", "Return the answer"],
        "input_summary": "A support question.",
        "output_summary": "An answer with references.",
        "reply_language": "en-US",
    }
    items: list[ConversationItem] = []
    for index, payload in enumerate((previous_payload, new_payload)):
        items.extend(
            [
                ConversationItem(seq=index * 2, kind="plan", at_version=index + 1, payload=deepcopy(payload)),
                AssistantTurnItem(
                    turn_id=f"turn-{index}",
                    stage_id="edit.plan_approval",
                    execution=ExecutionProgress(status="completed"),
                    cards=["plan"],
                    reply_mode="complete",
                ).to_item(seq=index * 2 + 1, at_version=index + 1),
            ]
        )
    repo.create_session(session, DifyBuilderContext(), items)
    service = MagicMock()
    service.get_conversation_page.side_effect = lambda session_id, _actor, **kwargs: repo.list_conversation_page(
        session_id, **kwargs
    )
    monkeypatch.setattr(controller, "build_service", lambda: service)
    actor = Actor(account_id=session.owner_account_id, tenant_id=session.tenant_id)

    combined = controller._conversation(session.id, {"limit": 2}, actor)
    assert isinstance(combined, dict)
    assert [item["seq"] for item in combined["data"]] == [0, 1, 2, 3]
    assert combined["data"][0]["payload"] == previous_payload
    assert combined["data"][2]["payload"] == new_payload

    newest = controller._conversation(session.id, {"limit": 1}, actor)
    assert isinstance(newest, dict)
    assert (newest["first_seq"], newest["last_seq"], newest["has_more"]) == (2, 3, True)
    older = controller._conversation(session.id, {"limit": 1, "before_seq": newest["first_seq"]}, actor)
    assert isinstance(older, dict)
    assert (older["first_seq"], older["last_seq"], older["has_more"]) == (0, 1, False)
    after = controller._conversation(session.id, {"limit": 1, "after_seq": older["last_seq"]}, actor)
    assert isinstance(after, dict)
    assert [item["seq"] for item in after["data"]] == [2, 3]
    assert repo.list_conversation(session.id)[0].payload == previous_payload
    assert repo.list_conversation(session.id)[2].payload == new_payload


def test_plan_history_contract_requires_both_summaries() -> None:
    schema = DifyBuilderConversationPageResponse.model_json_schema(mode="serialization")["$defs"]["PlanCard"]
    for key in ("input_summary", "output_summary"):
        assert key in schema["required"]
        assert schema["properties"][key]["type"] == "string"


@pytest.mark.parametrize("key", ["input_summary", "output_summary"])
@pytest.mark.parametrize("invalid", [None, "missing"])
def test_plan_history_rejects_incomplete_payloads(key: str, invalid: str | None) -> None:
    payload: dict[str, str | None] = {
        "title": "Plan",
        "input_summary": "Source documents.",
        "output_summary": "A summary report.",
    }
    if invalid == "missing":
        del payload[key]
    else:
        payload[key] = invalid
    with pytest.raises(ValidationError) as error:
        DifyBuilderConversationPageResponse.model_validate(
            {
                "data": [{"seq": 0, "kind": "plan", "at_version": 1, "payload": payload}],
                "has_more": False,
                "first_seq": 0,
                "last_seq": 0,
            }
        )
    assert error.value.errors()[0]["loc"] == ("data", 0, "plan", "payload", key)
