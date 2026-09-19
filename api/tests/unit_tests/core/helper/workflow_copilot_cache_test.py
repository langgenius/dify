"""Unit tests for WorkflowCopilotMemoryCache.

The cache is a thin Redis wrapper: DB is the source of truth, this only
accelerates the per-turn memory read. These tests pin the observable contract —
the namespaced key, the defensive ``get`` fallbacks (miss / bad bytes / bad
JSON / wrong shape), and that ``set`` writes JSON with the module TTL — so a
corrupt or missing cache entry degrades to "rebuild from DB" instead of raising.

Redis is mocked (``mocker.patch`` on the module-level ``redis_client``, mirroring
``test_model_provider_cache``); no real Redis is touched.
"""

import json

from pytest_mock import MockerFixture

from core.helper.workflow_copilot_cache import WorkflowCopilotMemoryCache

_REDIS = "core.helper.workflow_copilot_cache.redis_client"


def test_cache_key_is_namespaced_by_conversation_id() -> None:
    cache = WorkflowCopilotMemoryCache("conv-123")
    assert cache.cache_key == "workflow_copilot:mem:conv-123"


def test_get_returns_none_on_miss(mocker: MockerFixture) -> None:
    redis_mock = mocker.patch(_REDIS)
    redis_mock.get.return_value = None
    assert WorkflowCopilotMemoryCache("c").get() is None


def test_get_returns_decoded_memory(mocker: MockerFixture) -> None:
    redis_mock = mocker.patch(_REDIS)
    payload = {
        "summary": "earlier we added an llm node",
        "recent_messages": [{"role": "user", "content": "hi"}],
    }
    redis_mock.get.return_value = json.dumps(payload).encode("utf-8")

    result = WorkflowCopilotMemoryCache("c").get()

    assert result == payload


def test_get_returns_none_for_invalid_utf8(mocker: MockerFixture) -> None:
    redis_mock = mocker.patch(_REDIS)
    redis_mock.get.return_value = b"\xff"
    assert WorkflowCopilotMemoryCache("c").get() is None


def test_get_returns_none_for_invalid_json(mocker: MockerFixture) -> None:
    redis_mock = mocker.patch(_REDIS)
    redis_mock.get.return_value = b"{not json"
    assert WorkflowCopilotMemoryCache("c").get() is None


def test_get_returns_none_when_payload_is_not_a_dict(mocker: MockerFixture) -> None:
    redis_mock = mocker.patch(_REDIS)
    redis_mock.get.return_value = json.dumps(["not", "a", "dict"]).encode("utf-8")
    assert WorkflowCopilotMemoryCache("c").get() is None


def test_get_returns_none_when_fields_have_wrong_type(mocker: MockerFixture) -> None:
    redis_mock = mocker.patch(_REDIS)
    # summary must be str and recent_messages must be list; a wrong shape must
    # degrade to a miss rather than propagate a malformed memory.
    redis_mock.get.return_value = json.dumps({"summary": 123, "recent_messages": "nope"}).encode("utf-8")
    assert WorkflowCopilotMemoryCache("c").get() is None


def test_get_defaults_missing_fields(mocker: MockerFixture) -> None:
    redis_mock = mocker.patch(_REDIS)
    # A dict missing both fields is still valid: empty summary + no recent turns.
    redis_mock.get.return_value = json.dumps({}).encode("utf-8")

    result = WorkflowCopilotMemoryCache("c").get()

    assert result == {"summary": "", "recent_messages": []}


def test_set_writes_json_with_ttl(mocker: MockerFixture) -> None:
    redis_mock = mocker.patch(_REDIS)
    memory = {"summary": "s", "recent_messages": [{"role": "user", "content": "x"}]}

    WorkflowCopilotMemoryCache("conv-9").set(memory)  # type: ignore[arg-type]

    redis_mock.setex.assert_called_once()
    key, ttl, value = redis_mock.setex.call_args.args
    assert key == "workflow_copilot:mem:conv-9"
    assert ttl == 1800
    assert json.loads(value) == memory


def test_delete_removes_key(mocker: MockerFixture) -> None:
    redis_mock = mocker.patch(_REDIS)

    WorkflowCopilotMemoryCache("conv-9").delete()

    redis_mock.delete.assert_called_once_with("workflow_copilot:mem:conv-9")
