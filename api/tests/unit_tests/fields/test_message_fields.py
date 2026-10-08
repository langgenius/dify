from decimal import Decimal

from fields.message_fields import ExploreMessageListItem, MessageListItem, RetrieverResource, WebMessageListItem


def _retrieved_video_resource():
    # Shaped like a real stored retriever_resources entry (core/rag/entities/citation_metadata.py's
    # RetrievalSourceMetadata, the write-side model) for a video citation with a start/end offset.
    return {
        "position": 1,
        "dataset_id": "af57b949-2259-4fe4-b58a-0117fd3a6b92",
        "document_id": "9196b0c1-898e-4e8e-9d78-18cb07896b89",
        "document_name": "training.mp4",
        "retriever_from": "workflow",
        "score": 0.86,
        "content": "transcript excerpt",
        "page": None,
        "title": "training.mp4",
        "files": None,
        "doc_metadata": {"start_seconds": 1036.0, "end_seconds": 1054.6, "document_name": "training.mp4"},
    }


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


class TestRetrieverResourceDocMetadata:
    def test_doc_metadata_survives_validation_from_a_stored_dict(self):
        # GET /messages re-validates the raw dicts stored in Message.retriever_resources
        # (JSON-backed, written from RetrievalSourceMetadata) against RetrieverResource.
        # Before this field existed, ResponseModel's extra="ignore" silently dropped
        # doc_metadata here -- the video player on a reloaded conversation had nothing
        # to read start_seconds/end_seconds from, even though the data was never lost
        # in storage.
        resource = RetrieverResource.model_validate(_retrieved_video_resource())

        payload = resource.model_dump(mode="json")

        assert payload["doc_metadata"] == {
            "start_seconds": 1036.0,
            "end_seconds": 1054.6,
            "document_name": "training.mp4",
        }
        assert payload["title"] == "training.mp4"
        assert payload["retriever_from"] == "workflow"

    def test_message_list_item_propagates_doc_metadata_through_retriever_resources(self):
        payload = MessageListItem(
            **{**_base_kwargs(), "retriever_resources": [_retrieved_video_resource()]},
        ).model_dump(mode="json")

        assert payload["retriever_resources"][0]["doc_metadata"]["start_seconds"] == 1036.0
