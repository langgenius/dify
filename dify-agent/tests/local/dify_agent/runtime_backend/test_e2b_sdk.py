"""Exercise Dify's real E2B SDK boundary with an in-memory HTTP transport.

These tests retain SDK serialization, response parsing, and retry middleware.
They do not exercise E2B services, envd RPC, or pyqwest's connection pools.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import json
from typing import cast

from e2b.api import client_async
from e2b.exceptions import SandboxException
from e2b.retry import AsyncRetryableTransport
import httpx
import pytest

from dify_agent.runtime_backend import (
    BindingCreateError,
    BindingDestroyError,
    ExecutionBindingCreateSpec,
    ExecutionBindingDestroySpec,
    HomeSnapshotCreateError,
    HomeSnapshotCreateSpec,
)
from dify_agent.runtime_backend.e2b import (
    E2BExecutionBindingBackend,
    E2BHomeSnapshotBackend,
    E2BRuntimeLease,
    E2BSDKControlPlane,
    _E2BControlPlaneCapacityExhaustedError,
    _E2BControlPlaneNotFoundError,
)
from dify_agent.runtime_backend.shellctl import ShellctlRuntimeLease

_API_KEY = "e2b_" + "0" * 40
_SANDBOX_ID = "sandbox-sdk-contract"


@dataclass
class _ApiTransport:
    responses: list[httpx.Response | httpx.RequestError] = field(default_factory=list)
    requests: list[httpx.Request] = field(default_factory=list)
    delays: list[float] = field(default_factory=list)
    retry_limits: list[int] = field(default_factory=list)
    now: float = 0.0

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        assert request.url.host == "api.e2b.test"
        assert self.responses, f"Unexpected SDK request: {request.method} {request.url.path}"
        response = self.responses.pop(0)
        if isinstance(response, httpx.RequestError):
            raise response
        return response

    async def sleep(self, delay: float) -> None:
        self.delays.append(delay)
        self.now += delay


@pytest.fixture
def api_transport(monkeypatch: pytest.MonkeyPatch) -> _ApiTransport:
    state = _ApiTransport()
    transport = httpx.MockTransport(state.handle)

    def retry_transport(inner: httpx.AsyncBaseTransport, retries: int) -> AsyncRetryableTransport:
        state.retry_limits.append(retries)
        return AsyncRetryableTransport(
            inner,
            retries,
            sleep=state.sleep,
            monotonic=lambda: state.now,
            random_=lambda: 0.0,
        )

    # Inject below the SDK's retry middleware, preserving get_api_client and
    # every public lifecycle method. Injectable clocks make its budget deterministic.
    # Source: https://github.com/e2b-dev/E2B/blob/%40e2b/python-sdk%402.52.0/packages/python-sdk/e2b/api/client_async/__init__.py
    monkeypatch.setattr(client_async, "get_transport", lambda *_args, **_kwargs: transport)
    monkeypatch.setattr(client_async, "AsyncRetryableTransport", retry_transport)
    monkeypatch.setenv("E2B_API_URL", "https://api.e2b.test")
    monkeypatch.setenv("E2B_DEBUG", "false")
    return state


def _sandbox_response() -> httpx.Response:
    return httpx.Response(
        201,
        json={
            "templateID": "prepared-template",
            "sandboxID": _SANDBOX_ID,
            "clientID": "contract-client",
            "envdVersion": "0.5.0",
            "envdAccessToken": "envd-contract-token",
            "trafficAccessToken": "traffic-contract-token",
            "domain": "e2b.test",
        },
    )


def _control_plane() -> E2BSDKControlPlane:
    return E2BSDKControlPlane(api_key=_API_KEY)


def _binding_backend() -> E2BExecutionBindingBackend:
    return E2BExecutionBindingBackend(
        control_plane=_control_plane(),
        template="prepared-template",
        active_timeout_seconds=120,
    )


async def _create_sandbox():
    return await _control_plane().create(
        "prepared-template",
        timeout=120,
        metadata={"dify.resource": "runtime-sandbox"},
        on_timeout="pause",
    )


def _destroy_spec() -> ExecutionBindingDestroySpec:
    return ExecutionBindingDestroySpec(
        binding_ref=_SANDBOX_ID,
        workspace_ref=_SANDBOX_ID,
        destroy_workspace=True,
    )


@pytest.mark.anyio
async def test_sdk_lifecycle_preserves_private_traffic_and_memory_resume(api_transport: _ApiTransport) -> None:
    api_transport.responses = [
        _sandbox_response(),
        _sandbox_response(),
        httpx.Response(204),
        httpx.Response(201, json={"snapshotID": "team/home:default", "names": []}),
        httpx.Response(204),
        httpx.Response(204),
    ]
    sandbox = await _create_sandbox()
    assert sandbox.sandbox_id == _SANDBOX_ID
    assert sandbox.traffic_access_token == "traffic-contract-token"
    assert sandbox.get_host(5004) == f"5004-{_SANDBOX_ID}.e2b.test"

    connected = await _control_plane().connect(_SANDBOX_ID, timeout=120)
    assert connected.traffic_access_token == "traffic-contract-token"
    assert await connected.pause(keep_memory=True)
    snapshot = await connected.create_snapshot()
    assert snapshot.snapshot_id == "team/home:default"
    assert await _control_plane().kill(_SANDBOX_ID)
    assert await _control_plane().delete_snapshot(snapshot.snapshot_id)

    assert [(request.method, request.url.raw_path) for request in api_transport.requests] == [
        ("POST", b"/v2/sandboxes"),
        ("POST", f"/v2/sandboxes/{_SANDBOX_ID}/connect".encode()),
        ("POST", f"/sandboxes/{_SANDBOX_ID}/pause".encode()),
        ("POST", f"/sandboxes/{_SANDBOX_ID}/snapshots".encode()),
        ("DELETE", f"/sandboxes/{_SANDBOX_ID}".encode()),
        ("DELETE", b"/templates/team%2Fhome%3Adefault"),
    ]
    create_body = json.loads(api_transport.requests[0].content)
    assert create_body["templateID"] == "prepared-template"
    assert create_body["timeout"] == 120
    assert create_body["metadata"] == {"dify.resource": "runtime-sandbox"}
    assert create_body["network"] == {"allowPublicTraffic": False}
    assert create_body["autoPause"] is True
    # Bare pause keeps the API's full-memory snapshot default, as with SDK 2.46.4.
    assert "autoPauseMemory" not in create_body
    assert create_body["autoResume"] == {"enabled": False}
    # SDK "restore" leaves memory unset, preserving the connect API's memory-restore default.
    assert json.loads(api_transport.requests[1].content) == {"timeout": 120}
    assert json.loads(api_transport.requests[2].content) == {"memory": True}
    assert all(request.headers["X-API-Key"] == _API_KEY for request in api_transport.requests)
    assert api_transport.retry_limits == [3] * 6
    assert api_transport.delays == []


@pytest.mark.anyio
async def test_sdk_preserves_already_paused_and_absent_resource_results(api_transport: _ApiTransport) -> None:
    api_transport.responses = [
        _sandbox_response(),
        httpx.Response(409, json={"code": 409, "message": "already paused"}),
        *[httpx.Response(404, json={"code": 404, "message": "not found"}) for _ in range(3)],
    ]
    sandbox = await _create_sandbox()
    assert await sandbox.pause(keep_memory=True) is False
    assert await _control_plane().kill(_SANDBOX_ID) is False
    assert await _control_plane().delete_snapshot("team/home:default") is False
    with pytest.raises(_E2BControlPlaneNotFoundError, match="not found"):
        await _control_plane().connect(_SANDBOX_ID, timeout=120)
    assert len(api_transport.requests) == 5
    assert api_transport.delays == []


@pytest.mark.anyio
@pytest.mark.parametrize(("status", "headers"), [(502, {}), (503, {}), (429, {"Retry-After": "2"})])
async def test_sdk_recovers_transient_create_responses(
    api_transport: _ApiTransport, status: int, headers: dict[str, str]
) -> None:
    api_transport.responses = [
        httpx.Response(status, headers=headers, json={"code": status, "message": "busy"}),
        _sandbox_response(),
    ]
    assert (await _create_sandbox()).sandbox_id == _SANDBOX_ID
    assert len(api_transport.requests) == 2
    assert api_transport.requests[0].content == api_transport.requests[1].content
    assert api_transport.delays == ([2.0] if status == 429 else [0.05])


@pytest.mark.anyio
@pytest.mark.parametrize("status", [502, 503])
async def test_destroy_exhausts_one_sdk_retry_budget(api_transport: _ApiTransport, status: int) -> None:
    api_transport.responses = [httpx.Response(status, json={"code": status, "message": "busy"}) for _ in range(4)]
    with pytest.raises(BindingDestroyError, match=str(status)):
        await _binding_backend().destroy_binding(_destroy_spec())
    assert len(api_transport.requests) == 4
    assert api_transport.delays == [0.05, 0.1, 0.2]
    assert api_transport.retry_limits == [3]
    timeouts = [request.extensions["timeout"]["read"] for request in api_transport.requests]
    assert timeouts[-1] < timeouts[0]


@pytest.mark.anyio
@pytest.mark.parametrize("error_type", [httpx.ReadError, httpx.WriteError, httpx.RemoteProtocolError])
async def test_destroy_does_not_repeat_sdk_exhausted_network_retries(
    api_transport: _ApiTransport, error_type: type[httpx.RequestError]
) -> None:
    api_transport.responses = [error_type("request interrupted") for _ in range(4)]
    with pytest.raises(BindingDestroyError, match="request interrupted"):
        await _binding_backend().destroy_binding(_destroy_spec())
    assert len(api_transport.requests) == 4
    assert api_transport.delays == [0.05, 0.1, 0.2]
    assert api_transport.retry_limits == [3]


@pytest.mark.anyio
@pytest.mark.parametrize(("status", "headers"), [(500, {}), (504, {}), (429, {}), (429, {"Retry-After": "61"})])
async def test_sdk_does_not_retry_terminal_or_over_budget_responses(
    api_transport: _ApiTransport, status: int, headers: dict[str, str]
) -> None:
    api_transport.responses = [httpx.Response(status, headers=headers, json={"code": status, "message": "unavailable"})]
    expected_error = _E2BControlPlaneCapacityExhaustedError if status == 429 else SandboxException
    with pytest.raises(expected_error, match=str(status)):
        await _create_sandbox()
    assert len(api_transport.requests) == 1
    assert api_transport.delays == []


@pytest.mark.anyio
@pytest.mark.parametrize("operation", ["create", "snapshot"])
@pytest.mark.parametrize(
    "error_type", [httpx.ReadError, httpx.WriteError, httpx.RemoteProtocolError, httpx.ReadTimeout]
)
async def test_resource_creates_are_not_replayed_after_request_interruption(
    api_transport: _ApiTransport, operation: str, error_type: type[httpx.RequestError]
) -> None:
    error = error_type("request interrupted after sending")
    if operation == "create":
        api_transport.responses = [error]
        with pytest.raises(BindingCreateError, match="request interrupted"):
            await _binding_backend().create_binding(
                ExecutionBindingCreateSpec(
                    tenant_id="tenant-contract",
                    agent_id="agent-contract",
                    binding_id="binding-contract",
                    workspace_id="workspace-contract",
                    existing_workspace_ref=None,
                )
            )
    else:
        api_transport.responses = [_sandbox_response()]
        sandbox = await _create_sandbox()
        api_transport.requests.clear()
        api_transport.responses = [error]
        source = E2BRuntimeLease(sandbox=sandbox, data_plane=cast(ShellctlRuntimeLease, object()))
        with pytest.raises(HomeSnapshotCreateError, match="request interrupted"):
            await E2BHomeSnapshotBackend(control_plane=_control_plane()).create_from_runtime(
                spec=HomeSnapshotCreateSpec(
                    tenant_id="tenant-contract", agent_id="agent-contract", home_snapshot_id="home-contract"
                ),
                source=source,
            )
    assert len(api_transport.requests) == 1
    assert api_transport.delays == []


@pytest.mark.anyio
@pytest.mark.parametrize("error_type", [httpx.ReadError, httpx.WriteError, httpx.RemoteProtocolError])
async def test_sdk_replays_idempotent_connect_after_network_error(
    api_transport: _ApiTransport, error_type: type[httpx.RequestError]
) -> None:
    api_transport.responses = [error_type("request interrupted") for _ in range(3)] + [_sandbox_response()]
    assert (await _control_plane().connect(_SANDBOX_ID, timeout=120)).sandbox_id == _SANDBOX_ID
    assert len(api_transport.requests) == 4
    assert api_transport.delays == [0.05, 0.1, 0.2]


@pytest.mark.anyio
async def test_destroy_does_not_restart_timeout_budget(api_transport: _ApiTransport) -> None:
    api_transport.responses = [httpx.ReadTimeout("request timed out")]
    with pytest.raises(BindingDestroyError, match="request timed out"):
        await _binding_backend().destroy_binding(_destroy_spec())
    assert len(api_transport.requests) == 1
    assert api_transport.delays == []
