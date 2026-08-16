from __future__ import annotations

import json
from collections.abc import Callable
from typing import cast

import httpx2 as httpx
import pytest

from dify_agent.runtime_backend import (
    BindingAcquireError,
    BindingCreateError,
    BindingDestroyError,
    BindingLostError,
    ExecutionBindingCreateSpec,
    ExecutionBindingDestroySpec,
    HomeSnapshotCreateSpec,
    RuntimeLease,
    SharedWorkspaceUnsupportedError,
    WorkspacePreservationUnsupportedError,
)
from dify_agent.runtime_backend.enterprise import (
    EnterpriseExecutionBindingBackend,
    EnterpriseHomeSnapshotBackend,
)


def _mock_http(
    monkeypatch: pytest.MonkeyPatch,
    handler: Callable[[httpx.Request], httpx.Response],
) -> list[httpx.AsyncClient]:
    original_async_client = httpx.AsyncClient
    transport = httpx.MockTransport(handler)
    clients: list[httpx.AsyncClient] = []

    def create_transport(*, retries: int = 0) -> httpx.AsyncBaseTransport:
        del retries
        return transport

    monkeypatch.setattr(httpx, "AsyncHTTPTransport", create_transport)

    def create_client(*args: object, **kwargs: object) -> httpx.AsyncClient:
        _ = kwargs.setdefault("transport", transport)
        client = original_async_client(*args, **kwargs)
        clients.append(client)
        return client

    monkeypatch.setattr(httpx, "AsyncClient", create_client)
    return clients


def _job_response(*, exit_code: int = 0) -> httpx.Response:
    return httpx.Response(
        200,
        json={
            "job_id": "job-1",
            "done": True,
            "status": "exited",
            "exit_code": exit_code,
            "output_path": "/tmp/output.log",
            "output": "",
            "offset": 0,
            "truncated": False,
        },
    )


@pytest.mark.anyio
async def test_enterprise_acquire_exposes_canonical_layout_through_gateway_proxy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        assert request.headers["X-Sandbox-Id"] == "sandbox-1"
        assert request.headers["X-Inner-Api-Key"] == "secret"
        if request.method == "POST":
            payload = cast(dict[str, object], json.loads(request.content))
            script = payload["script"]
            assert isinstance(script, str)
            assert "test -d /home/dify" in script
            assert "test -d /home/dify/workspace" in script
            return _job_response()
        return httpx.Response(200, json={"job_id": "job-1"})

    clients = _mock_http(monkeypatch, handler)
    backend = EnterpriseExecutionBindingBackend(
        gateway_endpoint="http://gateway.example",
        auth_token="secret",
        proxy_timeout=90,
    )

    lease = await backend.acquire("sandbox-1")

    assert lease.layout.home_dir == "/home/dify"
    assert lease.layout.workspace_dir == "/home/dify/workspace"
    assert [request.url.path for request in requests] == [
        "/proxy/v1/jobs/run",
        "/proxy/v1/jobs/job-1",
    ]
    assert clients[0].timeout.read == 90
    await backend.release(lease)
    assert clients[0].is_closed


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("status_code", "code", "expected_error"),
    [
        (404, "sandbox_expired", BindingLostError),
        (502, "upstream_failure", BindingAcquireError),
    ],
)
async def test_enterprise_acquire_maps_proxy_failures_and_closes_transport(
    monkeypatch: pytest.MonkeyPatch,
    status_code: int,
    code: str,
    expected_error: type[Exception],
) -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(status_code, json={"error": {"code": code, "message": "unavailable"}})

    clients = _mock_http(monkeypatch, handler)
    backend = EnterpriseExecutionBindingBackend(
        gateway_endpoint="http://gateway.example",
        auth_token="secret",
    )

    with pytest.raises(expected_error):
        _ = await backend.acquire("sandbox-1")

    assert clients[0].is_closed


@pytest.mark.anyio
async def test_enterprise_acquire_treats_missing_runtime_directories_as_lost(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            return _job_response(exit_code=1)
        return httpx.Response(200, json={"job_id": "job-1"})

    clients = _mock_http(monkeypatch, handler)
    backend = EnterpriseExecutionBindingBackend(
        gateway_endpoint="http://gateway.example",
        auth_token="secret",
    )

    with pytest.raises(BindingLostError, match="Home or Workspace"):
        _ = await backend.acquire("sandbox-1")

    assert clients[0].is_closed


@pytest.mark.anyio
async def test_enterprise_release_rejects_foreign_runtime_lease() -> None:
    backend = EnterpriseExecutionBindingBackend(
        gateway_endpoint="http://gateway.example",
        auth_token="secret",
    )

    with pytest.raises(TypeError, match="only release its own RuntimeLease"):
        await backend.release(cast(RuntimeLease, object()))


@pytest.mark.anyio
async def test_enterprise_destroy_validates_coupled_workspace_before_gateway_call(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(204)

    _ = _mock_http(monkeypatch, handler)
    backend = EnterpriseExecutionBindingBackend(
        gateway_endpoint="http://gateway.example",
        auth_token="secret",
    )

    with pytest.raises(WorkspacePreservationUnsupportedError):
        await backend.destroy_binding(ExecutionBindingDestroySpec(binding_ref="sandbox-1", destroy_workspace=False))
    with pytest.raises(BindingDestroyError, match="must equal"):
        await backend.destroy_binding(
            ExecutionBindingDestroySpec(
                binding_ref="sandbox-1",
                workspace_ref="workspace-1",
                destroy_workspace=True,
            )
        )

    assert requests == []


@pytest.mark.anyio
@pytest.mark.parametrize("status_code", [204, 404])
async def test_enterprise_destroy_is_authenticated_and_idempotent(
    monkeypatch: pytest.MonkeyPatch,
    status_code: int,
) -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(status_code)

    clients = _mock_http(monkeypatch, handler)
    backend = EnterpriseExecutionBindingBackend(
        gateway_endpoint="http://gateway.example",
        auth_token="secret",
    )

    await backend.destroy_binding(
        ExecutionBindingDestroySpec(
            binding_ref="sandbox-1",
            workspace_ref="sandbox-1",
            destroy_workspace=True,
        )
    )

    assert len(requests) == 1
    assert requests[0].method == "DELETE"
    assert requests[0].url.path == "/v1/sandboxes/sandbox-1"
    assert requests[0].headers["X-Inner-Api-Key"] == "secret"
    assert clients[0].is_closed


@pytest.mark.anyio
async def test_enterprise_destroy_encodes_binding_ref_as_one_path_segment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(204)

    _ = _mock_http(monkeypatch, handler)
    backend = EnterpriseExecutionBindingBackend(
        gateway_endpoint="http://gateway.example",
        auth_token="secret",
    )
    opaque_ref = "../admin?x=1"

    await backend.destroy_binding(
        ExecutionBindingDestroySpec(
            binding_ref=opaque_ref,
            workspace_ref=opaque_ref,
            destroy_workspace=True,
        )
    )

    assert len(requests) == 1
    assert requests[0].url.raw_path == b"/v1/sandboxes/..%2Fadmin%3Fx%3D1"


@pytest.mark.anyio
async def test_enterprise_destroy_propagates_gateway_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(502, text="gateway failed")

    clients = _mock_http(monkeypatch, handler)
    backend = EnterpriseExecutionBindingBackend(
        gateway_endpoint="http://gateway.example",
        auth_token="secret",
    )

    with pytest.raises(BindingDestroyError, match="502"):
        await backend.destroy_binding(
            ExecutionBindingDestroySpec(
                binding_ref="sandbox-1",
                workspace_ref="sandbox-1",
                destroy_workspace=True,
            )
        )

    assert clients[0].is_closed


@pytest.mark.anyio
async def test_enterprise_default_binding_creates_gateway_sandbox_and_layout(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path == "/v1/sandboxes":
            assert json.loads(request.content) == {"tenantId": "tenant-1"}
            return httpx.Response(201, json={"sandboxId": "sandbox-1", "status": "running"})
        if request.url.path == "/proxy/v1/jobs/run":
            assert request.headers["X-Sandbox-Id"] == "sandbox-1"
            payload = cast(dict[str, object], json.loads(request.content))
            script = payload["script"]
            assert isinstance(script, str)
            assert "mkdir -p /home/dify" in script
            assert "rm -rf -- /home/dify/workspace" in script
            return _job_response()
        return httpx.Response(200, json={"job_id": "job-1"})

    clients = _mock_http(monkeypatch, handler)
    backend = EnterpriseExecutionBindingBackend(gateway_endpoint="http://gateway.example", auth_token="secret")

    allocation = await backend.create_binding(
        ExecutionBindingCreateSpec(
            tenant_id="tenant-1",
            agent_id="agent-1",
            binding_id="binding-1",
            workspace_id="workspace-1",
            existing_workspace_ref=None,
            home_snapshot_ref=None,
        )
    )

    assert allocation.binding_ref == allocation.workspace_ref == "sandbox-1"
    assert requests[0].headers["X-Inner-Api-Key"] == "secret"
    assert all(client.is_closed for client in clients)


@pytest.mark.anyio
async def test_enterprise_binding_rejects_snapshot_and_shared_workspace_before_gateway_call(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requests: list[httpx.Request] = []
    _ = _mock_http(monkeypatch, lambda request: requests.append(request) or httpx.Response(500))
    backend = EnterpriseExecutionBindingBackend(gateway_endpoint="http://gateway.example", auth_token="secret")

    with pytest.raises(BindingCreateError, match="immutable Home Snapshot"):
        await backend.create_binding(
            ExecutionBindingCreateSpec(
                tenant_id="tenant-1",
                agent_id="agent-1",
                binding_id="binding-1",
                workspace_id="workspace-1",
                existing_workspace_ref=None,
                home_snapshot_ref="snapshot-1",
            )
        )
    with pytest.raises(SharedWorkspaceUnsupportedError):
        await backend.create_binding(
            ExecutionBindingCreateSpec(
                tenant_id="tenant-1",
                agent_id="agent-1",
                binding_id="binding-1",
                workspace_id="workspace-1",
                existing_workspace_ref="workspace-1",
                home_snapshot_ref=None,
            )
        )

    assert requests == []


@pytest.mark.anyio
async def test_enterprise_binding_create_deletes_new_sandbox_when_layout_setup_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path == "/v1/sandboxes":
            return httpx.Response(201, json={"sandboxId": "sandbox-1"})
        if request.url.path == "/proxy/v1/jobs/run":
            return _job_response(exit_code=1)
        if request.method == "DELETE":
            return httpx.Response(204)
        return httpx.Response(200, json={"job_id": "job-1"})

    _ = _mock_http(monkeypatch, handler)
    backend = EnterpriseExecutionBindingBackend(gateway_endpoint="http://gateway.example", auth_token="secret")

    with pytest.raises(BindingCreateError):
        await backend.create_binding(
            ExecutionBindingCreateSpec(
                tenant_id="tenant-1",
                agent_id="agent-1",
                binding_id="binding-1",
                workspace_id="workspace-1",
                existing_workspace_ref=None,
                home_snapshot_ref=None,
            )
        )

    assert any(request.method == "DELETE" and request.url.path == "/v1/sandboxes/sandbox-1" for request in requests)


@pytest.mark.anyio
async def test_enterprise_home_snapshots_remain_explicitly_not_implemented() -> None:
    snapshots = EnterpriseHomeSnapshotBackend()

    with pytest.raises(NotImplementedError, match="immutable Home Snapshot"):
        _ = await snapshots.create_from_runtime(
            spec=HomeSnapshotCreateSpec(tenant_id="tenant-1", agent_id="agent-1", home_snapshot_id="home-2"),
            source=cast(RuntimeLease, object()),
        )
    with pytest.raises(NotImplementedError, match="immutable Home Snapshot"):
        await snapshots.delete("snapshot-1")
