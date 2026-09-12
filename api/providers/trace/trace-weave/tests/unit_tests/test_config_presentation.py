from unittest.mock import Mock, patch

import httpx
import pytest

from services.app_tracing_config_gateway import TraceProviderConfigChecks
from services.app_tracing_config_service import AppTracingConfigVerificationFailedError


@pytest.mark.parametrize("host", [None, "https://wandb.example/prefix"])
@pytest.mark.parametrize(
    ("response", "project_path", "write_rejected"),
    [
        (httpx.Response(401), None, True),
        (httpx.Response(503), None, True),
        (httpx.ConnectError("provider unavailable"), None, True),
        (httpx.Response(200, text="invalid json"), None, True),
        (httpx.Response(200, json={"data": None}), None, True),
        (httpx.Response(200, json={"data": {"viewer": None}}), None, True),
        (
            httpx.Response(200, json={"data": {"viewer": {"defaultEntity": {"name": "team"}}}}),
            "/team/project/weave",
            False,
        ),
    ],
)
def test_saved_config_stays_readable_when_project_discovery_fails(
    monkeypatch: pytest.MonkeyPatch,
    response: httpx.Response | httpx.RequestError,
    project_path: str | None,
    write_rejected: bool,
    host: str | None,
) -> None:
    settings = {
        "api_key": "secret",
        "project": "project",
        "endpoint": "https://trace.wandb.ai",
        "host": host,
        "entity": None,
    }
    encrypted = {**settings, "api_key": "cipher-secret"}
    request = Mock(side_effect=response) if isinstance(response, Exception) else Mock(return_value=response)
    monkeypatch.setattr("core.ops.provider_export.ssrf_proxy.make_request", request)
    checks = TraceProviderConfigChecks()
    with patch("core.helper.encrypter.batch_decrypt_token", return_value=["secret"]) as decrypt:
        presented = checks.present_config(workspace_id="tenant-a", tracing_provider="weave", tracing_config=encrypted)
    decrypt.assert_called_once_with("tenant-a", ["cipher-secret"])
    assert presented == {
        **settings,
        "api_key": "*" * 20,
        "project_url": f"{host or 'https://wandb.ai'}{project_path or '/'}",
    }
    assert encrypted["api_key"] == "cipher-secret"
    if write_rejected:
        with patch("core.helper.encrypter.encrypt_token") as encrypt:
            with pytest.raises(AppTracingConfigVerificationFailedError):
                checks.prepare_new_config(workspace_id="tenant-a", tracing_provider="weave", tracing_config=settings)
        encrypt.assert_not_called()
        assert request.call_count == 2
    else:
        request.assert_called_once()
