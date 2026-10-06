from decimal import Decimal

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
