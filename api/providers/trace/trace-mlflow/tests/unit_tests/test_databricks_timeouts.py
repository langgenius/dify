"""Timeout contracts from MLflow 3.11.1 and Databricks SDK 0.73.0 native request paths."""

from pathlib import Path
from typing import Any
from unittest.mock import Mock

import httpx
import pytest
from dify_trace_mlflow.config import DatabricksConfig
from dify_trace_mlflow.mlflow_trace import MLflowTraceClient

from configs import dify_config
from core.ops.provider_config import provider_config_identity, resolve_provider_config
from core.ops.provider_export import TraceExportError
from core.ops.trace_source import _settings_hash
from tests.unit_tests.core.ops.test_provider_export import make_completed_trace


@pytest.mark.parametrize(
    ("sdk", "http_timeout", "expected"),
    [
        (None, None, 60),
        ("true", "80", 60),
        ("1", "invalid", 60),
        ("false", None, 120),
        ("0", "80", 80),
        ("false", "7", 7),
    ],
)
def test_workspace_timeout_uses_native_mode_precedence(
    sdk: str | None, http_timeout: str | None, expected: int, monkeypatch: pytest.MonkeyPatch
) -> None:
    if sdk is not None:
        monkeypatch.setenv("MLFLOW_ENABLE_DB_SDK", sdk)
    if http_timeout is not None:
        monkeypatch.setenv("MLFLOW_HTTP_REQUEST_TIMEOUT", http_timeout)
    # The native SDK has no environment variable for http_timeout_seconds.
    monkeypatch.setenv("DATABRICKS_HTTP_TIMEOUT_SECONDS", "1")
    settings = DatabricksConfig.load_runtime_settings({})
    assert settings["request_timeout"] == expected


@pytest.mark.parametrize(
    ("sdk", "profile", "profile_timeout", "expected"),
    [
        ("true", None, "12.5", 60),
        ("true", "DEFAULT", "12.5", 95),
        ("true", "selected", "12.5", 12.5),
        ("true", "selected", "0", 60),
        ("true", "selected", None, 60),
        ("false", "selected", "invalid", 80),
    ],
)
def test_selected_profile_timeout_is_captured_without_default_inheritance(
    sdk: str,
    profile: str | None,
    profile_timeout: str | None,
    expected: float,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    profile_file = tmp_path / "databrickscfg"
    profile_file.write_text(
        "[DEFAULT]\nhttp_timeout_seconds=95\n[selected]\n"
        + (f"http_timeout_seconds={profile_timeout}\n" if profile_timeout is not None else "")
    )
    monkeypatch.setenv("DATABRICKS_CONFIG_FILE", str(profile_file))
    if profile is not None:
        monkeypatch.setenv("DATABRICKS_CONFIG_PROFILE", profile)
    monkeypatch.setenv("MLFLOW_ENABLE_DB_SDK", sdk)
    monkeypatch.setenv("MLFLOW_HTTP_REQUEST_TIMEOUT", "80")
    snapshot = resolve_provider_config("databricks", {"host": "https://workspace.example", "experiment_id": "1"})
    profile_file.unlink()
    monkeypatch.setattr(DatabricksConfig, "load_runtime_settings", Mock(side_effect=AssertionError("Snapshot reread")))
    assert MLflowTraceClient("databricks", snapshot).http.request_timeout == expected


@pytest.mark.parametrize("sdk", ["true", "false"])
def test_only_sdk_mode_expands_the_configured_profile_path(
    sdk: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.chdir(tmp_path)
    literal_directory = tmp_path / "~"
    literal_directory.mkdir()
    (literal_directory / "databrickscfg").write_text("[selected]\ninsecure=true\nhttp_timeout_seconds=42\n")
    expanded_file = tmp_path / "databrickscfg"
    expanded_file.write_text("[selected]\ninsecure=\nhttp_timeout_seconds=17\n")
    monkeypatch.setattr(Path, "expanduser", lambda path: expanded_file)
    monkeypatch.setenv("DATABRICKS_CONFIG_FILE", "~/databrickscfg")
    monkeypatch.setenv("DATABRICKS_CONFIG_PROFILE", "selected")
    monkeypatch.setenv("MLFLOW_ENABLE_DB_SDK", sdk)
    monkeypatch.setenv("MLFLOW_HTTP_REQUEST_TIMEOUT", "80")
    settings = DatabricksConfig.load_runtime_settings({})
    assert settings["verify"] is (sdk == "true")
    assert settings["request_timeout"] == (17 if sdk == "true" else 80)


@pytest.mark.parametrize("sdk", ["true", "false"])
def test_only_sdk_mode_uses_the_default_for_an_empty_profile_path(
    sdk: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    (tmp_path / ".databrickscfg").write_text("[selected]\ninsecure=true\nhttp_timeout_seconds=23\n")
    monkeypatch.setenv("DATABRICKS_CONFIG_FILE", "")
    monkeypatch.setenv("DATABRICKS_CONFIG_PROFILE", "selected")
    monkeypatch.setenv("MLFLOW_ENABLE_DB_SDK", sdk)
    monkeypatch.setenv("MLFLOW_HTTP_REQUEST_TIMEOUT", "80")
    settings = DatabricksConfig.load_runtime_settings({})
    assert settings["verify"] is True
    assert settings["request_timeout"] == (23 if sdk == "true" else 80)


@pytest.mark.parametrize("sdk", ["true", "false"])
def test_effective_timeout_participates_in_destination_fingerprint(
    sdk: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(dify_config, "SECRET_KEY", "timeout-test-key")
    monkeypatch.setenv("MLFLOW_ENABLE_DB_SDK", sdk)
    saved = {"host": "https://workspace.example", "experiment_id": "1"}
    first = resolve_provider_config("databricks", saved)
    monkeypatch.setenv("MLFLOW_HTTP_REQUEST_TIMEOUT", "80")
    second = resolve_provider_config("databricks", saved)
    first_hash = _settings_hash("tenant", provider_config_identity("databricks", first))
    second_hash = _settings_hash("tenant", provider_config_identity("databricks", second))
    assert (first_hash == second_hash) is (sdk == "true")
    profile_file = tmp_path / ".databrickscfg"
    profile_file.write_text("[selected]\nhttp_timeout_seconds=15\n")
    monkeypatch.setenv("DATABRICKS_CONFIG_PROFILE", "selected")
    third = resolve_provider_config("databricks", saved)
    third_hash = _settings_hash("tenant", provider_config_identity("databricks", third))
    assert (second_hash == third_hash) is (sdk == "false")


@pytest.mark.parametrize(("sdk", "http_timeout", "expected"), [("true", "7", 60), ("false", "80", 80)])
@pytest.mark.parametrize("oauth", [False, True])
@pytest.mark.parametrize("upload_type", ["AWS_PRESIGNED_URL", "AZURE_SAS_URI", "AZURE_ADLS_GEN2_SAS_URI"])
def test_owned_timeout_reaches_authentication_export_and_signed_uploads(
    sdk: str,
    http_timeout: str,
    expected: int,
    oauth: bool,
    upload_type: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("MLFLOW_ENABLE_DB_SDK", sdk)
    monkeypatch.setenv("MLFLOW_HTTP_REQUEST_TIMEOUT", http_timeout)
    snapshot = resolve_provider_config(
        "databricks",
        {
            "host": "https://workspace.example",
            "experiment_id": "1",
            **({"client_id": "client", "client_secret": "secret"} if oauth else {"personal_access_token": "pat"}),
        },
    )
    monkeypatch.setenv("MLFLOW_ENABLE_DB_SDK", "false")
    monkeypatch.setenv("MLFLOW_HTTP_REQUEST_TIMEOUT", "1")
    monkeypatch.setattr(DatabricksConfig, "load_runtime_settings", Mock(side_effect=AssertionError("Snapshot reread")))
    now = [1000.0]
    monkeypatch.setattr("core.ops.provider_export.monotonic", lambda: now[0])
    requests: list[str] = []

    def request(method: str, url: str, **kwargs: Any) -> httpx.Response:
        remaining = 1100 - now[0]
        storage = url.startswith("https://storage.example/")
        assert kwargs["timeout"] == (remaining if storage else min(expected, remaining))
        requests.append(url)
        now[0] += 5
        if url.endswith("oidc/v1/token"):
            return httpx.Response(200, json={"access_token": "issued"})
        if url.endswith("credentials-for-data-upload"):
            return httpx.Response(
                200, json={"credential_info": {"signed_uri": "https://storage.example/upload", "type": upload_type}}
            )
        return httpx.Response(200, json={})

    monkeypatch.setattr("core.ops.provider_export.ssrf_proxy.make_request", request)
    client = MLflowTraceClient("databricks", snapshot)
    assert client.verify_credentials()
    assert client.export_trace(make_completed_trace()).spans
    assert sum(url.startswith("https://storage.example/") for url in requests) == (
        3 if upload_type == "AZURE_ADLS_GEN2_SAS_URI" else 1
    )
    now[0] = 1097
    client.http.request("GET", "api/2.0/mlflow/experiments/get")
    request_count = len(requests)
    with pytest.raises(TraceExportError, match="export_deadline_exceeded"):
        client.http.request("GET", "api/2.0/mlflow/experiments/get")
    with pytest.raises(TraceExportError, match="export_deadline_exceeded"):
        client._upload_spans({"signed_uri": "https://storage.example/upload"}, b"{}")
    assert len(requests) == request_count


@pytest.mark.parametrize("setting", ["", "invalid", "0", "-1", "1.5"])
def test_invalid_legacy_http_timeout_is_rejected(setting: str, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MLFLOW_ENABLE_DB_SDK", "false")
    monkeypatch.setenv("MLFLOW_HTTP_REQUEST_TIMEOUT", setting)
    with pytest.raises(ValueError):
        DatabricksConfig.load_runtime_settings({})


@pytest.mark.parametrize("setting", ["invalid", "-1", "nan", "inf"])
def test_invalid_selected_sdk_timeout_is_rejected(
    setting: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    (tmp_path / ".databrickscfg").write_text(f"[selected]\nhttp_timeout_seconds={setting}\n")
    monkeypatch.setenv("DATABRICKS_CONFIG_PROFILE", "selected")
    with pytest.raises(ValueError):
        DatabricksConfig.load_runtime_settings({})
