"""Unit tests for the Engram store-on-message-created event handler."""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from core.app.entities.app_invoke_entities import ChatAppGenerateEntity
from events.event_handlers import store_engram_memory_when_message_created as handler_module


def _message(query="hi", answer="hello", conversation_id="c1"):
    return SimpleNamespace(query=query, answer=answer, conversation_id=conversation_id)


def _entity(user_id="u1"):
    entity = MagicMock(spec=ChatAppGenerateEntity)
    entity.user_id = user_id
    return entity


def test_noop_when_disabled():
    with (
        patch.object(handler_module, "is_engram_enabled", return_value=False),
        patch.object(handler_module, "EngramMemory") as mock_memory,
    ):
        handler_module.handle(_message(), application_generate_entity=_entity())
    mock_memory.assert_not_called()


def test_noop_for_unrelated_entity_type():
    with (
        patch.object(handler_module, "is_engram_enabled", return_value=True),
        patch.object(handler_module, "EngramMemory") as mock_memory,
    ):
        handler_module.handle(_message(), application_generate_entity=object())
    mock_memory.assert_not_called()


def test_noop_when_no_answer():
    with (
        patch.object(handler_module, "is_engram_enabled", return_value=True),
        patch.object(handler_module, "EngramMemory") as mock_memory,
    ):
        handler_module.handle(_message(answer=""), application_generate_entity=_entity())
    mock_memory.assert_not_called()


def test_stores_user_and_assistant_turn():
    with (
        patch.object(handler_module, "is_engram_enabled", return_value=True),
        patch.object(handler_module, "EngramMemory") as mock_memory,
    ):
        instance = mock_memory.return_value
        handler_module.handle(_message(query="hi", answer="hello"), application_generate_entity=_entity("u1"))

    mock_memory.assert_called_once_with(user_id="u1", conversation_id="c1")
    instance.store.assert_called_once_with(
        [{"role": "user", "content": "hi"}, {"role": "assistant", "content": "hello"}]
    )


def test_stores_assistant_only_when_no_query():
    with (
        patch.object(handler_module, "is_engram_enabled", return_value=True),
        patch.object(handler_module, "EngramMemory") as mock_memory,
    ):
        instance = mock_memory.return_value
        handler_module.handle(_message(query="", answer="hello"), application_generate_entity=_entity())

    instance.store.assert_called_once_with([{"role": "assistant", "content": "hello"}])
