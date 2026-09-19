"""TLS outcomes recorded from MLflow 3.11.1 / Databricks SDK 0.73 native calls."""

import ssl
from pathlib import Path

import httpx
import pytest
from dify_trace_mlflow.mlflow_trace import MLflowTraceClient

from core.ops.provider_config import resolve_provider_config


@pytest.mark.parametrize("sdk", ["false", "0", "true", "1"])
@pytest.mark.parametrize("insecure", [None, "", "true", "false", "0", "invalid"])
def test_legacy_insecure_truthiness_is_captured_and_signed_uploads_stay_verified(
    sdk: str, insecure: str | None, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("MLFLOW_ENABLE_DB_SDK", sdk)
    if insecure is not None:
        monkeypatch.setenv("DATABRICKS_INSECURE", insecure)
    snapshot = resolve_provider_config(
        "databricks", {"host": "https://workspace.example", "personal_access_token": "tenant", "experiment_id": "1"}
    )
    monkeypatch.setenv("MLFLOW_ENABLE_DB_SDK", "false")
    monkeypatch.setenv("DATABRICKS_INSECURE", "worker-rotation")
    contexts: list[ssl.SSLContext] = []

    def create_http_client(*, ssl_context: ssl.SSLContext) -> httpx.Client:
        contexts.append(ssl_context)
        return httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(200)), trust_env=False)

    monkeypatch.setattr("core.ops.provider_export.ssrf_proxy.create_http_client", create_http_client)
    client = MLflowTraceClient("databricks", snapshot)
    client.verify_credentials()
    client._upload_spans({"signed_uri": "https://storage.example/upload"}, b"{}")
    verify = sdk in {"true", "1"} or not insecure
    assert contexts[0].verify_mode == (ssl.CERT_REQUIRED if verify else ssl.CERT_NONE)
    assert contexts[0].check_hostname is verify
    assert contexts[1].verify_mode == ssl.CERT_REQUIRED
    assert contexts[1].check_hostname is True


@pytest.mark.parametrize("profile_insecure", ["", "false", "true"])
def test_named_profile_tls_precedes_environment_and_does_not_inherit_default(
    profile_insecure: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    profile = tmp_path / "databrickscfg"
    profile.write_text(
        "[DEFAULT]\nhost=https://default.example\ntoken=default\ninsecure=true\n"
        "[selected]\nhost=https://workspace.example\ntoken=selected\n"
        + (f"insecure={profile_insecure}\n" if profile_insecure else "")
    )
    monkeypatch.setenv("DATABRICKS_CONFIG_FILE", str(profile))
    monkeypatch.setenv("DATABRICKS_CONFIG_PROFILE", "selected")
    monkeypatch.setenv("DATABRICKS_INSECURE", "true")
    monkeypatch.setenv("MLFLOW_ENABLE_DB_SDK", "false")
    snapshot = resolve_provider_config(
        "databricks", {"host": "https://workspace.example", "personal_access_token": "tenant", "experiment_id": "1"}
    )
    profile.unlink()
    client = MLflowTraceClient("databricks", snapshot)
    assert client.http.ssl_context is not None
    assert client.http.ssl_context.verify_mode == (ssl.CERT_NONE if profile_insecure else ssl.CERT_REQUIRED)


def test_insecure_tracking_ignores_missing_ca_but_signed_upload_requires_it(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MLFLOW_ENABLE_DB_SDK", "false")
    monkeypatch.setenv("DATABRICKS_INSECURE", "true")
    monkeypatch.setenv("REQUESTS_CA_BUNDLE", "/missing/databricks-ca.pem")
    snapshot = resolve_provider_config(
        "databricks", {"host": "https://workspace.example", "personal_access_token": "tenant", "experiment_id": "1"}
    )
    monkeypatch.setattr("core.ops.provider_export.ssrf_proxy.make_request", lambda *args, **kwargs: httpx.Response(200))
    client = MLflowTraceClient("databricks", snapshot)
    assert client.verify_credentials()
    with pytest.raises(ValueError, match="TLS"):
        client._upload_spans({"signed_uri": "https://storage.example/upload"}, b"{}")
