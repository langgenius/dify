import json
from typing import TypedDict
from uuid import uuid4

import httpx
import pytest
from dify_agent.client import Client
from dify_agent.protocol import RunInputRequest

from configs import dify_config
from core.app.entities.app_invoke_entities import DifyRunContext, InvokeFrom, UserFrom
from machinery.context import RequestContext
from services.agent import chat_steering
from services.agent.chat_steering import (
    AgentChatBackendUnavailableError,
    AgentChatInputConflictError,
    AgentChatSteeringService,
    AgentChatTaskNotFoundError,
    AgentChatTaskScope,
    agent_preview_async_loop_enabled,
    enqueue_agent_chat_input,
    get_agent_chat_queue,
    interrupt_agent_chat_input,
    register_agent_chat_task,
)
from services.app.agent_app_contracts import AgentAppNotFoundError
from services.app_task_service import AppTaskService


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


class _StubRedis:
    def __init__(self, calls: _RedisCalls) -> None:
        self._calls = calls

    def setex(self, name: str, time: int, value: object) -> None:
        self._calls["setex"].append((name, time, value))

    def get(self, name: str) -> object:
        self._calls["get"].append(name)
        return self._calls["value"]


@pytest.fixture
def redis_calls(monkeypatch: pytest.MonkeyPatch) -> _RedisCalls:
    calls: _RedisCalls = {"setex": [], "get": [], "value": None}
    monkeypatch.setattr(chat_steering, "redis_client", _StubRedis(calls))
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


def _interrupt_transport(
    *,
    status: int = 202,
    pending: list[str] | None = None,
    cancel_status: int = 200,
    calls: list[str] | None = None,
) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST" and request.url.path.endswith("/interrupt"):
            if calls is not None:
                calls.append("interrupt")
            input_id = request.url.path.removesuffix("/interrupt").rsplit("/", 1)[-1]
            return httpx.Response(
                status,
                json={
                    "input_id": input_id,
                    "pending_inputs": [
                        {"input_id": pending_id, "text": "queued"} for pending_id in (pending or [input_id])
                    ],
                },
            )
        if request.method == "POST" and request.url.path.endswith("/cancel"):
            if calls is not None:
                calls.append("cancel")
            run_id = request.url.path.removesuffix("/cancel").rsplit("/", 1)[-1]
            return httpx.Response(
                cancel_status,
                json={"run_id": run_id, "status": "cancelled"} if cancel_status < 400 else {"detail": "conflict"},
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

    def test_interrupt_freezes_stops_and_waits_for_settle(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        scope = _scope()
        selected, other = uuid4(), uuid4()
        backend_calls: list[str] = []
        transport = _interrupt_transport(pending=[str(other), str(selected)], calls=backend_calls)
        monkeypatch.setattr(chat_steering, "_run_client", lambda: _client(transport))
        order: list[str] = []

        def record_stop(**_kwargs: object) -> None:
            order.append("stop")

        monkeypatch.setattr(AppTaskService, "stop_task", record_stop)
        monkeypatch.setattr(
            chat_steering,
            "wait_for_agent_chat_handoff",
            lambda _task_id: order.append("wait") or True,
        )

        response = interrupt_agent_chat_input(scope, RunInputRequest(input_id=selected, text="urgent"))
        assert response.input_id == selected
        assert [item.input_id for item in response.pending_inputs] == [other, selected]
        # Freeze → ordinary Stop flag → direct backend cancel → settle barrier.
        assert backend_calls == ["interrupt", "cancel"]
        assert order == ["stop", "wait"]

    def test_interrupt_cancel_conflict_still_waits_for_settle(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        backend_calls: list[str] = []
        monkeypatch.setattr(
            chat_steering, "_run_client", lambda: _client(_interrupt_transport(cancel_status=409, calls=backend_calls))
        )
        monkeypatch.setattr(AppTaskService, "stop_task", lambda **_kwargs: None)
        settled: list[str] = []
        monkeypatch.setattr(
            chat_steering, "wait_for_agent_chat_handoff", lambda task_id: settled.append(task_id) or True
        )

        scope = _scope()
        interrupt_agent_chat_input(scope, RunInputRequest(input_id=uuid4(), text="x"))
        assert backend_calls == ["interrupt", "cancel"]
        # A 409 only means the run already finished; the barrier still decides.
        assert settled == [str(scope.task_id)]

    def test_interrupt_cancel_failure_never_starts_next_turn(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(chat_steering, "_run_client", lambda: _client(_interrupt_transport(cancel_status=500)))
        monkeypatch.setattr(AppTaskService, "stop_task", lambda **_kwargs: None)
        waited: list[str] = []
        monkeypatch.setattr(
            chat_steering, "wait_for_agent_chat_handoff", lambda task_id: waited.append(task_id) or True
        )

        with pytest.raises(AgentChatBackendUnavailableError):
            interrupt_agent_chat_input(_scope(), RunInputRequest(input_id=uuid4(), text="x"))
        assert waited == []

    def test_interrupt_settle_timeout_maps_unavailable(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(chat_steering, "_run_client", lambda: _client(_interrupt_transport()))
        monkeypatch.setattr(AppTaskService, "stop_task", lambda **_kwargs: None)
        monkeypatch.setattr(chat_steering, "wait_for_agent_chat_handoff", lambda _task_id: False)
        with pytest.raises(AgentChatBackendUnavailableError):
            interrupt_agent_chat_input(_scope(), RunInputRequest(input_id=uuid4(), text="x"))

    def test_interrupt_conflict_maps_to_conflict(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(chat_steering, "_run_client", lambda: _client(_interrupt_transport(status=409)))
        with pytest.raises(AgentChatInputConflictError):
            interrupt_agent_chat_input(_scope(), RunInputRequest(input_id=uuid4(), text="x"))

    def test_interrupt_unknown_task_maps_not_found(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(chat_steering, "_run_client", lambda: _client(_interrupt_transport(status=404)))
        with pytest.raises(AgentChatTaskNotFoundError):
            interrupt_agent_chat_input(_scope(), RunInputRequest(input_id=uuid4(), text="x"))


class _StubOwners:
    """Records owner lookups and resolves one configured app id."""

    def __init__(self, app_id: str | None = "app-resolved") -> None:
        self._app_id = app_id
        self.calls: list[tuple[str, str]] = []

    def resolve_roster_app_id(self, *, tenant_id: str, agent_id: str) -> str:
        self.calls.append((tenant_id, agent_id))
        if self._app_id is None:
            raise AgentAppNotFoundError
        return self._app_id


def _context(*, workspace: str = "tenant-ctx", account: str = "user-ctx") -> RequestContext:
    return RequestContext(
        request_id="req-1",
        trace_id=None,
        account_id=account,
        active_workspace_id=workspace,
    )


@pytest.mark.usefixtures("enable_feature", "bound_run")
class TestSteeringService:
    def test_scope_uses_context_identity_and_resolved_app(
        self,
        redis_calls: _RedisCalls,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        owners = _StubOwners()
        service = AgentChatSteeringService(owners=owners)
        agent_id, task_id = uuid4(), uuid4()
        monkeypatch.setattr(chat_steering, "_run_client", lambda: _client(_queue_transport()))
        response = service.get_queue(_context(), agent_id, task_id)
        assert response.accepting_inputs
        assert owners.calls == [("tenant-ctx", str(agent_id))]
        expected = AgentChatTaskScope(
            tenant_id="tenant-ctx", app_id="app-resolved", user_id="user-ctx", task_id=task_id
        )
        assert redis_calls["get"] == [expected.cache_key()]

    def test_unknown_agent_never_touches_storage_or_backend(
        self,
        redis_calls: _RedisCalls,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(
            chat_steering,
            "_run_client",
            lambda: pytest.fail("backend client must not be built for an unknown agent"),
        )
        service = AgentChatSteeringService(owners=_StubOwners(app_id=None))
        with pytest.raises(AgentAppNotFoundError):
            service.get_queue(_context(), uuid4(), uuid4())
        with pytest.raises(AgentAppNotFoundError):
            service.enqueue_input(_context(), uuid4(), uuid4(), RunInputRequest(input_id=uuid4(), text="x"))
        with pytest.raises(AgentAppNotFoundError):
            service.interrupt_input(_context(), uuid4(), uuid4(), RunInputRequest(input_id=uuid4(), text="x"))
        assert redis_calls["get"] == []
        assert redis_calls["setex"] == []

    @pytest.mark.usefixtures("redis_calls")
    def test_interrupt_input_uses_scoped_binding(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        owners = _StubOwners()
        service = AgentChatSteeringService(owners=owners)
        agent_id, task_id, input_id = uuid4(), uuid4(), uuid4()
        monkeypatch.setattr(chat_steering, "_run_client", lambda: _client(_interrupt_transport()))
        monkeypatch.setattr(AppTaskService, "stop_task", lambda **_kwargs: None)
        monkeypatch.setattr(chat_steering, "wait_for_agent_chat_handoff", lambda _tid: True)
        response = service.interrupt_input(
            _context(), agent_id, task_id, RunInputRequest(input_id=input_id, text="urgent")
        )
        assert response.input_id == input_id
        assert [item.input_id for item in response.pending_inputs] == [input_id]
        assert owners.calls == [("tenant-ctx", str(agent_id))]


def test_handoff_barrier_waits_for_runner_mark(redis_calls: _RedisCalls, monkeypatch: pytest.MonkeyPatch) -> None:
    """The settle barrier returns only after the runner marked snapshot save."""
    from core.app.apps.agent_app import steering_handoff

    monkeypatch.setattr(steering_handoff, "redis_client", _StubRedis(redis_calls))
    monkeypatch.setattr(steering_handoff, "_WAIT_TIMEOUT_SECONDS", 0.05)
    assert steering_handoff.wait_for_agent_chat_handoff("task-1") is False
    steering_handoff.mark_agent_chat_handoff_ready("task-1")
    ((name, ttl, value),) = redis_calls["setex"]
    assert name == "agent-chat-handoff-ready:task-1"
    assert ttl == 1800
    assert value == "1"
    redis_calls["value"] = "1"
    assert steering_handoff.wait_for_agent_chat_handoff("task-1") is True


@pytest.mark.parametrize("settled_after", [None, 10.27])
def test_handoff_barrier_budget_outlasts_termination_grace(
    settled_after: float | None,
    redis_calls: _RedisCalls,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The default wait budget must outlast the runner's termination grace."""
    from core.app.apps.agent_app import steering_handoff

    elapsed = 0.0

    def advance(seconds: float) -> None:
        nonlocal elapsed
        elapsed += seconds
        if settled_after is not None and elapsed >= settled_after:
            redis_calls["value"] = "1"

    monkeypatch.setattr(steering_handoff, "redis_client", _StubRedis(redis_calls))
    with monkeypatch.context() as clock_patch:
        clock_patch.setattr(steering_handoff.time, "monotonic", lambda: elapsed)
        clock_patch.setattr(steering_handoff.time, "sleep", advance)

        assert steering_handoff.wait_for_agent_chat_handoff("task-1") is (settled_after is not None)
    if settled_after is None:
        assert elapsed == pytest.approx(steering_handoff._WAIT_TIMEOUT_SECONDS)


class _MappedRedis:
    """Key-mapped Redis stub: a binding written under one scope's key is
    invisible to every other scope, including the other surface's."""

    def __init__(self) -> None:
        self.store: dict[str, object] = {}
        self.gets: list[str] = []

    def setex(self, name: str, _time: int, value: object) -> None:
        self.store[name] = value

    def get(self, name: str) -> object:
        self.gets.append(name)
        return self.store.get(name)


@pytest.mark.usefixtures("enable_feature")
class TestSurfaceScopedBinding:
    def test_web_scope_uses_web_prefix(self) -> None:
        task_id = uuid4()
        preview = _scope(task_id=task_id)
        web = _scope(task_id=task_id, invoke_from=InvokeFrom.WEB_APP)
        assert preview.cache_key().startswith("agent-preview-run:")
        assert web.cache_key().startswith("agent-web-run:")
        assert web.cache_key() != preview.cache_key()

    def test_web_scope_misses_preview_binding(self, monkeypatch: pytest.MonkeyPatch) -> None:
        redis = _MappedRedis()
        monkeypatch.setattr(chat_steering, "redis_client", redis)
        task_id = uuid4()
        preview = _scope(task_id=task_id)
        web = _scope(task_id=task_id, invoke_from=InvokeFrom.WEB_APP)
        register_agent_chat_task(preview, "run-123")

        with pytest.raises(AgentChatTaskNotFoundError):
            get_agent_chat_queue(web)
        assert redis.gets == [web.cache_key()]

        monkeypatch.setattr(chat_steering, "_run_client", lambda: _client(_queue_transport()))
        response = get_agent_chat_queue(preview)
        assert response.accepting_inputs is True

    def test_bind_derives_surface_from_context(self, monkeypatch: pytest.MonkeyPatch) -> None:
        redis = _MappedRedis()
        monkeypatch.setattr(chat_steering, "redis_client", redis)
        task_id = str(uuid4())
        context = DifyRunContext(
            tenant_id="tenant-1",
            app_id="app-1",
            user_id="user-1",
            user_from=UserFrom.END_USER,
            invoke_from=InvokeFrom.WEB_APP,
        )
        assert chat_steering.bind_steering_task_to_run(context, task_id, "run-web") is True

        web_scope = _scope(task_id=task_id, invoke_from=InvokeFrom.WEB_APP)
        preview_scope = _scope(task_id=task_id)
        assert redis.store[web_scope.cache_key()] == "run-web"
        assert preview_scope.cache_key() not in redis.store

    def test_web_interrupt_stops_with_web_identity(self, monkeypatch: pytest.MonkeyPatch) -> None:
        redis = _MappedRedis()
        monkeypatch.setattr(chat_steering, "redis_client", redis)
        scope = _scope(invoke_from=InvokeFrom.WEB_APP)
        register_agent_chat_task(scope, "run-web")
        monkeypatch.setattr(chat_steering, "_run_client", lambda: _client(_interrupt_transport()))
        stopped: list[dict[str, object]] = []
        monkeypatch.setattr(AppTaskService, "stop_task", lambda **kwargs: stopped.append(kwargs))
        monkeypatch.setattr(chat_steering, "wait_for_agent_chat_handoff", lambda _task_id: True)

        interrupt_agent_chat_input(scope, RunInputRequest(input_id=uuid4(), text="urgent"))
        assert redis.gets == [scope.cache_key(), scope.cache_key()]
        (stop,) = stopped
        assert stop["invoke_from"] == InvokeFrom.WEB_APP
