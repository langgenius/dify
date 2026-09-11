import json
from unittest.mock import Mock

import httpx
import pytest
from dify_trace_weave.config import WeaveConfig
from dify_trace_weave.weave_trace import WeaveTraceClient

from core.ops.provider_config import provider_config_identity, resolve_provider_config
from tests.unit_tests.core.ops.test_provider_export import make_completed_trace


@pytest.mark.parametrize(
    ("setting", "disabled"),
    [
        (None, False),
        ("", False),
        ("true", True),
        ("TRUE", True),
        ("yes", True),
        ("YeS", True),
        ("1", True),
        ("on", True),
        ("ON", True),
        ("false", False),
        ("0", False),
        ("off", False),
        ("no", False),
        (" true ", False),
        ("enabled", False),
    ],
)
def test_disabled_setting_keeps_weave_sdk_boolean_semantics(
    setting: str | None, disabled: bool, monkeypatch: pytest.MonkeyPatch
) -> None:
    if setting is not None:
        monkeypatch.setenv("WEAVE_DISABLED", setting)
    settings = WeaveConfig.load_runtime_settings({"api_key": "key", "project": "project"})
    assert settings["disabled"] is disabled


def test_disabled_snapshot_skips_project_discovery_and_exports_but_keeps_parent_receipts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    config = {"api_key": "key", "project": "project"}
    monkeypatch.setenv("WEAVE_DISABLED", "true")
    captured = json.loads(json.dumps(resolve_provider_config("weave", config)))
    monkeypatch.setenv("WEAVE_DISABLED", "false")
    enabled = resolve_provider_config("weave", config)
    assert provider_config_identity("weave", captured) != provider_config_identity("weave", enabled)
    monkeypatch.setattr(WeaveConfig, "load_runtime_settings", Mock(side_effect=AssertionError("snapshot reread")))
    request = Mock(side_effect=AssertionError("disabled tracing sent a request"))
    monkeypatch.setattr("core.ops.provider_export.ssrf_proxy.make_request", request)
    client = WeaveTraceClient(captured)
    trace = make_completed_trace()
    receipt = client.export_trace(trace)
    assert client.export_trace(trace) == receipt
    assert not client.verify_credentials()
    assert client.get_project_url() == "https://wandb.ai/"
    assert set(receipt.spans) == {span.span_id for span in trace.spans}
    assert all(parent["disabled"] is True for parent in receipt.spans.values())
    parent = receipt.spans[trace.root_span_id]
    child = make_completed_trace()
    child_receipt = WeaveTraceClient(enabled).export_trace(child, parent)
    assert all(
        span["disabled"] is True and span["trace_id"] == parent["trace_id"] for span in child_receipt.spans.values()
    )
    request.assert_not_called()


def test_enabled_snapshot_exports_after_worker_switch_is_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    config = {"api_key": "key", "entity": "team", "project": "project"}
    captured = json.loads(json.dumps(resolve_provider_config("weave", config)))
    monkeypatch.setenv("WEAVE_DISABLED", "true")
    monkeypatch.setattr(WeaveConfig, "load_runtime_settings", Mock(side_effect=AssertionError("snapshot reread")))
    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"data": {"project": {"name": "project"}}})

    monkeypatch.setattr(
        "core.ops.provider_export.ssrf_proxy.create_http_client",
        lambda *, ssl_context: httpx.Client(
            verify=ssl_context, transport=httpx.MockTransport(respond), trust_env=False
        ),
    )
    client = WeaveTraceClient(captured)
    trace = make_completed_trace()
    assert client.verify_credentials()
    receipt = client.export_trace(trace)
    assert all("disabled" not in parent for parent in receipt.spans.values())
    assert [request.url.path for request in requests] == [
        "/graphql",
        "/calls/query_stats",
        *["/v2/team/project/calls/complete"] * len(trace.spans),
    ]
