"""Readiness may repeat only credential-free schema metadata, never inference."""

import json
import time
from collections.abc import Callable, Generator
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from typing import TypedDict, override

import pytest
from pydantic import JsonValue
from yarl import URL

from core.plugin.impl import base
from core.plugin.impl.exc import PluginInvokeError
from core.plugin.impl.model import PluginModelClient
from graphon.model_runtime.errors.invoke import (
    InvokeAuthorizationError,
    InvokeRateLimitError,
    InvokeServerUnavailableError,
)

IDENTIFIER = "org/plugin:1.0.0@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
GATEWAY_MESSAGE = (
    "Error sending request to serverless: all 3 attempts failed, last error: attempt 3/3 failed with status code: 502"
)
SCHEMA: dict[str, JsonValue] = {
    "model": "static-model",
    "label": {"en_US": "Static"},
    "model_type": "llm",
    "fetch_from": "predefined-model",
    "model_properties": {},
}


class _CapturedRequest(TypedDict):
    path: str
    headers: dict[str, str]
    body: JsonValue


def _error(message: str = GATEWAY_MESSAGE, error_type: str = "PluginDaemonInnerError") -> dict[str, JsonValue]:
    return {
        "code": -500,
        "message": json.dumps(
            {"error_type": "PluginInvokeError", "message": json.dumps({"error_type": error_type, "message": message})}
        ),
        "data": None,
    }


@contextmanager
def _daemon(
    responses: list[dict[str, JsonValue]],
    *,
    on_request: Callable[[], None] | None = None,
    status: int = 200,
    stream_fragment: bytes | None = None,
    first_response_delay: float = 0,
) -> Generator[tuple[str, list[_CapturedRequest]]]:
    requests: list[_CapturedRequest] = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:
            size = int(self.headers["Content-Length"])
            requests.append(
                {"path": self.path, "headers": dict(self.headers), "body": json.loads(self.rfile.read(size))}
            )
            if on_request is not None:
                on_request()
            if len(requests) == 1:
                time.sleep(first_response_delay)
            response = responses[min(len(requests) - 1, len(responses) - 1)]
            payload = ("data: " + json.dumps(response) + "\n\n").encode()
            self.send_response(status)
            self.send_header("Content-Type", "text/event-stream")
            if stream_fragment is None:
                self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            if stream_fragment is None:
                self.wfile.write(payload)
            else:
                stop_at = time.monotonic() + 0.8
                while time.monotonic() < stop_at:
                    try:
                        self.wfile.write(stream_fragment)
                        self.wfile.flush()
                    except (BrokenPipeError, ConnectionResetError):
                        return
                    time.sleep(0.02)

        @override
        def log_message(self, format: str, *args: object) -> None:
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}", requests
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def _ready(client: PluginModelClient, check: Callable[[], None] = lambda: None) -> None:
    client.ensure_model_metadata_ready(
        tenant_id="tenant",
        user_id="member",
        plugin_id="org/plugin",
        provider="provider",
        model="static-model",
        plugin_unique_identifier=IDENTIFIER,
        check=check,
    )


def test_loopback_repeats_only_pinned_credential_free_metadata_after_exact_gateway_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with _daemon([_error(), {"code": 0, "message": "", "data": {"model_schema": SCHEMA}}]) as (url, requests):
        monkeypatch.setattr(base, "plugin_daemon_inner_api_baseurl", URL(url))
        _ready(PluginModelClient())
    assert len(requests) == 2
    assert requests[0] == requests[1]
    assert requests[0]["path"] == "/plugin/tenant/dispatch/model/schema"
    assert requests[0]["headers"]["X-Plugin-Unique-Identifier"] == IDENTIFIER
    assert "X-Api-Key" in requests[0]["headers"]
    assert requests[0]["body"] == {
        "user_id": "member",
        "data": {"provider": "provider", "model_type": "llm", "model": "static-model", "credentials": {}},
    }


@pytest.mark.parametrize(
    ("message", "error_type"),
    [
        (GATEWAY_MESSAGE, "InvokeServerUnavailableError"),
        (GATEWAY_MESSAGE, "InvokeAuthorizationError"),
        (GATEWAY_MESSAGE, "InvokeRateLimitError"),
        ("provider says 502", "PluginDaemonInnerError"),
        ("copied: " + GATEWAY_MESSAGE, "PluginDaemonInnerError"),
        (GATEWAY_MESSAGE + " extra", "PluginDaemonInnerError"),
        (GATEWAY_MESSAGE.replace("3/3", "2/3"), "PluginDaemonInnerError"),
        (GATEWAY_MESSAGE * 30, "PluginDaemonInnerError"),
    ],
)
def test_provider_or_unclassified_metadata_failure_never_authorizes_another_read(
    monkeypatch: pytest.MonkeyPatch, message: str, error_type: str
) -> None:
    with _daemon([_error(message, error_type)]) as (url, requests):
        monkeypatch.setattr(base, "plugin_daemon_inner_api_baseurl", URL(url))
        with pytest.raises(
            (PluginInvokeError, InvokeAuthorizationError, InvokeRateLimitError, InvokeServerUnavailableError)
        ):
            _ready(PluginModelClient())
    assert len(requests) == 1


def test_gateway_metadata_retry_exhaustion_is_bounded(monkeypatch: pytest.MonkeyPatch) -> None:
    from services.dify_builder.trace_diagnostics import failure_reason

    with _daemon([_error()]) as (url, requests):
        monkeypatch.setattr(base, "plugin_daemon_inner_api_baseurl", URL(url))
        with pytest.raises(InvokeServerUnavailableError) as caught:
            _ready(PluginModelClient())
    assert len(requests) == 2
    assert failure_reason(caught.value) == "service_unavailable"


def test_generic_http_502_does_not_authorize_metadata_retry(monkeypatch: pytest.MonkeyPatch) -> None:
    with _daemon([{"error": "Bad Gateway"}], status=502) as (url, requests):
        monkeypatch.setattr(base, "plugin_daemon_inner_api_baseurl", URL(url))
        with pytest.raises(ValueError, match="Bad Gateway"):
            _ready(PluginModelClient())
    assert len(requests) == 1


def test_revocation_after_first_metadata_response_prevents_retry(monkeypatch: pytest.MonkeyPatch) -> None:
    with _daemon([_error()]) as (url, requests):
        monkeypatch.setattr(base, "plugin_daemon_inner_api_baseurl", URL(url))

        def check() -> None:
            if requests:
                raise PermissionError("permission expired")

        with pytest.raises(PermissionError, match="permission expired"):
            _ready(PluginModelClient(), check)
    assert len(requests) == 1


def test_metadata_schema_for_another_model_fails_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    response: dict[str, JsonValue] = {"code": 0, "message": "", "data": {"model_schema": {**SCHEMA, "model": "other"}}}
    with _daemon([response]) as (url, requests):
        monkeypatch.setattr(base, "plugin_daemon_inner_api_baseurl", URL(url))
        with pytest.raises(ValueError, match="schema"):
            _ready(PluginModelClient())
    assert len(requests) == 1


def test_elapsed_metadata_budget_prevents_another_request(monkeypatch: pytest.MonkeyPatch) -> None:
    from core.plugin.impl import model

    now = [0.0]

    class BudgetClock:
        @staticmethod
        def monotonic() -> float:
            return now[0]

        @staticmethod
        def sleep(_seconds: float) -> None:
            pass

    monkeypatch.setattr(model, "time", BudgetClock)
    with _daemon([_error()], on_request=lambda: now.__setitem__(0, 11.0)) as (url, requests):
        monkeypatch.setattr(base, "plugin_daemon_inner_api_baseurl", URL(url))
        with pytest.raises(InvokeServerUnavailableError):
            _ready(PluginModelClient())
    assert len(requests) == 1


@pytest.mark.parametrize("fragment", [b"\n", b" "])
def test_blank_or_partial_metadata_heartbeats_cannot_hide_the_body_deadline(
    monkeypatch: pytest.MonkeyPatch, fragment: bytes
) -> None:
    from core.plugin.impl import model

    monkeypatch.setattr(model, "_MODEL_METADATA_READINESS_BUDGET_SECONDS", 0.25)
    with _daemon([{}], stream_fragment=fragment) as (url, requests):
        monkeypatch.setattr(base, "plugin_daemon_inner_api_baseurl", URL(url))
        started = time.monotonic()
        with pytest.raises(InvokeServerUnavailableError):
            _ready(PluginModelClient())
        elapsed = time.monotonic() - started
    assert elapsed < 0.65
    assert len(requests) == 1


def test_legitimate_delayed_first_gateway_envelope_still_allows_the_single_metadata_retry(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with _daemon(
        [_error(), {"code": 0, "message": "", "data": {"model_schema": SCHEMA}}], first_response_delay=1.2
    ) as (url, requests):
        monkeypatch.setattr(base, "plugin_daemon_inner_api_baseurl", URL(url))
        _ready(PluginModelClient())
    assert len(requests) == 2


def test_metadata_response_byte_limit_does_not_change_other_stream_consumers(monkeypatch: pytest.MonkeyPatch) -> None:
    payload: dict[str, JsonValue] = {"error": "x" * (1024 * 1024)}
    with _daemon([payload]) as (url, requests):
        monkeypatch.setattr(base, "plugin_daemon_inner_api_baseurl", URL(url))
        client = PluginModelClient()
        with pytest.raises(ValueError, match="metadata response exceeds its byte limit"):
            _ready(client)
        # Same pooled stream owner outside the explicit metadata scope retains
        # its original response contract and no metadata size restriction.
        lines = list(client._stream_request("POST", "ordinary", headers={"Content-Type": "application/json"}, data={}))
    assert len(requests) == 2
    assert len(lines) == 1
    assert json.loads(lines[0]) == payload
