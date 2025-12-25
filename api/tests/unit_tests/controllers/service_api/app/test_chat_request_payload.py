import uuid

import pytest
from pydantic import ValidationError

from controllers.service_api.app.completion import ChatRequestPayload


def test_chat_request_payload_accepts_blank_conversation_id():
    payload = ChatRequestPayload.model_validate({"inputs": {}, "query": "hello", "conversation_id": ""})

    assert payload.conversation_id is None


def test_chat_request_payload_validates_uuid():
    conversation_id = str(uuid.uuid4())

    payload = ChatRequestPayload.model_validate({"inputs": {}, "query": "hello", "conversation_id": conversation_id})

    assert payload.conversation_id == conversation_id


def test_chat_request_payload_rejects_invalid_uuid():
    with pytest.raises(ValidationError):
        ChatRequestPayload.model_validate({"inputs": {}, "query": "hello", "conversation_id": "invalid"})


def test_chat_request_payload_accepts_blank_parent_message_id():
    payload = ChatRequestPayload.model_validate({"inputs": {}, "query": "hello", "parent_message_id": ""})

    assert payload.parent_message_id is None


def test_chat_request_payload_validates_parent_message_id_uuid():
    parent_message_id = str(uuid.uuid4())

    payload = ChatRequestPayload.model_validate(
        {"inputs": {}, "query": "hello", "parent_message_id": parent_message_id}
    )

    assert payload.parent_message_id == parent_message_id


def test_chat_request_payload_rejects_invalid_parent_message_id():
    with pytest.raises(ValidationError):
        ChatRequestPayload.model_validate({"inputs": {}, "query": "hello", "parent_message_id": "invalid"})
