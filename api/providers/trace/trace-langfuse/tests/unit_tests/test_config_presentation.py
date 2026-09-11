from unittest.mock import Mock, patch

import httpx
import pytest

from services.app_tracing_config_gateway import TraceProviderConfigChecks
from services.app_tracing_config_service import AppTracingConfigVerificationFailedError


@pytest.mark.parametrize(
    ("response", "project_path", "write_rejected"),
    [
        (httpx.Response(401), None, True),
        (httpx.Response(503), None, True),
        (httpx.ConnectError("provider unavailable"), None, True),
        (httpx.Response(200, text="invalid json"), None, False),
        (httpx.Response(200, json={"data": [{}]}), None, False),
        (httpx.Response(200, json={"data": []}), None, False),
        (httpx.Response(200, json={"data": [{"id": "project-id"}]}), "/project/project-id", False),
    ],
)
def test_saved_config_stays_readable_when_project_discovery_fails(
    monkeypatch: pytest.MonkeyPatch,
    response: httpx.Response | httpx.RequestError,
    project_path: str | None,
    write_rejected: bool,
) -> None:
    settings = {"public_key": "public", "secret_key": "secret", "host": "https://langfuse.example/prefix"}
    encrypted = {"public_key": "cipher-public", "secret_key": "cipher-secret", "host": settings["host"]}
    request = Mock(side_effect=response) if isinstance(response, Exception) else Mock(return_value=response)
    monkeypatch.setattr("core.ops.provider_export.ssrf_proxy.make_request", request)
    checks = TraceProviderConfigChecks()
    with patch("core.helper.encrypter.batch_decrypt_token", return_value=["public", "secret"]) as decrypt:
        presented = checks.present_config(
            workspace_id="tenant-a", tracing_provider="langfuse", tracing_config=encrypted
        )
    decrypt.assert_called_once_with("tenant-a", ["cipher-public", "cipher-secret"])
    assert presented == {
        "public_key": "*" * 20,
        "secret_key": "*" * 20,
        "host": settings["host"],
        "project_url": f"{settings['host']}{project_path or '/'}",
    }
    assert encrypted["secret_key"] == "cipher-secret"
    if write_rejected:
        with patch("core.helper.encrypter.encrypt_token") as encrypt:
            with pytest.raises(AppTracingConfigVerificationFailedError):
                checks.prepare_new_config(workspace_id="tenant-a", tracing_provider="langfuse", tracing_config=settings)
        encrypt.assert_not_called()
        assert request.call_count == 2
    else:
        request.assert_called_once()
