"""MLflow artifact authentication follows the tracker-authorized destination and owner."""

import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier
from time import monotonic
from typing import Any
from unittest.mock import Mock

import httpx
import pytest
from dify_trace_mlflow.config import MLflowConfig
from dify_trace_mlflow.mlflow_trace import MLflowTraceClient

from core.ops.provider_config import resolve_provider_config
from core.ops.provider_export import TraceExportError, basic_auth
from tests.unit_tests.core.ops.test_provider_export import make_completed_trace


@pytest.mark.parametrize("credential_source", ["saved", "environment", "file", "bearer"])
@pytest.mark.parametrize("artifact_scheme", ["https", "mlflow-artifacts"])
def test_tracker_authorized_artifacts_keep_concurrent_owner_authentication(
    credential_source: str, artifact_scheme: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    traces = {owner: make_completed_trace() for owner in ("first", "second")}
    assert traces["first"].source.tenant_id != traces["second"].source.tenant_id
    configurations: dict[str, dict[str, Any]] = {}
    authorization: dict[str, str] = {}
    credentials_file = tmp_path / ".mlflow" / "credentials"
    credentials_file.parent.mkdir()
    for owner in traces:
        config = {"tracking_uri": f"https://{owner}-tracker.example/prefix", "experiment_id": "7"}
        username, password = f"{owner}-user", f"{owner}-secret"
        authorization[owner] = basic_auth(username, password)
        if credential_source == "saved":
            config.update(username=username, password=password)
        elif credential_source == "environment":
            monkeypatch.setenv("MLFLOW_TRACKING_USERNAME", username)
            monkeypatch.setenv("MLFLOW_TRACKING_PASSWORD", password)
        elif credential_source == "file":
            credentials_file.write_text(
                f"[mlflow]\nmlflow_tracking_username = {username}\nmlflow_tracking_password = {password}\n"
            )
        else:
            monkeypatch.setenv("MLFLOW_TRACKING_TOKEN", password)
            authorization[owner] = f"Bearer {password}"
        monkeypatch.setenv("MLFLOW_WORKSPACE", f"{owner}-workspace")
        configurations[owner] = resolve_provider_config("mlflow", config)

    credentials_file.unlink(missing_ok=True)
    monkeypatch.setenv("MLFLOW_TRACKING_TOKEN", "unrelated-secret")
    monkeypatch.setenv("MLFLOW_WORKSPACE", "unrelated-workspace")
    monkeypatch.setattr(MLflowConfig, "load_runtime_settings", Mock(side_effect=AssertionError("Snapshot reread")))
    uploads: dict[str, httpx.Request] = {}
    barrier = Barrier(2)

    def respond(request: httpx.Request) -> httpx.Response:
        owner = request.url.host.split("-", 1)[0]
        assert request.headers["Authorization"] == authorization[owner]
        assert request.headers["X-MLFLOW-WORKSPACE"] == f"{owner}-workspace"
        assert all(0 < value <= 10 for value in request.extensions["timeout"].values())
        if request.url.host == f"{owner}-artifacts.example":
            barrier.wait(timeout=5)
            assert request.method == "PUT"
            assert request.url.path.endswith("/traces.json")
            assert "X-Tracking-Only" not in request.headers
            assert request.headers["Content-Type"] == "application/json"
            spans = json.loads(request.content)["spans"]
            assert all(
                json.loads(span["attributes"]["dify.tenant_id"]) == traces[owner].source.tenant_id for span in spans
            )
            uploads[owner] = request
            return httpx.Response(200)
        assert request.url.host == f"{owner}-tracker.example"
        assert request.headers["X-Tracking-Only"] == f"{owner}-private"
        if request.method == "GET" or request.url.path.endswith("/v1/traces"):
            return httpx.Response(404)
        info = json.loads(request.content)["trace"]["trace_info"]
        info["tags"]["mlflow.artifactLocation"] = f"{artifact_scheme}://{owner}-artifacts.example/7/trace"
        return httpx.Response(200, json={"trace": {"trace_info": info}})

    monkeypatch.setattr(
        "core.ops.provider_export.ssrf_proxy.create_http_client",
        lambda *, ssl_context=None: httpx.Client(
            transport=httpx.MockTransport(respond), verify=ssl_context or True, trust_env=False
        ),
    )

    def export(owner: str) -> None:
        client = MLflowTraceClient("mlflow", configurations[owner])
        client.http.deadline = monotonic() + 10
        client.http.headers["X-Tracking-Only"] = f"{owner}-private"
        receipts = client.export_trace(traces[owner])
        assert receipts.spans[traces[owner].root_span_id]["artifact_trace"] is True

    with ThreadPoolExecutor(max_workers=2) as executor:
        exports = [executor.submit(export, owner) for owner in traces]
        for result in exports:
            result.result(timeout=10)
    assert set(uploads) == set(traces)


@pytest.mark.parametrize(
    "artifact_uri", ["https://user:secret@artifacts.example/trace", "https:///trace", "file:///trace"]
)
def test_mlflow_artifact_credentials_do_not_bypass_url_validation(
    artifact_uri: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    client = MLflowTraceClient(
        "mlflow", {"tracking_uri": "https://tracker.example", "username": "user", "password": "key"}
    )
    request = Mock(side_effect=AssertionError("Invalid artifact destination was requested"))
    monkeypatch.setattr("core.ops.provider_export.ssrf_proxy.make_request", request)
    with pytest.raises((ValueError, TraceExportError)):
        client._upload_mlflow_artifact(artifact_uri, b"{}")
    request.assert_not_called()


def test_mlflow_artifact_upload_keeps_the_export_deadline(monkeypatch: pytest.MonkeyPatch) -> None:
    client = MLflowTraceClient(
        "mlflow", {"tracking_uri": "https://tracker.example", "username": "user", "password": "key"}
    )
    client.http.deadline = monotonic() - 1
    request = Mock(side_effect=AssertionError("Expired artifact upload was requested"))
    monkeypatch.setattr("core.ops.provider_export.ssrf_proxy.make_request", request)
    with pytest.raises(TraceExportError, match="export_deadline_exceeded"):
        client._upload_mlflow_artifact("https://artifacts.example/trace", b"{}")
    request.assert_not_called()
