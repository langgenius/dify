"""Unit tests for the Engram store-on-message-created event handler."""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from core.app.entities.app_invoke_entities import ChatAppGenerateEntity
from events.event_handlers import store_engram_memory_when_message_created as handler_module


def _message(query="hi", answer="hello", conversation_id="c1"):
    return SimpleNamespace(query=query, answer=answer, conversation_id=conversation_id)


def _entity(user_id="u1", *, enabled=True, api_key="enc-key", endpoint=None, tenant_id="t1"):
    entity = MagicMock(spec=ChatAppGenerateEntity)
    entity.user_id = user_id
    entity.app_config = SimpleNamespace(
        tenant_id=tenant_id,
        engram=SimpleNamespace(enabled=enabled, api_key=api_key, endpoint=endpoint),
    )
    return entity


def test_noop_for_unrelated_entity_type():
    with patch.object(handler_module, "build_engram_memory") as mock_build:
        handler_module.handle(_message(), application_generate_entity=object())
    mock_build.assert_not_called()


def test_noop_when_no_answer():
    with patch.object(handler_module, "build_engram_memory") as mock_build:
        handler_module.handle(_message(answer=""), application_generate_entity=_entity())
    mock_build.assert_not_called()


def test_noop_when_build_returns_none():
    # Bot disabled / no resolvable creds -> build_engram_memory returns None -> nothing stored.
    with patch.object(handler_module, "build_engram_memory", return_value=None) as mock_build:
        handler_module.handle(_message(), application_generate_entity=_entity(enabled=False))
    mock_build.assert_called_once()


def test_stores_user_and_assistant_turn_with_per_app_config():
    with patch.object(handler_module, "build_engram_memory") as mock_build:
        instance = mock_build.return_value
        handler_module.handle(
            _message(query="hi", answer="hello"),
            application_generate_entity=_entity("u1", api_key="enc-key", endpoint="https://e"),
        )

    mock_build.assert_called_once_with(
        user_id="u1",
        tenant_id="t1",
        conversation_id="c1",
        enabled=True,
        api_key_encrypted="enc-key",
        endpoint="https://e",
    )
    instance.store.assert_called_once_with(
        [{"role": "user", "content": "hi"}, {"role": "assistant", "content": "hello"}]
    )


def test_stores_assistant_only_when_no_query():
    with patch.object(handler_module, "build_engram_memory") as mock_build:
        instance = mock_build.return_value
        handler_module.handle(_message(query="", answer="hello"), application_generate_entity=_entity())

    instance.store.assert_called_once_with([{"role": "assistant", "content": "hello"}])
