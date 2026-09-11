"""Captured SDK disabling suppresses trace delivery without disabling credential checks."""

import json
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from typing import Any
from unittest.mock import Mock
from uuid import uuid4

import httpx
import pytest
from dify_trace_mlflow.config import DatabricksConfig, MLflowConfig
from dify_trace_mlflow.mlflow_trace import MLflowTraceClient
from pydantic import JsonValue

from core.ops.provider_config import resolve_provider_config
from core.ops.provider_export import basic_auth, export_span_id
from core.ops.trace_data import CompletedTrace, ExportedParentSpans

# Pytest importlib mode resolves these hyphenated provider packages.
from .test_export_contract import make_provider_config  # pyrefly: ignore[missing-import]
from .test_native_export import make_trace  # pyrefly: ignore[missing-import]


@pytest.mark.parametrize("provider", ["mlflow", "databricks"])
@pytest.mark.parametrize(
    ("value", "disabled"),
    [
        (None, False),
        ("", False),
        ("true", True),
        (" TrUe \t", True),
        ("false", False),
        ("1", False),
        ("yes", False),
        ("invalid", False),
    ],
)
def test_sdk_disabled_matches_native_boolean_parsing(
    provider: str, value: str | None, disabled: bool, monkeypatch: pytest.MonkeyPatch
) -> None:
    if value is not None:
        monkeypatch.setenv("OTEL_SDK_DISABLED", value)
    config = make_provider_config(provider)
    schema = DatabricksConfig if provider == "databricks" else MLflowConfig
    assert schema.load_runtime_settings(config)["disabled"] is disabled
    assert MLflowTraceClient(provider, config).disabled is disabled


@pytest.mark.parametrize("provider", ["mlflow", "databricks"])
def test_disabled_snapshot_skips_exports_but_keeps_credential_verification(
    provider: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    config: dict[str, Any] = make_provider_config(provider)
    if provider == "databricks":
        config.update(client_id="client", client_secret="secret")
    monkeypatch.setenv("OTEL_SDK_DISABLED", "true")
    snapshot = json.dumps(resolve_provider_config(provider, config))
    monkeypatch.setenv("OTEL_SDK_DISABLED", "false")
    schema = DatabricksConfig if provider == "databricks" else MLflowConfig
    monkeypatch.setattr(schema, "load_runtime_settings", Mock(side_effect=AssertionError("Snapshot reread")))
    request = Mock(return_value=httpx.Response(200, json={"access_token": "verification-token"}))
    monkeypatch.setattr("core.ops.provider_export.ssrf_proxy.make_request", request)
    trace = make_trace()
    trace = trace.model_copy(
        update={"spans": tuple(span.model_copy(update={"started_at": None, "ended_at": None}) for span in trace.spans)}
    )
    for _ in range(2):
        client = MLflowTraceClient(provider, json.loads(snapshot))
        assert client.disabled is True
        receipts = client.export_trace(trace)
        request.assert_not_called()
        assert receipts.spans == {
            span.span_id: {
                "trace_id": trace.trace_id,
                "span_id": export_span_id(trace, span.span_id),
                "sampled": False,
                "disabled": True,
            }
            for span in trace.spans
        }
        assert client.verify_credentials()
        assert request.call_count == (2 if provider == "databricks" else 1)
        verification = request.call_args_list[-1]
        assert verification.args == ("GET", f"https://{provider}.example/api/2.0/mlflow/experiments/get")
        assert verification.kwargs["headers"]["Authorization"] == (
            "Bearer verification-token" if provider == "databricks" else basic_auth("user", "tenant-secret")
        )
        if provider == "databricks":
            token_request = request.call_args_list[0]
            assert token_request.args == ("POST", "https://databricks.example/oidc/v1/token")
            assert token_request.kwargs["headers"]["Authorization"] == basic_auth("client", "secret")
        request.reset_mock()


@pytest.mark.parametrize("provider", ["mlflow", "databricks"])
@pytest.mark.parametrize("empty_snapshot", [False, True])
def test_enabled_or_empty_snapshot_ignores_later_environment_disabling(
    provider: str, empty_snapshot: bool, monkeypatch: pytest.MonkeyPatch
) -> None:
    config: dict[str, Any] = make_provider_config(provider)
    config = {**config, "_runtime_settings": {}} if empty_snapshot else resolve_provider_config(provider, config)
    snapshot = json.dumps(config)
    monkeypatch.setenv("OTEL_SDK_DISABLED", "true")
    schema = DatabricksConfig if provider == "databricks" else MLflowConfig
    monkeypatch.setattr(schema, "load_runtime_settings", Mock(side_effect=AssertionError("Snapshot reread")))
    request = Mock(
        side_effect=lambda method, url, **kwargs: (
            httpx.Response(200, content=b"")
            if url.endswith("/v1/traces")
            else httpx.Response(
                404 if method == "GET" and "credentials-for-data-upload" not in url else 200,
                json={"credential_info": {"signed_uri": "https://storage.example/traces.json"}},
            )
        )
    )
    monkeypatch.setattr("core.ops.provider_export.ssrf_proxy.make_request", request)
    client = MLflowTraceClient(provider, json.loads(snapshot))
    assert client.disabled is False
    receipts = client.export_trace(make_trace())
    assert request.call_count == 3
    assert all(receipt["sampled"] is True and "disabled" not in receipt for receipt in receipts.spans.values())


@pytest.mark.parametrize("provider", ["mlflow", "databricks"])
@pytest.mark.parametrize(
    ("own_disabled", "parent_disabled", "parent_sampled"),
    [(True, False, True), (False, True, True), (False, True, None), (False, True, False), (False, False, False)],
)
def test_disabled_and_unsampled_receipts_preserve_ids_for_late_descendants(
    provider: str,
    own_disabled: bool,
    parent_disabled: bool,
    parent_sampled: bool | None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    request = Mock(side_effect=AssertionError("Suppressed trace made an HTTP request"))
    monkeypatch.setattr("core.ops.provider_export.ssrf_proxy.make_request", request)
    ancestor = make_trace()
    parent_trace_id = str(uuid4())
    parent: dict[str, JsonValue] = {
        "trace_id": parent_trace_id,
        "span_id": export_span_id(ancestor, ancestor.root_span_id),
        **({"sampled": parent_sampled} if parent_sampled is not None else {}),
        **({"disabled": True} if parent_disabled else {}),
    }
    for generation in range(2):
        trace = make_trace()
        trace = trace.model_copy(
            update={
                "source": trace.source.model_copy(
                    update={"tenant_id": ancestor.source.tenant_id, "app_id": ancestor.source.app_id}
                )
            }
        )
        client = MLflowTraceClient(
            provider,
            {**make_provider_config(provider), "_runtime_settings": {"disabled": own_disabled and generation == 0}},
        )
        receipts = client.export_trace(trace, parent)
        assert client.export_trace(trace, parent) == receipts
        assert receipts.spans == {
            span.span_id: {
                "trace_id": parent_trace_id,
                "span_id": export_span_id(trace, span.span_id),
                "sampled": False,
                **({"disabled": True} if own_disabled or parent_disabled else {}),
            }
            for span in trace.spans
        }
        parent = json.loads(receipts.model_dump_json())["spans"][trace.root_span_id]
    request.assert_not_called()


@pytest.mark.parametrize("provider", ["mlflow", "databricks"])
def test_concurrent_tenants_keep_separate_serialized_disabling_and_credentials(
    provider: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    trace_json: dict[str, str] = {}
    config_json: dict[str, str] = {}
    tenant_ids: dict[str, str] = {}
    authorization: dict[str, str] = {}
    for owner in ("disabled", "enabled"):
        trace = make_trace()
        trace = trace.model_copy(update={"source": trace.source.model_copy(update={"actor_id": f"{owner}-user"})})
        trace_json[owner] = trace.model_dump_json()
        tenant_ids[owner] = trace.source.tenant_id
        config = make_provider_config(provider, secret=f"{owner}-secret")
        config["host" if provider == "databricks" else "tracking_uri"] = f"https://{owner}-{provider}.example"
        if provider == "mlflow":
            config["username"] = f"{owner}-user"
        authorization[owner] = (
            f"Bearer {owner}-secret" if provider == "databricks" else basic_auth(f"{owner}-user", f"{owner}-secret")
        )
        monkeypatch.setenv("OTEL_SDK_DISABLED", str(owner == "disabled"))
        config_json[owner] = json.dumps(resolve_provider_config(provider, config))
    assert tenant_ids["disabled"] != tenant_ids["enabled"]
    monkeypatch.setenv("OTEL_SDK_DISABLED", "true")
    schema = DatabricksConfig if provider == "databricks" else MLflowConfig
    monkeypatch.setattr(schema, "load_runtime_settings", Mock(side_effect=AssertionError("Snapshot reread")))
    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.host == "enabled-storage.example":
            assert "Authorization" not in request.headers
            assert all(
                json.loads(span["attributes"]["dify.tenant_id"]) == tenant_ids["enabled"]
                for span in json.loads(request.content)["spans"]
            )
            return httpx.Response(200)
        assert request.url.host == f"enabled-{provider}.example"
        assert request.headers["Authorization"] == authorization["enabled"]
        if "credentials-for-data-upload" in request.url.path:
            return httpx.Response(
                200, json={"credential_info": {"signed_uri": "https://enabled-storage.example/traces.json"}}
            )
        if request.method == "GET":
            return httpx.Response(404)
        if request.url.path == "/v1/traces":
            return httpx.Response(200, content=b"")
        if request.url.path == "/api/3.0/mlflow/traces":
            metadata = json.loads(request.content)["trace"]["trace_info"]["trace_metadata"]
            assert metadata["dify.tenant_id"] == tenant_ids["enabled"]
            assert metadata["mlflow.trace.user"] == "enabled-user"
        return httpx.Response(200, json={})

    monkeypatch.setattr(
        "core.ops.provider_export.ssrf_proxy.create_http_client",
        lambda *, ssl_context=None: httpx.Client(
            transport=httpx.MockTransport(respond), verify=ssl_context or True, trust_env=False
        ),
    )
    barrier = Barrier(2)

    def export(owner: str) -> ExportedParentSpans:
        client = MLflowTraceClient(provider, json.loads(config_json[owner]))
        trace = CompletedTrace.model_validate_json(trace_json[owner])
        barrier.wait(timeout=5)
        return client.export_trace(trace)

    with ThreadPoolExecutor(max_workers=2) as executor:
        receipts = dict(zip(config_json, executor.map(export, config_json)))
    assert len(requests) == 3
    assert all(
        receipt["sampled"] is False and receipt["disabled"] is True for receipt in receipts["disabled"].spans.values()
    )
    assert all(
        receipt["sampled"] is True and "disabled" not in receipt for receipt in receipts["enabled"].spans.values()
    )
