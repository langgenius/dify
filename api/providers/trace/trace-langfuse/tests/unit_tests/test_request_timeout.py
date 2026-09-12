from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest.mock import Mock

import httpx
import pytest
from dify_trace_langfuse.config import LangfuseConfig
from dify_trace_langfuse.langfuse_trace import LangfuseTraceClient

from core.ops.provider_config import resolve_provider_config
from core.ops.provider_export import TraceExportError, basic_auth
from tests.unit_tests.core.ops.test_provider_export import make_completed_trace


@pytest.mark.parametrize("operation", ["verify", "project", "export"])
@pytest.mark.parametrize(("setting", "expected_timeout"), [(None, 5), ("60", 60)])
def test_configured_timeout_reaches_project_and_observation_requests(
    monkeypatch: pytest.MonkeyPatch, operation: str, setting: str | None, expected_timeout: int
) -> None:
    if setting is None:
        monkeypatch.delenv("LANGFUSE_TIMEOUT", raising=False)
    else:
        monkeypatch.setenv("LANGFUSE_TIMEOUT", setting)
    config = resolve_provider_config("langfuse", {"public_key": "public", "secret_key": "secret"})
    monkeypatch.setenv("LANGFUSE_TIMEOUT", "1")
    monkeypatch.setattr(LangfuseConfig, "load_runtime_settings", Mock(side_effect=AssertionError("snapshot reread")))
    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path == "/api/public/projects":
            return httpx.Response(200, json={"data": [{"id": "project"}]})
        assert request.url.path == "/api/public/otel/v1/traces"
        return httpx.Response(200, content=b"")

    monkeypatch.setattr(
        "core.ops.provider_export.ssrf_proxy.create_http_client",
        lambda: httpx.Client(transport=httpx.MockTransport(respond), trust_env=False),
    )
    client = LangfuseTraceClient(config)
    if operation == "verify":
        assert client.verify_credentials()
    elif operation == "project":
        assert client.get_project_url() == "https://cloud.langfuse.com/project/project"
    else:
        trace = make_completed_trace()
        original = trace.model_dump_json()
        assert set(client.export_trace(trace).spans) == {span.span_id for span in trace.spans}
        assert trace.model_dump_json() == original

    assert len(requests) == 1
    assert requests[0].extensions["timeout"] == dict.fromkeys(("connect", "read", "write", "pool"), expected_timeout)
    assert requests[0].headers["Authorization"] == basic_auth("public", "secret")


def test_timeout_cannot_extend_export_deadline(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LANGFUSE_TIMEOUT", "60")
    monkeypatch.setattr("core.ops.provider_export.monotonic", lambda: 100.0)
    request = Mock(return_value=httpx.Response(200, content=b""))
    monkeypatch.setattr("core.ops.provider_export.ssrf_proxy.make_request", request)
    client = LangfuseTraceClient({"public_key": "public", "secret_key": "secret"})
    client.http.deadline = 140

    client.export_trace(make_completed_trace())

    assert request.call_args.kwargs["timeout"] == 40
    assert client.http.deadline == 140
    monkeypatch.setattr("core.ops.provider_export.monotonic", lambda: 141.0)
    with pytest.raises(TraceExportError, match="export_deadline_exceeded"):
        client.export_trace(make_completed_trace())
    request.assert_called_once()


def test_concurrent_clients_keep_captured_timeouts_and_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    clients: list[LangfuseTraceClient] = []
    for owner, timeout in (("first", 60), ("second", 12)):
        monkeypatch.setenv("LANGFUSE_TIMEOUT", str(timeout))
        clients.append(
            LangfuseTraceClient(
                resolve_provider_config(
                    "langfuse",
                    {"public_key": owner, "secret_key": f"{owner}-secret", "host": f"https://{owner}.example"},
                )
            )
        )
    monkeypatch.setenv("LANGFUSE_TIMEOUT", "invalid")
    entered = Barrier(2)
    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        entered.wait(timeout=5)
        return httpx.Response(200, content=b"")

    monkeypatch.setattr(
        "core.ops.provider_export.ssrf_proxy.create_http_client",
        lambda: httpx.Client(transport=httpx.MockTransport(respond), trust_env=False),
    )
    traces = [make_completed_trace(), make_completed_trace()]
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = [executor.submit(client.export_trace, trace) for client, trace in zip(clients, traces, strict=True)]
        assert all(result.result(timeout=8).spans for result in results)

    assert len(requests) == 2
    for request in requests:
        owner = "first" if request.url.host == "first.example" else "second"
        assert request.extensions["timeout"]["read"] == (60 if owner == "first" else 12)
        assert request.headers["Authorization"] == basic_auth(owner, f"{owner}-secret")
    assert clients[0].http is not clients[1].http


@pytest.mark.parametrize("setting", ["", "sixty", "1.5"])
def test_invalid_timeout_keeps_integer_configuration_contract(monkeypatch: pytest.MonkeyPatch, setting: str) -> None:
    monkeypatch.setenv("LANGFUSE_TIMEOUT", setting)
    with pytest.raises(ValueError):
        LangfuseTraceClient({"public_key": "public", "secret_key": "secret"})
