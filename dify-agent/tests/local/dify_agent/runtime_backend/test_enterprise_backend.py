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
    HomeSnapshotCreateError,
    HomeSnapshotCreateSpec,
    HomeSnapshotTooLargeError,
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
            assert "test -d /workspace" in script
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
    assert lease.layout.workspace_dir == "/workspace"
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
async def test_enterprise_gateway_errors_carry_the_kratos_reason(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            404,
            json={
                "code": 404,
                "reason": "warm_pool_not_found",
                "message": "sandbox warm pool not found",
                "metadata": {},
            },
        )

    _ = _mock_http(monkeypatch, handler)
    backend = EnterpriseExecutionBindingBackend(gateway_endpoint="http://gateway.example", auth_token="secret")

    with pytest.raises(BindingCreateError) as excinfo:
        _ = await backend.create_binding(
            ExecutionBindingCreateSpec(
                tenant_id="tenant-1",
                agent_id="agent-1",
                binding_id="binding-1",
                workspace_id="workspace-1",
                existing_workspace_ref=None,
                home_snapshot_ref=None,
            )
        )

    assert "warm_pool_not_found" in str(excinfo.value)
    assert "404" in str(excinfo.value)


@pytest.mark.anyio
async def test_enterprise_gateway_errors_survive_a_non_json_body(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(502, text="<html>bad gateway</html>")

    _ = _mock_http(monkeypatch, handler)
    backend = EnterpriseExecutionBindingBackend(gateway_endpoint="http://gateway.example", auth_token="secret")

    with pytest.raises(BindingDestroyError) as excinfo:
        await backend.destroy_binding(
            ExecutionBindingDestroySpec(
                binding_ref="sandbox-1",
                workspace_ref="sandbox-1",
                destroy_workspace=True,
            )
        )

    assert "502" in str(excinfo.value)


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
            assert payload["cwd"] == "/workspace"
            assert "mkdir -p /home/dify" in script
            assert "find /workspace -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +" in script
            return _job_response()
        return httpx.Response(200, json={"job_id": "job-1"})

    clients = _mock_http(monkeypatch, handler)
    backend = EnterpriseExecutionBindingBackend(
        gateway_endpoint="http://gateway.example",
        auth_token="secret",
        gateway_timeout=30,
        snapshot_timeout=120,
    )

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
    assert clients[0].timeout.read == 30


@pytest.mark.anyio
async def test_enterprise_binding_rejects_shared_workspace_before_gateway_call(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requests: list[httpx.Request] = []
    _ = _mock_http(monkeypatch, lambda request: requests.append(request) or httpx.Response(500))
    backend = EnterpriseExecutionBindingBackend(gateway_endpoint="http://gateway.example", auth_token="secret")

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
async def test_enterprise_binding_sends_the_snapshot_ref_and_still_clears_workspace(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    scripts: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/sandboxes":
            assert json.loads(request.content) == {
                "tenantId": "tenant-1",
                "homeSnapshotRef": "tenant-1/agent-1/home-2",
            }
            return httpx.Response(201, json={"sandboxId": "sandbox-1"})
        if request.url.path == "/proxy/v1/jobs/run":
            payload = cast(dict[str, object], json.loads(request.content))
            script = payload["script"]
            assert isinstance(script, str)
            scripts.append(script)
            return _job_response()
        return httpx.Response(200, json={"job_id": "job-1"})

    clients = _mock_http(monkeypatch, handler)
    backend = EnterpriseExecutionBindingBackend(
        gateway_endpoint="http://gateway.example",
        auth_token="secret",
        snapshot_timeout=120,
    )

    allocation = await backend.create_binding(
        ExecutionBindingCreateSpec(
            tenant_id="tenant-1",
            agent_id="agent-1",
            binding_id="binding-1",
            workspace_id="workspace-1",
            existing_workspace_ref=None,
            home_snapshot_ref="tenant-1/agent-1/home-2",
        )
    )

    assert allocation.binding_ref == "sandbox-1"
    assert any("find /workspace -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +" in script for script in scripts)
    assert clients[0].timeout.read == 120


@pytest.mark.anyio
async def test_enterprise_binding_does_not_delete_a_sandbox_it_never_created(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path == "/v1/sandboxes" and request.method == "POST":
            return httpx.Response(
                404,
                json={"code": 404, "reason": "snapshot_not_found", "message": "home snapshot missing"},
            )
        return httpx.Response(204)

    _ = _mock_http(monkeypatch, handler)
    backend = EnterpriseExecutionBindingBackend(gateway_endpoint="http://gateway.example", auth_token="secret")

    with pytest.raises(BindingCreateError, match="snapshot_not_found"):
        await backend.create_binding(
            ExecutionBindingCreateSpec(
                tenant_id="tenant-1",
                agent_id="agent-1",
                binding_id="binding-1",
                workspace_id="workspace-1",
                existing_workspace_ref=None,
                home_snapshot_ref="tenant-1/agent-1/home-2",
            )
        )

    assert not any(request.method == "DELETE" for request in requests)


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
async def test_enterprise_snapshot_create_posts_to_the_lease_sandbox(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path == "/v1/sandboxes/sandbox-1/home-snapshots":
            assert json.loads(request.content) == {
                "tenantId": "tenant-1",
                "agentId": "agent-1",
                "homeSnapshotId": "home-2",
            }
            assert request.headers["X-Inner-Api-Key"] == "secret"
            return httpx.Response(200, json={"snapshotRef": "tenant-1/agent-1/home-2"})
        return _job_response()

    clients = _mock_http(monkeypatch, handler)
    bindings = EnterpriseExecutionBindingBackend(gateway_endpoint="http://gateway.example", auth_token="secret")
    lease = await bindings.acquire("sandbox-1")
    snapshots = EnterpriseHomeSnapshotBackend(
        gateway_endpoint="http://gateway.example",
        auth_token="secret",
        snapshot_timeout=120,
    )

    snapshot_ref = await snapshots.create_from_runtime(
        spec=HomeSnapshotCreateSpec(tenant_id="tenant-1", agent_id="agent-1", home_snapshot_id="home-2"),
        source=lease,
    )

    assert snapshot_ref == "tenant-1/agent-1/home-2"
    assert any(request.url.path == "/v1/sandboxes/sandbox-1/home-snapshots" for request in requests)
    assert clients[-1].timeout.read == 120
    await bindings.release(lease)


@pytest.mark.anyio
async def test_enterprise_snapshot_create_rejects_a_foreign_lease() -> None:
    snapshots = EnterpriseHomeSnapshotBackend(gateway_endpoint="http://gateway.example", auth_token="secret")

    with pytest.raises(HomeSnapshotCreateError):
        _ = await snapshots.create_from_runtime(
            spec=HomeSnapshotCreateSpec(tenant_id="tenant-1", agent_id="agent-1", home_snapshot_id="home-2"),
            source=cast(RuntimeLease, object()),
        )


@pytest.mark.anyio
async def test_enterprise_snapshot_create_maps_the_size_limit_to_too_large(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/home-snapshots"):
            return httpx.Response(
                413,
                json={
                    "code": 413,
                    "reason": "snapshot_size_exceeded",
                    "message": "home snapshot exceeds the configured limit of 67108864 bytes",
                },
            )
        return _job_response()

    _ = _mock_http(monkeypatch, handler)
    bindings = EnterpriseExecutionBindingBackend(gateway_endpoint="http://gateway.example", auth_token="secret")
    lease = await bindings.acquire("sandbox-1")
    snapshots = EnterpriseHomeSnapshotBackend(gateway_endpoint="http://gateway.example", auth_token="secret")

    with pytest.raises(HomeSnapshotTooLargeError, match="exceeds the configured limit"):
        _ = await snapshots.create_from_runtime(
            spec=HomeSnapshotCreateSpec(tenant_id="tenant-1", agent_id="agent-1", home_snapshot_id="home-2"),
            source=lease,
        )
    await bindings.release(lease)


@pytest.mark.anyio
async def test_enterprise_snapshot_create_maps_other_gateway_failures(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/home-snapshots"):
            return httpx.Response(
                500,
                json={
                    "code": 500,
                    "reason": "snapshot_save_failed",
                    "message": "home snapshot save failed: object store unavailable",
                },
            )
        return _job_response()

    _ = _mock_http(monkeypatch, handler)
    bindings = EnterpriseExecutionBindingBackend(gateway_endpoint="http://gateway.example", auth_token="secret")
    lease = await bindings.acquire("sandbox-1")
    snapshots = EnterpriseHomeSnapshotBackend(gateway_endpoint="http://gateway.example", auth_token="secret")

    with pytest.raises(HomeSnapshotCreateError, match="snapshot_save_failed"):
        _ = await snapshots.create_from_runtime(
            spec=HomeSnapshotCreateSpec(tenant_id="tenant-1", agent_id="agent-1", home_snapshot_id="home-2"),
            source=lease,
        )
    await bindings.release(lease)


@pytest.mark.anyio
async def test_enterprise_snapshot_create_rejects_a_reply_without_a_ref(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/home-snapshots"):
            return httpx.Response(200, json={"snapshotRef": ""})
        return _job_response()

    _ = _mock_http(monkeypatch, handler)
    bindings = EnterpriseExecutionBindingBackend(gateway_endpoint="http://gateway.example", auth_token="secret")
    lease = await bindings.acquire("sandbox-1")
    snapshots = EnterpriseHomeSnapshotBackend(gateway_endpoint="http://gateway.example", auth_token="secret")

    with pytest.raises(HomeSnapshotCreateError, match="invalid snapshot ref"):
        _ = await snapshots.create_from_runtime(
            spec=HomeSnapshotCreateSpec(tenant_id="tenant-1", agent_id="agent-1", home_snapshot_id="home-2"),
            source=lease,
        )
    await bindings.release(lease)


@pytest.mark.anyio
async def test_enterprise_snapshot_delete_keeps_ref_slashes_and_escapes_the_rest(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={})

    _ = _mock_http(monkeypatch, handler)
    snapshots = EnterpriseHomeSnapshotBackend(gateway_endpoint="http://gateway.example", auth_token="secret")

    await snapshots.delete("tenant-1/agent-1/home-2")
    await snapshots.delete("tenant-1/agent-1/home 2?x=1")

    assert [request.method for request in requests] == ["DELETE", "DELETE"]
    assert requests[0].url.raw_path == b"/v1/home-snapshots/tenant-1/agent-1/home-2"
    assert requests[1].url.raw_path == b"/v1/home-snapshots/tenant-1/agent-1/home%202%3Fx%3D1"
    assert requests[0].headers["X-Inner-Api-Key"] == "secret"


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("status_code", "reason", "message"),
    [
        (404, "route_not_found", "no matching route"),
        (500, "snapshot_delete_failed", "object store unreachable"),
    ],
)
async def test_enterprise_snapshot_delete_propagates_gateway_failures(
    monkeypatch: pytest.MonkeyPatch,
    status_code: int,
    reason: str,
    message: str,
) -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(status_code, json={"code": status_code, "reason": reason, "message": message})

    _ = _mock_http(monkeypatch, handler)
    snapshots = EnterpriseHomeSnapshotBackend(gateway_endpoint="http://gateway.example", auth_token="secret")

    with pytest.raises(BindingDestroyError, match=reason):
        await snapshots.delete("tenant-1/agent-1/home-2")
