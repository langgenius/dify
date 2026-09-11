from pathlib import Path
from typing import Any
from unittest.mock import Mock

import httpx
import pytest
from dify_trace_mlflow.config import MLflowConfig
from dify_trace_mlflow.mlflow_trace import MLflowTraceClient

from core.ops.provider_config import resolve_provider_config
from core.ops.provider_export import TraceExportError, basic_auth
from tests.unit_tests.core.ops.test_provider_export import make_completed_trace


@pytest.mark.parametrize(
    ("saved", "environment", "file_credentials", "authorization"),
    [
        (
            {"username": "saved", "password": "saved-secret"},
            {"USERNAME": "env", "PASSWORD": "env-secret", "TOKEN": "token"},
            {},
            basic_auth("saved", "saved-secret"),
        ),
        (
            {"username": "unused-partial"},
            {"USERNAME": "env", "PASSWORD": "env-secret", "TOKEN": "token"},
            {},
            basic_auth("env", "env-secret"),
        ),
        (
            {},
            {"USERNAME": "env", "TOKEN": "token"},
            {"username": "file", "password": "file-secret"},
            basic_auth("env", "file-secret"),
        ),
        (
            {},
            {"USERNAME": "", "PASSWORD": ""},
            {"username": "file", "password": "file-secret"},
            basic_auth("file", "file-secret"),
        ),
        ({}, {"TOKEN": "token"}, {"username": "incomplete"}, "Bearer token"),
        ({"username": "incomplete"}, {}, {}, None),
    ],
)
def test_authentication_keeps_saved_environment_and_file_precedence(
    saved: dict[str, str],
    environment: dict[str, str],
    file_credentials: dict[str, str],
    authorization: str | None,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    credentials = tmp_path / ".mlflow" / "credentials"
    credentials.parent.mkdir()
    credentials.write_text(
        "[mlflow]\n" + "".join(f"mlflow_tracking_{key}={value}\n" for key, value in file_credentials.items())
    )
    for name, value in environment.items():
        monkeypatch.setenv(f"MLFLOW_TRACKING_{name}", value)
    client = MLflowTraceClient("mlflow", {"tracking_uri": "https://mlflow.example", **saved})
    assert client.http.headers.get("Authorization") == authorization


def test_deployment_authentication_is_captured_and_isolated(monkeypatch: pytest.MonkeyPatch) -> None:
    config: dict[str, Any] = {"tracking_uri": "https://mlflow.example", "experiment_id": "7"}
    monkeypatch.setenv("MLFLOW_TRACKING_TOKEN", "first-secret")
    first = resolve_provider_config("mlflow", config)
    monkeypatch.setenv("MLFLOW_TRACKING_TOKEN", "second-secret")
    second = resolve_provider_config("mlflow", config)
    assert first != second
    monkeypatch.setattr(MLflowConfig, "load_runtime_settings", Mock(side_effect=AssertionError("snapshot reread")))
    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(404 if "/api/3.0/mlflow/traces/" in request.url.path else 200)

    monkeypatch.setattr(
        "core.ops.provider_export.ssrf_proxy.create_http_client",
        lambda *, ssl_context=None: httpx.Client(transport=httpx.MockTransport(respond), verify=ssl_context or True),
    )
    first_client = MLflowTraceClient("mlflow", first)
    second_client = MLflowTraceClient("mlflow", second)
    assert first_client.verify_credentials()
    second_client.export_trace(make_completed_trace())
    first_client._upload_mlflow_artifact("mlflow-artifacts:/trace", b"{}")
    assert [request.headers["Authorization"] for request in requests] == [
        "Bearer first-secret",
        "Bearer second-secret",
        "Bearer second-secret",
        "Bearer second-secret",
        "Bearer first-secret",
    ]
    assert "_runtime_settings" not in config


def test_snapshot_never_copies_encrypted_saved_password(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MLFLOW_TRACKING_TOKEN", "unused-token")
    captured = MLflowConfig.load_runtime_settings({"username": "saved", "password": "ciphertext"})
    assert "ciphertext" not in str(captured)
    client = MLflowTraceClient("mlflow", {"username": "saved", "password": "plaintext", "_runtime_settings": captured})
    assert client.http.headers["Authorization"] == basic_auth("saved", "plaintext")
    blank_password = MLflowTraceClient("mlflow", {"username": "saved", "password": "", "_runtime_settings": captured})
    assert blank_password.http.headers["Authorization"] == "Bearer unused-token"


def test_saved_credentials_satisfy_captured_kubernetes_auth_without_rereading(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(MLflowConfig, "load_runtime_settings", Mock(side_effect=AssertionError("snapshot reread")))
    captured = {"headers": {"Authorization": "", "X-MLFLOW-WORKSPACE": "namespace"}}
    client = MLflowTraceClient("mlflow", {"username": "saved", "password": "plaintext", "_runtime_settings": captured})
    assert client.http.headers == {"Authorization": basic_auth("saved", "plaintext"), "X-MLFLOW-WORKSPACE": "namespace"}
    with pytest.raises(TraceExportError, match="mlflow_credentials_missing"):
        MLflowTraceClient("mlflow", {"_runtime_settings": captured})
