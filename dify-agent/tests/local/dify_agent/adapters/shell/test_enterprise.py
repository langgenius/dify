from unittest.mock import patch

import httpx2
import pytest

from dify_agent.adapters.shell.enterprise import EnterpriseShellProvider


@pytest.mark.anyio
async def test_attach_uses_shellctl_compatible_http_client(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(request: httpx2.Request) -> httpx2.Response:
        assert request.url.path == "/proxy/v1/jobs/run"
        assert request.headers["X-Sandbox-Id"] == "sandbox-1"
        return httpx2.Response(
            200,
            json={
                "job_id": "job-1",
                "done": True,
                "status": "exited",
                "exit_code": 0,
                "output_path": "/tmp/output.log",
                "output": "",
                "offset": 0,
                "truncated": False,
            },
        )

    transport = httpx2.MockTransport(handler)
    monkeypatch.setattr(httpx2, "AsyncHTTPTransport", lambda **kwargs: transport)
    with patch.object(httpx2, "AsyncClient", wraps=httpx2.AsyncClient) as async_client:
        provider = EnterpriseShellProvider(
            gateway_endpoint="http://gateway.example",
            auth_token="secret",
            proxy_timeout=90,
        )

        resource = await provider.attach("sandbox-1")

    timeout = async_client.call_args.kwargs["timeout"]
    assert isinstance(timeout, httpx2.Timeout)
    assert timeout.read == 90
    await resource.suspend()
