from unittest.mock import Mock, patch

import httpx
import pytest
from dify_trace_langsmith.langsmith_trace import LangSmithTraceClient

from services.app_tracing_config_gateway import TraceProviderConfigChecks
from services.app_tracing_config_service import AppTracingConfigVerificationFailedError


@pytest.mark.parametrize(
    ("response", "project_path", "write_rejected"),
    [
        (httpx.Response(401), None, True),
        (httpx.Response(503), None, True),
        (httpx.ConnectError("provider unavailable"), None, True),
        (httpx.Response(200, text="invalid json"), None, False),
        (httpx.Response(200, json=[None]), None, False),
        (httpx.Response(200, json=[]), None, False),
        (
            httpx.Response(200, json=[{"id": "project-id", "tenant_id": "tenant-id"}]),
            "/o/tenant-id/projects/p/project-id",
            False,
        ),
    ],
)
def test_saved_config_stays_readable_when_project_discovery_fails(
    monkeypatch: pytest.MonkeyPatch,
    response: httpx.Response | httpx.RequestError,
    project_path: str | None,
    write_rejected: bool,
) -> None:
    settings = {"api_key": "secret", "project": "project", "endpoint": "https://langsmith.example/prefix"}
    encrypted = {**settings, "api_key": "cipher-secret"}
    request = Mock(side_effect=response) if isinstance(response, Exception) else Mock(return_value=response)
    monkeypatch.setattr("core.ops.provider_export.ssrf_proxy.make_request", request)
    checks = TraceProviderConfigChecks()
    with patch("core.helper.encrypter.batch_decrypt_token", return_value=["secret"]) as decrypt:
        presented = checks.present_config(
            workspace_id="tenant-a", tracing_provider="langsmith", tracing_config=encrypted
        )
    decrypt.assert_called_once_with("tenant-a", ["cipher-secret"])
    assert presented == {
        **settings,
        "api_key": "*" * 20,
        "project_url": f"https://smith.langchain.com{project_path or '/'}",
    }
    assert encrypted["api_key"] == "cipher-secret"
    if write_rejected:
        with patch("core.helper.encrypter.encrypt_token") as encrypt:
            with pytest.raises(AppTracingConfigVerificationFailedError):
                checks.prepare_new_config(
                    workspace_id="tenant-a", tracing_provider="langsmith", tracing_config=settings
                )
        encrypt.assert_not_called()
        assert request.call_count == 2
    else:
        request.assert_called_once()


@pytest.mark.parametrize(
    ("endpoint", "web_url"),
    [
        ("https://api.smith.langchain.com", "https://smith.langchain.com"),
        ("https://eu.api.smith.langchain.com", "https://eu.smith.langchain.com"),
        ("https://aws.api.smith.langchain.com", "https://aws.smith.langchain.com"),
        ("https://apac.api.smith.langchain.com", "https://apac.smith.langchain.com"),
        ("https://dev.api.smith.langchain.com", "https://dev.smith.langchain.com"),
        ("https://beta.api.smith.langchain.com", "https://beta.smith.langchain.com"),
        ("https://langsmith.example/api", "https://langsmith.example"),
        ("https://langsmith.example/prefix/api", "https://langsmith.example/prefix"),
        ("https://langsmith.example/prefix/api/v1", "https://langsmith.example/prefix"),
    ],
)
def test_project_url_uses_endpoint_web_host(endpoint: str, web_url: str, monkeypatch: pytest.MonkeyPatch) -> None:
    client = LangSmithTraceClient({"api_key": "secret", "project": "project", "endpoint": endpoint})
    request = Mock(return_value=httpx.Response(200, json=[{"id": "project-id", "tenant_id": "tenant-id"}]))
    monkeypatch.setattr("core.ops.provider_export.ssrf_proxy.make_request", request)

    assert client.get_project_url() == f"{web_url}/o/tenant-id/projects/p/project-id"
    assert request.call_args.args == ("GET", f"{endpoint}/sessions")
