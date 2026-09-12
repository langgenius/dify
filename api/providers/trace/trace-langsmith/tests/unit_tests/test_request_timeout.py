import httpx
import pytest
from dify_trace_langsmith.langsmith_trace import LangSmithTraceClient

from core.ops.provider_export import TraceExportError
from tests.unit_tests.core.ops.test_provider_export import make_completed_trace


@pytest.mark.parametrize("operation", ["verify", "project", "export"])
@pytest.mark.parametrize("remaining", [90, 45, 5])
def test_native_request_timeouts_keep_connection_and_read_limits_within_deadline(
    operation: str, remaining: int, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("core.ops.provider_export.monotonic", lambda: 100.0)
    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json=[{"id": "project-id", "tenant_id": "workspace-id"}])

    monkeypatch.setattr(
        "core.ops.provider_export.ssrf_proxy.create_http_client",
        lambda *, ssl_context: httpx.Client(
            verify=ssl_context, transport=httpx.MockTransport(respond), trust_env=False
        ),
    )
    client = LangSmithTraceClient({"api_key": "key", "project": "project"})
    client.http.deadline = 100.0 + remaining
    if operation == "verify":
        assert client.verify_credentials()
    elif operation == "project":
        assert client.get_project_url().endswith("/o/workspace-id/projects/p/project-id")
    else:
        trace = make_completed_trace()
        assert len(client.export_trace(trace).spans) == len(trace.spans)
    assert requests
    for request in requests:
        assert request.extensions["timeout"] == {
            "connect": min(10, remaining),
            "read": min(60, remaining),
            "write": min(60, remaining),
            "pool": min(60, remaining),
        }
    assert client.http.deadline == 100.0 + remaining
    monkeypatch.setattr("core.ops.provider_export.monotonic", lambda: client.http.deadline)
    with pytest.raises(TraceExportError, match="export_deadline_exceeded"):
        client.verify_credentials()
