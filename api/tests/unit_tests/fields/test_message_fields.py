from decimal import Decimal

from core.tools.entities.ui_entities import A2UI_CATALOG_ID, MessageUIPart, ToolUIMessage
from fields.message_fields import ExploreMessageListItem, MessageListItem, WebMessageListItem


def _base_kwargs():
    return {
        "id": "m1",
        "conversation_id": "c1",
        "inputs": {},
        "query": "hi",
        "answer": "answer",
        "retriever_resources": [],
        "agent_thoughts": [],
        "message_files": [],
        "status": "normal",
        "extra_contents": [],
    }


def _ui_part_payload(index: int, *, large: bool = False) -> dict:
    surface_id = f"surface-{index}"
    messages = [
        {
            "version": "v0.9.1",
            "createSurface": {
                "surfaceId": surface_id,
                "catalogId": A2UI_CATALOG_ID,
            },
        },
    ]
    if large:
        messages.append(
            {
                "version": "v0.9.1",
                "updateDataModel": {
                    "surfaceId": surface_id,
                    "value": ["x" * 4096] * 20,
                },
            }
        )
    messages.append(
        {
            "version": "v0.9.1",
            "updateComponents": {
                "surfaceId": surface_id,
                "components": [{"id": "root", "component": "Text", "text": "Weather"}],
            },
        }
    )
    ui_message = ToolUIMessage(messages=messages)
    return MessageUIPart.from_tool_ui_message(
        part_id=f"call-{index}:{surface_id}",
        sequence=1,
        ui_message=ui_message,
    ).model_dump(mode="json")


class TestExploreMessageListItem:
    def test_exposes_metadata_for_history_rehydration(self):
        # The Explore/installed-app surface must surface message_metadata (incl. reasoning)
        # so the chat-with-history client can rehydrate the thinking panel on reload.
        item = ExploreMessageListItem(**_base_kwargs(), metadata={"reasoning": {"llm": "thinking..."}})

        payload = item.model_dump(mode="json")

        assert payload["metadata"] == {"reasoning": {"llm": "thinking..."}}

    def test_metadata_defaults_to_none(self):
        item = ExploreMessageListItem(**_base_kwargs())
        assert item.model_dump(mode="json")["metadata"] is None

    def test_base_message_list_item_has_no_metadata(self):
        # Guard the public service-API contract: the base item must not leak metadata.
        payload = MessageListItem(**_base_kwargs()).model_dump(mode="json")
        assert "metadata" not in payload

    def test_message_list_item_exposes_usage_fields(self):
        payload = MessageListItem(
            **_base_kwargs(),
            message_tokens=7,
            answer_tokens=11,
            provider_response_latency=1.25,
            total_price=Decimal("0.0001234"),
            currency="USD",
        ).model_dump(mode="json")

        assert payload["message_tokens"] == 7
        assert payload["answer_tokens"] == 11
        assert payload["total_tokens"] == 18
        assert payload["provider_response_latency"] == 1.25
        assert payload["total_price"] == "0.0001234"
        assert payload["currency"] == "USD"

    def test_web_message_list_item_exposes_usage_and_metadata(self):
        payload = WebMessageListItem(
            **_base_kwargs(),
            metadata={"usage": {"total_tokens": 18}},
            message_tokens=7,
            answer_tokens=11,
        ).model_dump(mode="json")

        assert payload["metadata"] == {"usage": {"total_tokens": 18}}
        assert payload["message_tokens"] == 7
        assert payload["answer_tokens"] == 11
        assert payload["total_tokens"] == 18

    def test_service_message_exposes_only_valid_bounded_ui_parts(self):
        metadata = {
            "usage": {"total_tokens": 18},
            "ui_parts": [
                _ui_part_payload(0),
                {"part_id": "broken"},
                *[_ui_part_payload(index) for index in range(1, 18)],
            ],
        }

        payload = MessageListItem(
            **_base_kwargs(),
            message_metadata_dict=metadata,
        ).model_dump(mode="json")

        assert "metadata" not in payload
        assert len(payload["ui_parts"]) == 16
        assert payload["ui_parts"][0]["part_id"] == "call-0:surface-0"

    def test_web_metadata_stays_raw_while_top_level_ui_parts_are_safe(self):
        metadata = {
            "reasoning": {"llm": "thinking..."},
            "ui_parts": [_ui_part_payload(0), {"part_id": "broken"}],
        }

        payload = WebMessageListItem(
            **_base_kwargs(),
            message_metadata_dict=metadata,
        ).model_dump(mode="json")

        assert payload["metadata"] == metadata
        assert len(payload["ui_parts"]) == 1

    def test_service_message_ui_parts_respect_cumulative_payload_budget(self):
        metadata = {"ui_parts": [_ui_part_payload(index, large=True) for index in range(7)]}

        payload = MessageListItem(
            **_base_kwargs(),
            message_metadata_dict=metadata,
        ).model_dump(mode="json")

        assert 0 < len(payload["ui_parts"]) < 7
