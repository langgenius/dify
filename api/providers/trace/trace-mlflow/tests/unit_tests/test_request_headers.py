"""MLflow 3.11.1 header-provider requests, with selections owned by each export."""

import json
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier
from types import ModuleType, SimpleNamespace
from typing import Any, override

import httpx
import pytest
from dify_trace_mlflow.mlflow_trace import MLflowTraceClient

from core.ops.provider_config import resolve_provider_config
from core.ops.provider_export import TraceExportError, basic_auth

from .test_native_export import make_trace  # pyrefly: ignore[missing-import]


@pytest.fixture
def install_headers(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    directory = tmp_path / "header_plugins"
    distribution = directory / "example_headers-1.0.dist-info"
    distribution.mkdir(parents=True)
    (distribution / "METADATA").write_text("Metadata-Version: 2.1\nName: example-headers\nVersion: 1.0\n")
    module = ModuleType("example_mlflow_headers")
    monkeypatch.setitem(sys.modules, module.__name__, module)
    monkeypatch.syspath_prepend(str(directory))

    def install(providers: list[type]) -> None:
        entries = ["[mlflow.request_header_provider]", "broken = absent_header_plugin:Provider"]
        for index, provider in enumerate(providers):
            setattr(module, f"Provider{index}", provider)
            entries.append(f"header{index} = {module.__name__}:Provider{index}")
        (distribution / "entry_points.txt").write_text("\n".join(entries) + "\n")

    return install


def capture_requests(monkeypatch: pytest.MonkeyPatch) -> list[httpx.Request]:
    sent: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        sent.append(request)
        return httpx.Response(200)

    monkeypatch.setattr(
        "core.ops.provider_export.ssrf_proxy.create_http_client",
        lambda **kwargs: httpx.Client(transport=httpx.MockTransport(respond), trust_env=False),
    )
    return sent


@pytest.mark.parametrize("provider_name", ["mlflow", "databricks"])
def test_plugins_resolve_each_native_http_request_and_preserve_auth(
    provider_name: str, install_headers: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    class Header:
        def __init__(self):
            self.calls = 0

        def in_context(self):
            return True

        def request_headers(self):
            self.calls += 1
            return {"X-Proxy-Token": f"request-{self.calls}", "Authorization": "plugin", "User-Agent": "custom"}

    install_headers([Header])
    config = (
        {"host": "https://tracker.example", "personal_access_token": "saved", "experiment_id": "1"}
        if provider_name == "databricks"
        else {"tracking_uri": "https://tracker.example", "username": "saved", "password": "secret"}
    )
    captured = resolve_provider_config(provider_name, config)
    sent = capture_requests(monkeypatch)
    client = MLflowTraceClient(provider_name, captured)
    assert client.verify_credentials()
    if provider_name == "mlflow":
        client._upload_mlflow_artifact("https://different.example/artifacts", b"{}")
    else:
        client.http.request("POST", "api/2.0/mlflow/traces")
    assert [request.headers.get("X-Proxy-Token") for request in sent] == ["request-1", "request-2"]
    expected_auth = "Bearer saved" if provider_name == "databricks" else basic_auth("saved", "secret")
    assert all(request.headers["Authorization"] == expected_auth for request in sent)
    assert all(request.headers["User-Agent"] == "mlflow-python-client/3.11.1 custom" for request in sent)
    assert all(request.headers["X-MLflow-Client-Version"] == "3.11.1" for request in sent)
    if provider_name == "databricks":
        client._upload_spans({"signed_uri": "https://storage.example/upload", "headers": []}, b"{}")
        assert "X-Proxy-Token" not in sent[-1].headers
        assert "Authorization" not in sent[-1].headers


def test_context_filter_merge_errors_and_explicit_headers_match_native(
    install_headers: Any, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    class Inactive:
        def in_context(self):
            return False

        def request_headers(self):
            raise AssertionError("Inactive provider called")

    class Broken:
        def in_context(self):
            raise RuntimeError("credential-must-not-be-logged")

    class First:
        def in_context(self):
            return True

        def request_headers(self):
            return {"X-Shared": "first", "Content-Type": "plugin", "X-MLFLOW-WORKSPACE": "plugin-workspace"}

    class Second(First):
        @override
        def request_headers(self):
            return {"X-Shared": "second"}

    install_headers([Inactive, Broken, First, Second])
    monkeypatch.setenv("MLFLOW_WORKSPACE", "environment-workspace")
    sent = capture_requests(monkeypatch)
    client = MLflowTraceClient("mlflow", {"tracking_uri": "https://tracker.example"})
    client._upload_mlflow_artifact("https://different.example/artifacts", b"{}")
    assert sent[0].headers["X-Shared"] == "first second"
    assert sent[0].headers["Content-Type"] == "application/json"
    assert sent[0].headers["X-MLFLOW-WORKSPACE"] == "plugin-workspace"
    assert "credential-must-not-be-logged" not in caplog.text


def test_plugin_instances_are_owned_by_each_concurrent_tenant(
    install_headers: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    barrier = Barrier(2)

    class Header:
        def __init__(self):
            self.requests = 0

        def in_context(self):
            return True

        def request_headers(self):
            self.requests += 1
            barrier.wait(timeout=10)
            return {"X-Request-Count": str(self.requests)}

    install_headers([Header])
    snapshots = [
        resolve_provider_config(
            "mlflow", {"tracking_uri": "https://tracker.example", "username": tenant, "password": tenant}
        )
        for tenant in ("tenant-one", "tenant-two")
    ]
    assert "X-Request-Count" not in json.dumps(snapshots)
    sent = capture_requests(monkeypatch)

    def export(snapshot: dict[str, Any]) -> None:
        client = MLflowTraceClient("mlflow", snapshot)
        client.verify_credentials()
        client.verify_credentials()

    with ThreadPoolExecutor(max_workers=2) as executor:
        list(executor.map(export, snapshots))
    for tenant in ("tenant-one", "tenant-two"):
        own_requests = [request for request in sent if request.headers["Authorization"] == basic_auth(tenant, tenant)]
        assert [request.headers.get("X-Request-Count") for request in own_requests] == ["1", "2"]


def test_worker_uses_captured_plugin_selection_and_databricks_headers(
    install_headers: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    repl = ModuleType("dbruntime.databricks_repl_context")
    notebook = SimpleNamespace(isInNotebook=True, isInJob=False, isInCluster=False, notebookId="captured")
    repl.get_context = lambda: notebook  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "dbruntime", ModuleType("dbruntime"))
    monkeypatch.setitem(sys.modules, repl.__name__, repl)
    captured = resolve_provider_config("mlflow", {"tracking_uri": "https://tracker.example"})
    notebook.notebookId = "worker"

    class NewProvider:
        def in_context(self):
            return True

        def request_headers(self):
            return {"X-Uncaptured": "worker"}

    install_headers([NewProvider])
    sent = capture_requests(monkeypatch)
    MLflowTraceClient("mlflow", captured).verify_credentials()
    assert sent[0].headers.get("notebook_id") == "captured"
    assert "X-Uncaptured" not in sent[0].headers


def test_removed_captured_plugin_rejects_before_request(install_headers: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    class Header:
        def in_context(self):
            return True

        def request_headers(self):
            return {"X-Required": "authorization"}

    install_headers([Header])
    captured = resolve_provider_config("mlflow", {"tracking_uri": "https://tracker.example"})
    install_headers([])
    sent = capture_requests(monkeypatch)
    with pytest.raises(TraceExportError, match="mlflow_header_plugin_changed"):
        MLflowTraceClient("mlflow", captured).verify_credentials()
    assert sent == []


def test_native_otlp_export_resolves_header_plugin_for_all_tracking_calls(
    install_headers: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    class Header:
        def in_context(self):
            return True

        def request_headers(self):
            return {"X-Proxy-Token": "required"}

    install_headers([Header])
    sent: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        sent.append(request)
        if request.headers.get("X-Proxy-Token") != "required":
            return httpx.Response(401)
        if request.url.path == "/v1/traces":
            return httpx.Response(200, content=b"")
        return httpx.Response(404 if request.method == "GET" else 200, json={})

    monkeypatch.setattr(
        "core.ops.provider_export.ssrf_proxy.create_http_client",
        lambda **kwargs: httpx.Client(transport=httpx.MockTransport(respond), trust_env=False),
    )
    MLflowTraceClient("mlflow", {"tracking_uri": "https://tracker.example"}).export_trace(make_trace())
    assert sent[-1].url.path == "/v1/traces"
    assert all(request.headers["X-Proxy-Token"] == "required" for request in sent)


@pytest.mark.parametrize("auth_source", ["netrc", "url"])
def test_implicit_auth_replaces_mixed_case_plugin_authorization_on_every_http_path(
    auth_source: str, install_headers: Any, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    class Header:
        def in_context(self):
            return True

        def request_headers(self):
            return {"authorization": "Bearer plugin"}

    install_headers([Header])
    prefix = "https://"
    if auth_source == "netrc":
        netrc = tmp_path / "netrc"
        netrc.write_text("default login implicit-user password implicit-secret\n")
        monkeypatch.setenv("NETRC", str(netrc))
    else:
        prefix += "implicit-user:implicit-secret@"
    sent: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        sent.append(request)
        if request.url.path == "/v1/traces":
            return httpx.Response(200, content=b"")
        return httpx.Response(404 if "/api/3.0/" in request.url.path and request.method == "GET" else 200, json={})

    monkeypatch.setattr(
        "core.ops.provider_export.ssrf_proxy.create_http_client",
        lambda **kwargs: httpx.Client(transport=httpx.MockTransport(respond), trust_env=False),
    )
    client = MLflowTraceClient("mlflow", {"tracking_uri": prefix + "tracker.example"})
    client.verify_credentials()
    client._upload_mlflow_artifact(prefix + "artifacts.example/trace", b"{}")
    client.export_trace(make_trace())
    assert all(
        request.headers.get_list("Authorization") == [basic_auth("implicit-user", "implicit-secret")]
        for request in sent
    )
