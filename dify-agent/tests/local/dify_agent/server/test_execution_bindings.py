from dataclasses import dataclass, field

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from dify_agent.protocol import CreateExecutionBindingRequest, DestroyExecutionBindingRequest
from dify_agent.runtime_backend import (
    BindingCapacityExhaustedError,
    ExecutionBindingAllocation,
    ExecutionBindingCreateSpec,
    ExecutionBindingDestroySpec,
)
from dify_agent.server.execution_bindings import ExecutionBindingService
from dify_agent.server.routes.execution_bindings import create_execution_bindings_router


@dataclass(slots=True)
class _Backend:
    created: list[ExecutionBindingCreateSpec] = field(default_factory=list)
    destroyed: list[ExecutionBindingDestroySpec] = field(default_factory=list)
    create_error: Exception | None = None

    async def create_binding(self, spec: ExecutionBindingCreateSpec) -> ExecutionBindingAllocation:
        self.created.append(spec)
        if self.create_error is not None:
            raise self.create_error
        return ExecutionBindingAllocation(binding_ref="opaque-binding", workspace_ref="opaque-workspace")

    async def destroy_binding(self, spec: ExecutionBindingDestroySpec) -> None:
        self.destroyed.append(spec)


@pytest.mark.anyio
async def test_execution_binding_service_forwards_final_contract() -> None:
    backend = _Backend()
    service = ExecutionBindingService(backend=backend)  # pyright: ignore[reportArgumentType]

    response = await service.create_binding(
        CreateExecutionBindingRequest(
            tenant_id="tenant-1",
            agent_id="agent-1",
            binding_id="binding-1",
            workspace_id="workspace-1",
            existing_workspace_ref=None,
            home_snapshot_ref="home-ref",
        )
    )
    await service.destroy_binding(
        DestroyExecutionBindingRequest(
            binding_ref=response.binding_ref,
            workspace_ref=response.workspace_ref,
            destroy_workspace=True,
        )
    )

    assert backend.created == [
        ExecutionBindingCreateSpec(
            tenant_id="tenant-1",
            agent_id="agent-1",
            binding_id="binding-1",
            workspace_id="workspace-1",
            existing_workspace_ref=None,
            home_snapshot_ref="home-ref",
        )
    ]
    assert backend.destroyed == [
        ExecutionBindingDestroySpec(
            binding_ref="opaque-binding",
            workspace_ref="opaque-workspace",
            destroy_workspace=True,
        )
    ]


def test_execution_binding_route_reports_capacity_exhaustion_as_429() -> None:
    backend = _Backend(create_error=BindingCapacityExhaustedError("maximum concurrent sandboxes reached"))
    service = ExecutionBindingService(backend=backend)  # pyright: ignore[reportArgumentType]
    app = FastAPI()
    app.include_router(create_execution_bindings_router(lambda: service))

    with TestClient(app) as client:
        response = client.post(
            "/execution-bindings",
            json={
                "tenant_id": "tenant-1",
                "agent_id": "agent-1",
                "binding_id": "binding-1",
                "workspace_id": "workspace-1",
                "existing_workspace_ref": None,
                "home_snapshot_ref": None,
            },
        )

    assert response.status_code == 429
    assert response.json() == {
        "detail": {
            "code": "binding_capacity_exhausted",
            "message": "maximum concurrent sandboxes reached",
        }
    }
    assert len(backend.created) == 1


@pytest.mark.anyio
async def test_keep_alive_unsupported_backend_returns_false_without_operations() -> None:
    from dify_agent import protocol

    backend = _Backend()
    service = ExecutionBindingService(backend=backend)
    response = await service.keep_alive(protocol.KeepAliveExecutionBindingRequest(binding_ref="binding"))
    assert response.supported is False
    assert backend.created == []
    assert backend.destroyed == []


@pytest.mark.parametrize("status_code", [200, 404, 401, 500, 503])
def test_keep_alive_sdk_route_actual_health_wire_is_fixed_and_private(
    monkeypatch: pytest.MonkeyPatch, status_code: int
) -> None:
    import httpx2
    from dify_agent import protocol
    from dify_agent.client import Client, DifyAgentHTTPError
    from dify_agent.runtime_backend.enterprise import EnterpriseExecutionBindingBackend
    from dify_agent.server.auth import create_bearer_token_dependency
    from dify_agent.server.routes.execution_bindings import create_execution_binding_keep_alive_router

    requests: list[httpx2.Request] = []

    def gateway(request: httpx2.Request) -> httpx2.Response:
        requests.append(request)
        assert request.method == "GET" and request.url.path == "/proxy/healthz"
        assert request.headers["X-Sandbox-Id"] == "PRIVATE_BINDING"
        assert request.headers["X-Inner-Api-Key"] == "PRIVATE_CREDENTIAL"
        if status_code == 200:
            return httpx2.Response(200, json={"status": "ok"})
        return httpx2.Response(
            status_code,
            json={
                "error": {
                    "code": "sandbox_expired" if status_code == 404 else "upstream",
                    "message": "PRIVATE_PROVIDER_TEXT",
                }
            },
        )

    transport = httpx2.MockTransport(gateway)
    monkeypatch.setattr(httpx2, "AsyncHTTPTransport", lambda **_kwargs: transport)
    service = ExecutionBindingService(
        backend=EnterpriseExecutionBindingBackend(gateway_endpoint="http://gateway", auth_token="PRIVATE_CREDENTIAL")
    )
    app = FastAPI()
    app.include_router(
        create_execution_binding_keep_alive_router(lambda: service),
        dependencies=[create_bearer_token_dependency("control-secret")],
    )
    with TestClient(app) as http:
        client = Client(
            base_url="http://testserver", headers={"Authorization": "Bearer control-secret"}, sync_http_client=http
        )
        request = protocol.KeepAliveExecutionBindingRequest(binding_ref="PRIVATE_BINDING")
        if status_code == 200:
            assert client.keep_alive_execution_binding_sync(request).supported is True
        else:
            with pytest.raises(DifyAgentHTTPError) as raised:
                client.keep_alive_execution_binding_sync(request)
            expected_status = 410 if status_code == 404 else 502
            assert raised.value.status_code == expected_status
            text = str(raised.value)
            for secret in ("PRIVATE_BINDING", "PRIVATE_CREDENTIAL", "PRIVATE_PROVIDER_TEXT"):
                assert secret not in text
            assert "binding_lost" in text if status_code == 404 else "binding_keep_alive_failed" in text
    assert len(requests) == 1


@pytest.mark.parametrize("payload", [{"binding_ref": ""}, {"binding_ref": "binding", "credential": "PRIVATE_INPUT"}])
def test_keep_alive_validation_does_not_echo_private_input(payload: dict[str, str]) -> None:
    from dify_agent.server.routes.execution_bindings import create_execution_binding_keep_alive_router

    app = FastAPI()
    app.include_router(create_execution_binding_keep_alive_router(lambda: None))
    with TestClient(app) as client:
        response = client.post("/execution-bindings/keep-alive", json=payload)
    assert response.status_code == 422
    assert response.json() == {"detail": {"code": "invalid_keep_alive_request", "message": "invalid binding selection"}}
    assert "PRIVATE_INPUT" not in response.text


@pytest.mark.anyio
@pytest.mark.parametrize("backend_name", ["local", "e2b", "openshell"])
async def test_keep_alive_real_unsupported_backends_never_open_transport(
    monkeypatch: pytest.MonkeyPatch, backend_name: str
) -> None:
    import httpx2
    from dify_agent import protocol
    from dify_agent.runtime_backend.e2b import E2BExecutionBindingBackend, E2BSDKControlPlane
    from dify_agent.runtime_backend.local import LocalExecutionBindingBackend
    from dify_agent.runtime_backend.openshell import OpenShellExecutionBindingBackend, OpenShellSDKControlPlane

    def forbidden_transport(**_kwargs):
        pytest.fail("Unsupported backend must not perform health or other I/O")

    monkeypatch.setattr(httpx2, "AsyncHTTPTransport", forbidden_transport)
    backends = {
        "local": LocalExecutionBindingBackend(endpoint="http://unused", auth_token="synthetic"),
        "e2b": E2BExecutionBindingBackend(
            control_plane=E2BSDKControlPlane(api_key="synthetic"), template="unused", active_timeout_seconds=300
        ),
        "openshell": OpenShellExecutionBindingBackend(control_plane=OpenShellSDKControlPlane(endpoint="unused")),
    }
    response = await ExecutionBindingService(backend=backends[backend_name]).keep_alive(
        protocol.KeepAliveExecutionBindingRequest(binding_ref="binding")
    )
    assert response.supported is False
