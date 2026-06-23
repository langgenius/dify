from fields.message_fields import ExploreMessageListItem, MessageListItem


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
