import base64
import json
import ssl
from pathlib import Path
from unittest.mock import Mock

import httpx
import pytest
from dify_trace_opik.config import OpikConfig
from dify_trace_opik.opik_trace import OpikTraceClient

from core.ops.provider_config import resolve_provider_config
from tests.unit_tests.core.ops.test_provider_export import make_completed_trace


def test_optional_fields_keep_saved_environment_and_file_precedence(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config_file = tmp_path / "opik.ini"
    config_file.write_text("[opik]\napi_key=file-key\nworkspace=file-team\nproject_name=file-project\n")
    monkeypatch.setenv("OPIK_CONFIG_PATH", str(config_file))
    file_client = OpikTraceClient({})
    assert file_client.http.headers == {"Authorization": "file-key", "Comet-Workspace": "file-team"}
    assert file_client.config.project == "file-project"
    for name, value in (("API_KEY", "env-key"), ("WORKSPACE", "env-team"), ("PROJECT_NAME", "env-project")):
        monkeypatch.setenv(f"OPIK_{name}", value)
    env_client = OpikTraceClient({})
    assert env_client.http.headers == {"Authorization": "env-key", "Comet-Workspace": "env-team"}
    assert env_client.config.project == "env-project"
    saved = OpikTraceClient({"api_key": "saved-key", "workspace": "saved-team", "project": ""})
    assert saved.http.headers == {"Authorization": "saved-key", "Comet-Workspace": "saved-team"}
    assert saved.config.project == "Default Project"


def test_captured_credentials_and_destination_survive_environment_changes(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPIK_API_KEY", "first-key")
    monkeypatch.setenv("OPIK_WORKSPACE", "first-team")
    first = resolve_provider_config("opik", {})
    monkeypatch.setenv("OPIK_API_KEY", "second-key")
    monkeypatch.setenv("OPIK_WORKSPACE", "second-team")
    second = resolve_provider_config("opik", {})
    assert first != second
    monkeypatch.setattr(OpikConfig, "load_runtime_settings", Mock(side_effect=AssertionError("snapshot reread")))
    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={})

    monkeypatch.setattr(
        "core.ops.provider_export.ssrf_proxy.create_http_client",
        lambda *, ssl_context: httpx.Client(
            verify=ssl_context, transport=httpx.MockTransport(respond), trust_env=False
        ),
    )
    first_client, second_client = OpikTraceClient(first), OpikTraceClient(second)
    assert first_client.verify_credentials()
    second_client.export_trace(make_completed_trace())
    assert requests[0].headers["Authorization"] == "first-key"
    assert requests[0].headers["Comet-Workspace"] == "first-team"
    assert all(
        request.headers["Authorization"] == "second-key" and request.headers["Comet-Workspace"] == "second-team"
        for request in requests[1:]
    )
    assert first_client.http.headers["Authorization"] == "first-key"


def test_snapshot_does_not_replace_decrypted_saved_api_key() -> None:
    captured = OpikConfig.load_runtime_settings({"api_key": "ciphertext"})
    assert "api_key" not in captured
    assert (
        OpikTraceClient({"api_key": "plaintext", "_runtime_settings": captured}).http.headers["Authorization"]
        == "plaintext"
    )


@pytest.mark.parametrize("ca_setting", ["SSL_CERT_FILE", "SSL_CERT_DIR"])
def test_tls_files_and_verification_are_captured(
    ca_setting: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    certificate = tmp_path / "01234567.0"
    certificate.write_bytes(b"captured CA")
    monkeypatch.setenv(ca_setting, str(certificate if ca_setting == "SSL_CERT_FILE" else tmp_path))
    captured = OpikConfig.load_runtime_settings({})
    if ca_setting == "SSL_CERT_FILE":
        assert base64.b64decode(captured["tls"]["certificate"]) == b"captured CA"
    else:
        assert (
            base64.b64decode(json.loads(captured["tls"]["certificate_directory"])[certificate.name]) == b"captured CA"
        )
    certificate.unlink()
    monkeypatch.setenv("OPIK_CHECK_TLS_CERTIFICATE", "false")
    context = ssl.create_default_context()
    build_context = Mock(return_value=context)
    monkeypatch.setattr("dify_trace_opik.opik_trace.create_ssl_context", build_context)
    client = OpikTraceClient({"_runtime_settings": captured})
    assert client.http.ssl_context is context
    build_context.assert_called_once_with(captured["tls"], verify=True)


def test_opik_config_file_and_environment_disable_tls(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    (tmp_path / ".opik.config").write_text("[opik]\ncheck_tls_certificate=false\n")
    tls = OpikTraceClient({}).http.ssl_context
    assert tls is not None
    assert tls.verify_mode == ssl.CERT_NONE
    monkeypatch.setenv("OPIK_CHECK_TLS_CERTIFICATE", "true")
    tls = OpikTraceClient({}).http.ssl_context
    assert tls is not None
    assert tls.verify_mode == ssl.CERT_REQUIRED
    assert tls.check_hostname is True
    monkeypatch.setenv("OPIK_CHECK_TLS_CERTIFICATE", "invalid")
    with pytest.raises(ValueError):
        OpikTraceClient({})


@pytest.mark.parametrize("remaining", [100, 12])
def test_native_request_timeouts_preserve_each_phase_and_the_export_deadline(
    remaining: float, monkeypatch: pytest.MonkeyPatch
) -> None:
    clock = [100.0]
    monkeypatch.setattr("core.ops.provider_export.monotonic", lambda: clock[0])
    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        clock[0] += 2
        return httpx.Response(200, json={})

    monkeypatch.setattr(
        "core.ops.provider_export.ssrf_proxy.create_http_client",
        lambda *, ssl_context: httpx.Client(
            verify=ssl_context, transport=httpx.MockTransport(respond), trust_env=False
        ),
    )
    client = OpikTraceClient({"api_key": "key", "workspace": "team", "project": "project"})
    clock[0] = 200 - remaining
    assert client.verify_credentials()
    client.export_trace(make_completed_trace())

    assert len(requests) == 3
    for index, request in enumerate(requests):
        budget = remaining - 2 * index
        assert request.extensions["timeout"] == {
            "connect": min(20, budget),
            "read": budget,
            "write": budget,
            "pool": min(20, budget),
        }
    assert client.http.deadline == 200
