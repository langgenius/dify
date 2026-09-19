import json
import math
from unittest.mock import Mock

import httpx
import pytest
from dify_trace_weave.config import WeaveConfig
from dify_trace_weave.weave_trace import WeaveTraceClient

from core.ops.provider_config import provider_config_identity, resolve_provider_config
from core.ops.provider_export import TraceExportError
from tests.unit_tests.core.ops.test_provider_export import make_completed_trace


@pytest.mark.parametrize("setting", [None, "", "45.5", " 60 ", "0", "-1", "inf", "-inf", "nan"])
def test_trace_timeout_keeps_sdk_float_parsing_in_json_safe_snapshots(
    setting: str | None, monkeypatch: pytest.MonkeyPatch
) -> None:
    if setting is not None:
        monkeypatch.setenv("WEAVE_HTTP_TIMEOUT", setting)
    captured = json.loads(
        json.dumps(resolve_provider_config("weave", {"api_key": "key", "project": "project"}), allow_nan=False)
    )
    expected = float(setting or 30)
    timeout = WeaveTraceClient(captured).http.request_timeout
    if math.isnan(expected):
        assert math.isnan(timeout)
    else:
        assert timeout == expected


@pytest.mark.parametrize("setting", [" ", "invalid", "1s"])
def test_invalid_sdk_float_settings_fail_at_resolution(setting: str, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("WEAVE_HTTP_TIMEOUT", setting)
    with pytest.raises(ValueError):
        resolve_provider_config("weave", {"api_key": "key", "project": "project"})


@pytest.mark.parametrize(
    ("setting", "timeout"), [(None, 30), ("", 30), ("72.5", 72.5), ("inf", math.inf), ("nan", math.nan)]
)
@pytest.mark.parametrize("remaining", [90, 3])
def test_captured_trace_and_native_account_timeouts_reach_requests_without_extending_deadline(
    setting: str | None, timeout: float, remaining: int, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("core.ops.provider_export.monotonic", lambda: 100.0)
    if setting is not None:
        monkeypatch.setenv("WEAVE_HTTP_TIMEOUT", setting)
    config = {"api_key": "key", "entity": "team", "project": "project"}
    captured = json.loads(json.dumps(resolve_provider_config("weave", config), allow_nan=False))
    monkeypatch.setenv("WEAVE_HTTP_TIMEOUT", "12")
    changed = resolve_provider_config("weave", config)
    assert provider_config_identity("weave", captured) != provider_config_identity("weave", changed)
    monkeypatch.setenv("WEAVE_HTTP_TIMEOUT", "invalid")
    monkeypatch.setenv("WANDB_HTTP_TIMEOUT", "77")
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
    client.http.deadline = 100.0 + remaining
    assert client.verify_credentials()
    trace = make_completed_trace()
    assert len(client.export_trace(trace).spans) == len(trace.spans)
    assert len(requests) == 3
    for request in requests:
        expected = min(remaining, 5 if request.url.host == "api.wandb.ai" else timeout)
        assert request.extensions["timeout"] == dict.fromkeys(("connect", "read", "write", "pool"), expected)
    assert client.account_http.deadline == client.http.deadline == 100.0 + remaining
    monkeypatch.setattr("core.ops.provider_export.monotonic", lambda: client.http.deadline)
    with pytest.raises(TraceExportError, match="export_deadline_exceeded"):
        client.verify_credentials()
