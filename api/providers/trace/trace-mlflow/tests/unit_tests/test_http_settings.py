"""Requests authentication precedence and timeout bounds survive explicit HTTP ownership."""

from pathlib import Path
from typing import Any
from unittest.mock import Mock

import httpx
import pytest
import requests
from dify_trace_mlflow.config import MLflowConfig
from dify_trace_mlflow.mlflow_trace import MLflowHttpClient, MLflowTraceClient
from dify_trace_mlflow.request_auth import capture_netrc_auth
from requests.auth import HTTPBasicAuth

from core.ops.provider_config import resolve_provider_config
from core.ops.provider_export import TraceExportError, basic_auth
from tests.unit_tests.core.ops.test_provider_export import make_completed_trace

# Pytest importlib mode resolves these hyphenated provider packages.
from .test_request_auth import install_transport  # pyrefly: ignore[missing-import]


@pytest.mark.parametrize(
    "netrc_text",
    [
        "",
        "machine tracker.example login netrc password secret\n",
        "default login fallback password secret\n",
        "machine other.example login other password secret\n",
        'machine tracker.example login "" password ""\ndefault login fallback password secret\n',
        "machine tracker.example account account-user password secret\n",
    ],
)
@pytest.mark.parametrize("userinfo", ["", "url-user:p%40ss%3Aword@", "r%C3%A9view:s%C3%A9cret@"])
def test_implicit_auth_matches_native_requests(
    netrc_text: str, userinfo: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    filename = tmp_path / "netrc"
    filename.write_text(netrc_text)
    monkeypatch.setenv("NETRC", str(filename))
    endpoint = f"https://{userinfo}tracker.example/prefix"
    saved_auth = basic_auth("saved", "saved-secret")
    with requests.Session() as session:
        expected = session.prepare_request(
            requests.Request("GET", endpoint + "/api/2.0/mlflow/experiments/get", headers={"Authorization": saved_auth})
        ).headers["Authorization"]
    config = resolve_provider_config(
        "mlflow", {"tracking_uri": endpoint, "username": "saved", "password": "saved-secret"}
    )
    filename.unlink()
    monkeypatch.setattr(MLflowConfig, "load_runtime_settings", Mock(side_effect=AssertionError("Snapshot reread")))
    sent: list[httpx.Request] = []
    install_transport(monkeypatch, lambda request: sent.append(request) or httpx.Response(200))
    client = MLflowTraceClient("mlflow", config)
    assert client.verify_credentials()
    assert sent[0].headers["Authorization"] == expected
    assert sent[0].url.userinfo == b""
    assert client.get_project_url() == "https://tracker.example/prefix/#/experiments/0/traces"


def test_netrc_file_selection_and_empty_snapshot(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    (tmp_path / "_netrc").write_text("default login alternate password secret\n")
    assert capture_netrc_auth() == {"default": ["alternate", "secret"]}
    (tmp_path / ".netrc").write_text("machine tracker.example login selected password secret\n")
    assert capture_netrc_auth() == {"tracker.example": ["selected", "secret"]}
    (tmp_path / ".netrc").write_text("invalid netrc content")
    assert capture_netrc_auth() == {}
    monkeypatch.setenv("NETRC", str(tmp_path / "missing"))
    captured = resolve_provider_config("mlflow", {"tracking_uri": "https://tracker.example"})
    (tmp_path / "missing").write_text("default login later password secret\n")
    sent: list[httpx.Request] = []
    install_transport(monkeypatch, lambda request: sent.append(request) or httpx.Response(200))
    assert MLflowTraceClient("mlflow", captured).verify_credentials()
    assert "Authorization" not in sent[0].headers


@pytest.mark.parametrize("explicit_auth", ["plugin", "aws", "kubernetes", "none-plugin"])
def test_explicit_auth_objects_keep_precedence(
    explicit_auth: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    (tmp_path / ".netrc").write_text("default login netrc password secret\n")
    if explicit_auth == "kubernetes":
        monkeypatch.setenv("MLFLOW_TRACKING_AUTH", "kubernetes")
        monkeypatch.setenv("MLFLOW_TRACKING_TOKEN", "deployment-token")
    config = resolve_provider_config("mlflow", {"tracking_uri": "https://url:secret@tracker.example"})
    client = MLflowTraceClient("mlflow", config)
    assert isinstance(client.http, MLflowHttpClient)
    if explicit_auth in {"plugin", "none-plugin"}:
        client.http.request_auth_provider = Mock(
            get_auth=Mock(return_value=HTTPBasicAuth("plugin", "secret") if explicit_auth == "plugin" else None)
        )
    elif explicit_auth == "aws":
        client.http.aws_sigv4 = {"access_key": "key", "secret_key": "secret", "region": "us-east-1"}
    sent: list[httpx.Request] = []
    install_transport(monkeypatch, lambda request: sent.append(request) or httpx.Response(200))
    assert client.verify_credentials()
    authorization = sent[0].headers["Authorization"]
    if explicit_auth == "aws":
        assert authorization.startswith("AWS4-HMAC-SHA256 ")
    else:
        assert (
            authorization
            == {
                "plugin": basic_auth("plugin", "secret"),
                "none-plugin": basic_auth("netrc", "secret"),
                "kubernetes": "Bearer deployment-token",
            }[explicit_auth]
        )


@pytest.mark.parametrize("netrc_artifact", [False, True])
@pytest.mark.parametrize("ordinary_auth", [False, True])
def test_discovered_artifact_auth_uses_its_own_captured_host_and_url(
    netrc_artifact: bool, ordinary_auth: bool, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    netrc_text = "machine tracker.example login tracker-netrc password secret\n"
    if netrc_artifact:
        netrc_text += "machine artifacts.example login artifact-netrc password secret\n"
    filename = tmp_path / ".netrc"
    filename.write_text(netrc_text)
    monkeypatch.setenv("NETRC", str(filename))
    config = {"tracking_uri": "https://tracker-url:secret@tracker.example/prefix"}
    if ordinary_auth:
        config.update(username="saved", password="secret")
    with requests.Session() as session:
        native_auth = [
            session.prepare_request(
                requests.Request(
                    "PUT",
                    url,
                    headers={"Authorization": basic_auth("saved", "secret")} if ordinary_auth else {},
                )
            ).headers.get("Authorization")
            for url in (
                "https://artifact-url:p%40ss@artifacts.example/trace/traces.json",
                "https://unrelated.example/trace/traces.json",
                "https://tracker-url:secret@tracker.example/prefix/api/2.0/mlflow-artifacts/artifacts/trace/traces.json",
            )
        ]
    captured = resolve_provider_config("mlflow", config)
    filename.unlink()
    sent: list[httpx.Request] = []
    install_transport(monkeypatch, lambda request: sent.append(request) or httpx.Response(200))
    client = MLflowTraceClient("mlflow", captured)
    client._upload_mlflow_artifact("https://artifact-url:p%40ss@artifacts.example/trace", b"{}")
    client._upload_mlflow_artifact("https://unrelated.example/trace", b"{}")
    client._upload_mlflow_artifact("mlflow-artifacts:/trace", b"{}")
    assert [request.headers.get("Authorization") for request in sent] == native_auth
    assert native_auth == [
        basic_auth("artifact-netrc", "secret") if netrc_artifact else basic_auth("artifact-url", "p@ss"),
        basic_auth("saved", "secret") if ordinary_auth else None,
        basic_auth("tracker-netrc", "secret"),
    ]
    assert all(request.url.userinfo == b"" for request in sent)


def test_artifact_proxy_inherits_only_the_tracking_url_userinfo(monkeypatch: pytest.MonkeyPatch) -> None:
    client = MLflowTraceClient("mlflow", {"tracking_uri": "https://url:p%40ss@tracker.example/prefix"})
    sent: list[httpx.Request] = []
    install_transport(monkeypatch, lambda request: sent.append(request) or httpx.Response(200))
    for uri in (
        "mlflow-artifacts:/trace",
        "mlflow-artifacts://artifacts.example/trace",
        "https://tracker.example/trace",
    ):
        client._upload_mlflow_artifact(uri, b"{}")
    assert [request.headers.get("Authorization") for request in sent] == [basic_auth("url", "p@ss"), None, None]


@pytest.mark.parametrize("setting", [None, "7", "3600"])
def test_timeout_snapshot_covers_tracking_otlp_and_artifact_requests(
    setting: str | None, monkeypatch: pytest.MonkeyPatch
) -> None:
    if setting is not None:
        monkeypatch.setenv("MLFLOW_HTTP_REQUEST_TIMEOUT", setting)
    config = resolve_provider_config("mlflow", {"tracking_uri": "https://tracker.example"})
    request_timeout = int(setting) if setting else 120
    assert config["_runtime_settings"]["request_timeout"] == request_timeout
    monkeypatch.setenv("MLFLOW_HTTP_REQUEST_TIMEOUT", "1")
    now = [1000.0]
    monkeypatch.setattr("core.ops.provider_export.monotonic", lambda: now[0])
    calls: list[str] = []

    def request(method: str, url: str, **kwargs: Any) -> httpx.Response:
        assert kwargs["timeout"] == min(request_timeout, 1100 - now[0])
        calls.append(url)
        now[0] += 5
        return httpx.Response(404 if method == "GET" and "/traces/" in url else 200)

    monkeypatch.setattr("core.ops.provider_export.ssrf_proxy.make_request", request)
    client = MLflowTraceClient("mlflow", config)
    assert client.verify_credentials()
    client.export_trace(make_completed_trace())
    client._upload_mlflow_artifact("mlflow-artifacts:/trace", b"{}")
    client._upload_mlflow_artifact("https://artifacts.example/trace", b"{}")
    assert len(calls) == 6
    now[0] = 1100
    with pytest.raises(TraceExportError, match="export_deadline_exceeded"):
        client._upload_mlflow_artifact("https://artifacts.example/trace", b"{}")


@pytest.mark.parametrize("setting", ["7", "120"])
def test_auth_plugin_uses_the_captured_timeout_and_remaining_deadline(
    setting: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("MLFLOW_HTTP_REQUEST_TIMEOUT", setting)
    client = MLflowTraceClient("mlflow", {"tracking_uri": "https://tracker.example"})
    assert isinstance(client.http, MLflowHttpClient)
    client.http.request_auth_provider = Mock(get_auth=Mock(return_value=HTTPBasicAuth("plugin", "secret")))
    client.http.deadline = 1080
    monkeypatch.setattr("dify_trace_mlflow.request_auth.monotonic", lambda: 1000)
    sent: list[httpx.Request] = []
    install_transport(monkeypatch, lambda request: sent.append(request) or httpx.Response(200))
    assert client.verify_credentials()
    assert set(sent[0].extensions["timeout"].values()) == {min(int(setting), 80)}


@pytest.mark.parametrize("setting", ["", "invalid", "0", "-1", "1.5"])
def test_invalid_http_timeout_is_rejected(setting: str, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MLFLOW_HTTP_REQUEST_TIMEOUT", setting)
    with pytest.raises(ValueError):
        MLflowConfig.load_runtime_settings({"tracking_uri": "https://tracker.example"})
