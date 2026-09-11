import json
import ssl
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from time import monotonic
from typing import Any
from unittest.mock import Mock

import httpx
import pytest
from dify_trace_weave.config import WeaveConfig
from dify_trace_weave.weave_trace import WeaveTraceClient

from core.ops.provider_config import resolve_provider_config
from core.ops.provider_export import TraceExportError, basic_auth
from tests.unit_tests.core.ops.test_provider_export import make_completed_trace


@pytest.mark.parametrize("new_project", [False, True])
@pytest.mark.parametrize("operation", ["verify_credentials", "export_trace"])
def test_project_lookup_and_creation_use_canonical_name(
    monkeypatch: pytest.MonkeyPatch, new_project: bool, operation: str
) -> None:
    requests: list[tuple[str, dict[str, Any]]] = []

    def respond(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        requests.append((request.url.path, body))
        query = body.get("query", "")
        if "viewer" in query:
            return httpx.Response(200, json={"data": {"viewer": {"entity": "team"}}})
        if "upsertModel" in query:
            return httpx.Response(200, json={"data": {"upsertModel": {"model": {"name": "canonical-name"}}}})
        if "project(" in query:
            return httpx.Response(200, json={"data": {"project": None if new_project else {"name": "canonical-name"}}})
        return httpx.Response(200, json={})

    monkeypatch.setattr(
        "core.ops.provider_export.ssrf_proxy.create_http_client",
        lambda *, ssl_context: httpx.Client(transport=httpx.MockTransport(respond), trust_env=False),
    )
    client = WeaveTraceClient({"api_key": "key", "project": "Requested Name", "host": "https://account.example/prefix"})
    if operation == "verify_credentials":
        assert client.verify_credentials()
        assert requests[-1] == ("/prefix/traces/calls/query_stats", {"project_id": "team/canonical-name"})
    else:
        client.export_trace(make_completed_trace())
        assert all(body["batch"][0]["project_id"] == "team/canonical-name" for _, body in requests if "batch" in body)
        assert requests[-1][0] == "/prefix/traces/v2/team/canonical-name/calls/complete"
    account_requests = [body for path, body in requests if path == "/prefix/graphql"]
    assert len(account_requests) == (3 if new_project else 2)
    assert "viewer" in account_requests[0]["query"]
    assert "project(" in account_requests[1]["query"]
    assert account_requests[1]["variables"] == {"entity": "team", "name": "Requested Name"}
    if new_project:
        assert "upsertModel" in account_requests[2]["query"]
        assert account_requests[2]["variables"] == account_requests[1]["variables"]
    requests.clear()
    assert client.get_project_url() == "https://account.example/prefix/team/canonical-name/weave"
    assert client.verify_credentials()
    assert len(requests) == 1


@pytest.mark.parametrize(
    ("response", "reason"),
    [
        (httpx.Response(200, text="invalid"), "weave_account_response_invalid"),
        (httpx.Response(200, json={"data": {}}), "weave_account_response_invalid"),
        (
            httpx.Response(200, json={"data": {"project": None}, "errors": [{"message": "secret details"}]}),
            "weave_account_query_failed",
        ),
        (httpx.Response(200, json={"data": {"project": {"name": ""}}}), "weave_project_unavailable"),
        (httpx.Response(403), "provider_http_403"),
        (httpx.Response(503), "provider_http_503"),
    ],
)
def test_project_lookup_errors_do_not_create_or_ingest(
    monkeypatch: pytest.MonkeyPatch, response: httpx.Response, reason: str
) -> None:
    request = Mock(return_value=response)
    monkeypatch.setattr("core.ops.provider_export.ssrf_proxy.make_request", request)
    client = WeaveTraceClient({"api_key": "key", "entity": "team", "project": "project"})
    with pytest.raises(TraceExportError, match=reason):
        client.export_trace(make_completed_trace())
    request.assert_called_once()
    assert request.call_args.args[1] == "https://api.wandb.ai/graphql"
    assert "upsertModel" not in request.call_args.kwargs["json"]["query"]


@pytest.mark.parametrize(
    "result",
    [
        {"data": {"upsertModel": None}},
        {"data": {"upsertModel": {"model": None}}},
        {"data": {"upsertModel": {"model": {"name": "wrong/project"}}}},
        {"data": {"upsertModel": None}, "errors": [{"message": "creation denied"}]},
    ],
)
def test_failed_creation_is_not_cached_or_exported(monkeypatch: pytest.MonkeyPatch, result: dict[str, Any]) -> None:
    request = Mock(
        side_effect=[
            httpx.Response(200, json={"data": {"project": None}}),
            httpx.Response(200, json=result),
            httpx.Response(200, json={"data": {"project": {"name": "project"}}}),
            httpx.Response(200, json={}),
        ]
    )
    monkeypatch.setattr("core.ops.provider_export.ssrf_proxy.make_request", request)
    client = WeaveTraceClient({"api_key": "key", "entity": "team", "project": "project"})
    with pytest.raises(TraceExportError):
        client.verify_credentials()
    assert request.call_count == 2
    assert client.verify_credentials()
    assert "project(" in request.call_args_list[2].kwargs["json"]["query"]


def test_two_owned_clients_keep_account_auth_tls_deadline_and_project_separate(monkeypatch: pytest.MonkeyPatch) -> None:
    clients: list[WeaveTraceClient] = []
    for owner in ("first", "second"):
        monkeypatch.setenv("WANDB_BASE_URL", f"https://{owner}-account.example")
        monkeypatch.setenv("WF_TRACE_SERVER_URL", f"https://{owner}-ingest.example")
        config = resolve_provider_config("weave", {"api_key": f"{owner}-key", "project": "project"})
        clients.append(WeaveTraceClient(config))
    monkeypatch.setattr(WeaveConfig, "load_runtime_settings", Mock(side_effect=AssertionError("snapshot reread")))
    monkeypatch.setenv("WANDB_API_KEY", "unrelated-key")
    monkeypatch.setenv("WANDB_BASE_URL", "https://unrelated.example")
    requests: dict[str, list[tuple[str, dict[str, Any]]]] = {"first": [], "second": []}
    first_request = Barrier(2)

    def request(method: str, url: str, **kwargs: Any) -> httpx.Response:
        owner = "first" if "first-" in url else "second"
        requests[owner].append((url, kwargs))
        query = kwargs["json"].get("query", "")
        if "viewer" in query:
            first_request.wait(timeout=5)
            return httpx.Response(200, json={"data": {"viewer": {"entity": f"{owner}-team"}}})
        if "project(" in query:
            return httpx.Response(200, json={"data": {"project": None}})
        if "upsertModel" in query:
            return httpx.Response(200, json={"data": {"upsertModel": {"model": {"name": f"{owner}-project"}}}})
        return httpx.Response(200, json={})

    contexts: dict[str, list[ssl.SSLContext | None]] = {"first": [], "second": []}
    context_owners = {
        ssl_context: owner
        for owner, client in zip(("first", "second"), clients, strict=True)
        for ssl_context in (client.account_ssl_context, client.http.ssl_context)
    }

    def create_client(*, ssl_context: ssl.SSLContext | None = None) -> httpx.Client:
        contexts[context_owners[ssl_context]].append(ssl_context)
        return httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(500)), trust_env=False)

    monkeypatch.setattr("core.ops.provider_export.ssrf_proxy.make_request", request)
    monkeypatch.setattr("core.ops.provider_export.ssrf_proxy.create_http_client", create_client)
    for index, client in enumerate(clients):
        client.http.deadline = monotonic() + 8 + index
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = [executor.submit(client.verify_credentials) for client in clients]
        assert all(result.result(timeout=6) for result in results)
    for index, client in enumerate(clients):
        owner = "first" if index == 0 else "second"
        assert client.account_http.deadline == client.http.deadline
        assert client.get_project_url() == f"https://{owner}-account.example/{owner}-team/{owner}-project/weave"
        owned_requests = requests[owner]
        assert [url for url, _ in owned_requests] == [f"https://{owner}-account.example/graphql"] * 3 + [
            f"https://{owner}-ingest.example/calls/query_stats"
        ]
        assert owned_requests[1][1]["json"]["variables"] == {"entity": f"{owner}-team", "name": "project"}
        assert owned_requests[-1][1]["json"] == {"project_id": f"{owner}-team/{owner}-project"}
        assert contexts[owner] == [client.account_ssl_context] * 3 + [client.http.ssl_context]
        for _, kwargs in owned_requests:
            assert kwargs["headers"]["Authorization"] == basic_auth("api", f"{owner}-key")
            assert 0 < kwargs["timeout"] <= 8 + index
            assert kwargs["follow_redirects"] is False
            assert kwargs["max_retries"] == 0
    assert clients[0].account_http is not clients[1].account_http
    assert clients[0].account_http.headers is not clients[1].account_http.headers


def test_project_setup_obeys_export_deadline(monkeypatch: pytest.MonkeyPatch) -> None:
    client = WeaveTraceClient({"api_key": "key", "entity": "team", "project": "project"})
    request = Mock()
    monkeypatch.setattr("core.ops.provider_export.ssrf_proxy.make_request", request)
    client.http.deadline = monotonic() - 1
    with pytest.raises(TraceExportError, match="export_deadline_exceeded"):
        client.verify_credentials()
    request.assert_not_called()


def test_qualified_project_precedes_captured_default_entity(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("WANDB_ENTITY", "ambient-team")
    config = resolve_provider_config("weave", {"api_key": "key", "project": "explicit-team/project"})
    monkeypatch.setenv("WANDB_ENTITY", "changed-team")
    client = WeaveTraceClient(config)
    request = Mock(return_value=httpx.Response(200, json={"data": {"project": {"name": "project"}}}))
    monkeypatch.setattr("core.ops.provider_export.ssrf_proxy.make_request", request)
    assert client.verify_credentials()
    assert request.call_args_list[0].kwargs["json"]["variables"] == {"entity": "explicit-team", "name": "project"}
    assert "viewer" not in request.call_args_list[0].kwargs["json"]["query"]
    assert client.get_project_url() == "https://wandb.ai/explicit-team/project/weave"
