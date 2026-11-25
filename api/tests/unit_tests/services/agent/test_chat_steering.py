import json
from typing import TypedDict
from uuid import uuid4

import httpx
import pytest
from dify_agent.client import Client
from dify_agent.protocol import RunInputRequest

from configs import dify_config
from services.agent import chat_steering
from services.agent.chat_steering import (
    AgentChatBackendUnavailableError,
    AgentChatInputConflictError,
    AgentChatTaskNotFoundError,
    AgentChatTaskScope,
    agent_preview_async_loop_enabled,
    enqueue_agent_chat_input,
    get_agent_chat_queue,
    register_agent_chat_task,
)


@pytest.fixture
def enable_feature(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(dify_config, "AGENT_APP_ASYNC_LOOP_ENABLED", True)
    monkeypatch.setattr(dify_config, "AGENT_BACKEND_BASE_URL", "http://agent.test")
    monkeypatch.setattr(dify_config, "AGENT_BACKEND_API_TOKEN", "token")
    monkeypatch.setattr(dify_config, "AGENT_BACKEND_USE_FAKE", False)


@pytest.fixture
def disable_feature(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(dify_config, "AGENT_APP_ASYNC_LOOP_ENABLED", False)


class _RedisCalls(TypedDict):
    setex: list[tuple[str, int, object]]
    get: list[str]
    value: object


@pytest.fixture
def redis_calls(monkeypatch: pytest.MonkeyPatch) -> _RedisCalls:
    calls: _RedisCalls = {"setex": [], "get": []}

    def setex(name: str, time: int, value: object) -> None:
        calls["setex"].append((name, time, value))

    def get(name: str) -> object:
        calls["get"].append(name)
        return calls.get("value")

    class _StubRedis:
        pass

    redis_stub = _StubRedis()
    redis_stub.setex = setex
    redis_stub.get = get
    monkeypatch.setattr(chat_steering, "redis_client", redis_stub)
    return calls


@pytest.fixture
def bound_run(redis_calls: _RedisCalls) -> str:
    redis_calls["value"] = "run-123"
    return "run-123"


def _scope(**overrides: object) -> AgentChatTaskScope:
    kwargs: dict[str, object] = {
        "tenant_id": "tenant-1",
        "app_id": "app-1",
        "user_id": "user-1",
        "task_id": uuid4(),
    }
    kwargs.update(overrides)
    return AgentChatTaskScope(**kwargs)  # type: ignore[arg-type]


def _client(handler: httpx.MockTransport) -> Client:
    return Client(base_url="http://agent.test", sync_http_client=httpx.Client(transport=handler))


def _queue_transport() -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET" and request.url.path.endswith("/queue"):
            return httpx.Response(
                200,
                json={
                    "accepting_inputs": True,
                    "entries": [{"kind": "input_queued", "id": str(uuid4())}],
                },
            )
        raise AssertionError(f"unexpected request {request.method} {request.url}")

    return httpx.MockTransport(handler)


def _inputs_transport(*, status: int = 202, body: dict[str, object] | None = None) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST" and request.url.path.endswith("/inputs"):
            payload = json.loads(request.content)
            return httpx.Response(
                status,
                json=body or {"input_id": payload["input_id"], "status": "queued"},
            )
        raise AssertionError(f"unexpected request {request.method} {request.url}")

    return httpx.MockTransport(handler)


class TestFeatureFlag:
    @pytest.mark.usefixtures("disable_feature")
    def test_disabled_by_default(self) -> None:
        assert agent_preview_async_loop_enabled() is False

    @pytest.mark.usefixtures("enable_feature")
    def test_requires_backend_and_token(self, monkeypatch: pytest.MonkeyPatch) -> None:
        assert agent_preview_async_loop_enabled() is True
        monkeypatch.setattr(dify_config, "AGENT_BACKEND_USE_FAKE", True)
        assert agent_preview_async_loop_enabled() is False


class TestResolveRunId:
    @pytest.mark.usefixtures("disable_feature")
    def test_disabled_skips_redis(self, redis_calls: _RedisCalls) -> None:
        with pytest.raises(AgentChatTaskNotFoundError):
            get_agent_chat_queue(_scope())
        assert redis_calls["get"] == []

    @pytest.mark.usefixtures("enable_feature", "bound_run")
    def test_wrong_scope_misses_binding(self) -> None:
        base = _scope()
        wrong = _scope(task_id=base.task_id, tenant_id="other-tenant")
        assert wrong.cache_key() != base.cache_key()

    @pytest.mark.usefixtures("enable_feature", "redis_calls")
    def test_missing_binding_raises_before_http(self) -> None:
        with pytest.raises(AgentChatTaskNotFoundError):
            get_agent_chat_queue(_scope())


class TestRegister:
    def test_registers_bound_run_id(self, redis_calls: _RedisCalls) -> None:
        scope = _scope()
        register_agent_chat_task(scope, "run-123")
        ((name, ttl, value),) = redis_calls["setex"]
        assert name == scope.cache_key()
        assert ttl == 1800
        assert value == "run-123"


@pytest.mark.usefixtures("enable_feature", "bound_run")
class TestQueueAndInput:
    def test_queue_snapshot(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(chat_steering, "_run_client", lambda: _client(_queue_transport()))
        response = get_agent_chat_queue(_scope())
        assert response.accepting_inputs is True
        assert response.entries[0].kind == "input_queued"

    def test_queue_404_maps_not_found(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        transport = httpx.MockTransport(lambda _request: httpx.Response(404, json={"detail": "gone"}))
        monkeypatch.setattr(chat_steering, "_run_client", lambda: _client(transport))
        with pytest.raises(AgentChatTaskNotFoundError):
            get_agent_chat_queue(_scope())

    def test_enqueue_success(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(chat_steering, "_run_client", lambda: _client(_inputs_transport()))
        request = RunInputRequest(input_id=uuid4(), text="steer")
        response = enqueue_agent_chat_input(_scope(), request)
        assert response.input_id == request.input_id
        assert response.status == "queued"

    def test_enqueue_conflict_hides_upstream_detail(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        transport = httpx.MockTransport(lambda _request: httpx.Response(409, json={"detail": "internal run state xyz"}))
        monkeypatch.setattr(chat_steering, "_run_client", lambda: _client(transport))
        with pytest.raises(AgentChatInputConflictError) as excinfo:
            enqueue_agent_chat_input(_scope(), RunInputRequest(input_id=uuid4(), text="x"))
        assert "internal run state" not in str(excinfo.value)

    def test_transport_failure_maps_unavailable(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("refused", request=request)

        monkeypatch.setattr(chat_steering, "_run_client", lambda: _client(httpx.MockTransport(handler)))
        with pytest.raises(AgentChatBackendUnavailableError):
            get_agent_chat_queue(_scope())
