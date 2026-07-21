import httpx2
import pytest

from dify_agent.runtime_backend import SandboxCreateSpec
from dify_agent.runtime_backend.enterprise import EnterpriseSandboxDriver


class _TrackingTransport(httpx2.MockTransport):
    close_calls: int

    def __init__(self, handler) -> None:
        super().__init__(handler)
        self.close_calls = 0

    async def aclose(self) -> None:
        self.close_calls += 1
        await super().aclose()


@pytest.mark.anyio
async def test_public_lifecycle_uses_configured_proxy_timeout_and_closes_transports(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requests: list[tuple[str, str]] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        requests.append((request.method, request.url.path))
        if request.url.path == "/v1/sandboxes" and request.method == "POST":
            assert request.headers["X-Inner-Api-Key"] == "secret"
            return httpx2.Response(201, json={"sandboxId": "sandbox-1"})
        if request.url.path == "/proxy/v1/jobs/run" and request.method == "POST":
            assert request.headers["X-Sandbox-Id"] == "sandbox-1"
            return httpx2.Response(
                200,
                json={
                    "job_id": "workspace-probe",
                    "done": True,
                    "status": "exited",
                    "exit_code": 0,
                    "output_path": "/tmp/output.log",
                    "output": "",
                    "offset": 0,
                    "truncated": False,
                },
            )
        if request.url.path == "/proxy/v1/jobs/workspace-probe" and request.method == "DELETE":
            return httpx2.Response(200, json={"job_id": "workspace-probe", "deleted": True})
        raise AssertionError(f"unexpected request: {request.method} {request.url}")

    clients: list[tuple[str, httpx2.Timeout, _TrackingTransport]] = []
    async_client_type = httpx2.AsyncClient

    def async_client_factory(
        *,
        base_url: str,
        headers: dict[str, str],
        timeout: httpx2.Timeout,
        follow_redirects: bool = False,
        transport: httpx2.AsyncBaseTransport | None = None,
    ) -> httpx2.AsyncClient:
        del transport
        tracking_transport = _TrackingTransport(handler)
        clients.append((base_url, timeout, tracking_transport))
        return async_client_type(
            base_url=base_url,
            headers=headers,
            timeout=timeout,
            follow_redirects=follow_redirects,
            transport=tracking_transport,
        )

    monkeypatch.setattr("dify_agent.runtime_backend.enterprise.httpx.AsyncClient", async_client_factory)
    driver = EnterpriseSandboxDriver(
        gateway_endpoint="http://gateway.example",
        auth_token="secret",
        proxy_timeout=90,
    )
    created = await driver.create(
        SandboxCreateSpec(
            tenant_id="tenant-1",
            agent_id="agent-1",
            agent_config_version_id="config-1",
            runtime_session_id="session-1",
            home_snapshot_ref="home-1",
        )
    )
    await driver.suspend(created)
    resumed = await driver.resume(created.handle)
    await driver.suspend(resumed)

    assert created.handle == "sandbox-1"
    assert resumed.handle == created.handle
    proxy_timeouts = [timeout for base_url, timeout, _transport in clients if base_url.endswith("/proxy/")]
    assert len(proxy_timeouts) == 2
    assert all(timeout.read == 90 for timeout in proxy_timeouts)
    assert ("POST", "/v1/sandboxes") in requests
    assert ("POST", "/proxy/v1/jobs/run") in requests
    assert ("DELETE", "/proxy/v1/jobs/workspace-probe") in requests
    assert all(transport.close_calls == 1 for _base_url, _timeout, transport in clients)
