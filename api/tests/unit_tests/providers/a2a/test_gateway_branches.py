"""Adversarial wire contracts through real loopback TCP and the bounded transport.

The explicit HTTP loopback allowance belongs only to this injected test peer.
Neither protocol failures nor authentication failures authorize another Send.
"""

import json
from collections import deque
from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import replace
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from typing import override

import httpx
import pytest

from providers.a2a.gateway import DEFAULT_GATEWAY_LIMITS, A2AGateway, GatewayLimits, checked_url
from providers.a2a.transport import BoundedTransport
from services.external_agents.protocol import (
    TRACEABILITY_URI,
    Authentication,
    BearerAuth,
    ConnectionSpec,
    GatewayError,
    GatewayReceipt,
    NoAuth,
    SealedBearerAuth,
    SendRequest,
)
from tests.unit_tests.providers.a2a.test_gateway import card, connection, gateway, response, send_request, task
from tests.unit_tests.providers.a2a.test_https_fixture import VerifiedHTTPSRequester

_NO_AUTH = NoAuth()


class WirePeer(ThreadingHTTPServer):
    """A real HTTP peer serving an explicit, finite sequence of wire responses."""

    def __init__(self, replies: list[httpx.Response]) -> None:
        super().__init__(("127.0.0.1", 0), WireHandler)
        self.replies = deque(replies)
        self.requests: list[tuple[str, str, bytes, dict[str, str]]] = []


class WireHandler(BaseHTTPRequestHandler):
    @override
    def log_message(self, format: str, *args: object) -> None:
        """Keep peer URLs and test authentication out of captured logs."""

    def do_GET(self) -> None:
        self.respond()

    def do_POST(self) -> None:
        self.respond()

    def respond(self) -> None:
        assert isinstance(self.server, WirePeer)
        body = self.rfile.read(int(self.headers.get("content-length", "0")))
        self.server.requests.append((self.command, self.path, body, dict(self.headers)))
        reply = self.server.replies.popleft()
        self.send_response(reply.status_code)
        for key, value in reply.headers.items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(reply.content)
        self.wfile.flush()
        self.close_connection = True


@contextmanager
def wire(
    replies: list[httpx.Response],
    *,
    auth: Authentication = _NO_AUTH,
    limits: GatewayLimits = DEFAULT_GATEWAY_LIMITS,
) -> Generator[tuple[A2AGateway, ConnectionSpec, WirePeer]]:
    """Own the client/server lifetime; requests use no redirects or retries."""
    server = WirePeer(replies)
    thread = Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
    thread.start()
    endpoint = f"http://127.0.0.1:{server.server_port}"
    try:
        with httpx.Client(trust_env=False) as client:
            adapter = A2AGateway(
                BoundedTransport(VerifiedHTTPSRequester(client)), allow_loopback_http=True, limits=limits
            )
            yield (
                adapter,
                ConnectionSpec(endpoint=endpoint, interface_url=endpoint + "/a2a", authentication=auth),
                server,
            )
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def stream(*events: object) -> httpx.Response:
    payload = b"".join(
        value if isinstance(value, bytes) else f"data: {json.dumps(value)}\n\n".encode() for value in events
    )
    return httpx.Response(200, content=payload, headers={"content-type": "text/event-stream"})


@pytest.mark.parametrize("token", ["", " ", "token\rsecret", "token\nsecret", "token\x00secret", "x" * 65537])
def test_unsafe_bearer_is_rejected_before_any_network(token: str) -> None:
    adapter, egress = gateway([])
    with pytest.raises(GatewayError) as failure:
        adapter.send(connection(BearerAuth(token)), send_request(), streaming=False)
    assert failure.value.code == "invalid_credential"
    assert not egress.requests


def test_missing_credential_decoder_and_unknown_extensions_never_send() -> None:
    adapter, egress = gateway([])
    for spec, code in [
        (connection(SealedBearerAuth("tenant", "ciphertext")), "credential_unavailable"),
        (replace(connection(), enabled_extensions=("https://unsupported.example/extension",)), "extension_unsupported"),
    ]:
        with pytest.raises(GatewayError) as failure:
            adapter.send(spec, send_request(), streaming=False)
        assert failure.value.code == code
    assert not egress.requests


@pytest.mark.parametrize(
    "endpoint", ["https://agent.example:0", "https://agent.example:65536", "https://agent.example:bad"]
)
def test_invalid_ports_cannot_bypass_url_admission(endpoint: str) -> None:
    with pytest.raises(GatewayError, match="HTTPS"):
        checked_url(endpoint)
    assert checked_url("http://localhost:8000/", allow_loopback_http=True) == "http://localhost:8000"


def test_unverified_binding_and_invalid_input_do_not_reach_network() -> None:
    adapter, egress = gateway([])
    with pytest.raises(GatewayError) as missing:
        adapter.send(replace(connection(), interface_url=None), send_request(), streaming=False)
    assert missing.value.code == "connection_not_verified"
    with pytest.raises(GatewayError) as invalid:
        adapter.send(connection(), SendRequest(message_id="m", parts=()), streaming=False)
    assert invalid.value.code == "invalid_request"
    assert not egress.requests


@pytest.mark.parametrize("requirement", ["bearer", "basic", "missing", "anonymous", "no_auth"])
def test_verify_negotiates_declared_auth_without_an_execution_probe(requirement: str) -> None:
    auth = NoAuth() if requirement == "no_auth" else BearerAuth("private-token")
    with wire([], auth=auth) as (adapter, spec, peer):
        document = card()
        document["supportedInterfaces"] = [
            {"url": spec.interface_url, "protocolBinding": "HTTP+JSON", "protocolVersion": "1.0"}
        ]
        security_schemes: dict[str, object] = (
            {}
            if requirement == "missing"
            else {"auth": {"httpAuthSecurityScheme": {"scheme": "bearer" if requirement == "no_auth" else requirement}}}
        )
        document["securitySchemes"] = security_schemes
        schemes: dict[str, object] = {} if requirement == "anonymous" else {"auth": {"list": list[str]()}}
        document["securityRequirements"] = [{"schemes": schemes}]
        peer.replies.append(response(document))
        if requirement in {"bearer", "anonymous"}:
            result = adapter.verify(spec)
            assert result.auth_check == "not_exercised"
        else:
            with pytest.raises(GatewayError) as failure:
                adapter.verify(spec)
            assert failure.value.code == "authentication_incompatible"
        assert len(peer.requests) == 1
        assert peer.requests[0][0] == "GET"


def test_public_extended_card_does_not_prove_execution_authentication() -> None:
    with wire([]) as (adapter, spec, peer):
        document = card(extended=True)
        document["supportedInterfaces"] = [
            {"url": spec.interface_url, "protocolBinding": "HTTP+JSON", "protocolVersion": "1.0"}
        ]
        peer.replies.extend((response(document), response(document)))
        assert adapter.verify(spec).auth_check == "not_exercised"
        assert [request[0] for request in peer.requests] == ["GET", "GET"]


@pytest.mark.parametrize("problem", ["invalid_card", "unsupported_binding", "protected_card", "reflected_interface"])
def test_verify_rejects_invalid_or_incompatible_cards_without_sending(problem: str) -> None:
    with wire([], auth=BearerAuth("private-token")) as (adapter, spec, peer):
        document = card(extended=problem == "protected_card")
        document["supportedInterfaces"] = [
            {
                "url": spec.endpoint + ("/private-token" if problem == "reflected_interface" else "/a2a"),
                "protocolBinding": "gRPC" if problem == "unsupported_binding" else "HTTP+JSON",
                "protocolVersion": "1.0",
            }
        ]
        peer.replies.append(response({} if problem == "invalid_card" else document))
        if problem == "protected_card":
            peer.replies.append(response({}))
        with pytest.raises(GatewayError) as failure:
            adapter.verify(spec)
        assert (
            failure.value.code
            == {
                "invalid_card": "invalid_agent_card",
                "unsupported_binding": "profile_unsupported",
                "protected_card": "invalid_agent_card",
                "reflected_interface": "credential_reflection",
            }[problem]
        )
        assert all(request[0] == "GET" for request in peer.requests)
        assert len(peer.requests) == (2 if problem == "protected_card" else 1)


@pytest.mark.parametrize("operation", ["send", "query", "cancel"])
def test_wrong_media_type_is_not_a_task_or_a_cancellation_proof(operation: str) -> None:
    with wire([response({}, content_type="text/html")]) as (adapter, spec, peer):

        def invoke() -> GatewayReceipt:
            if operation == "send":
                return adapter.send(spec, send_request(), streaming=False)
            if operation == "query":
                return adapter.get_task(spec, "task-1")
            return adapter.cancel_task(spec, "task-1")

        with pytest.raises(GatewayError) as failure:
            invoke()
        assert failure.value.code == "invalid_content_type"
        assert failure.value.submission_unknown is (operation != "query")
        assert len(peer.requests) == 1


@pytest.mark.parametrize("cancel", [False, True])
@pytest.mark.parametrize("problem", ["missing_id", "long_id", "invalid_task", "wrong_task"])
def test_queries_and_cancels_require_the_exact_known_task(cancel: bool, problem: str) -> None:
    reply = response({} if problem == "invalid_task" else {**task(), "id": "another-task"})
    with wire([reply]) as (adapter, spec, peer):
        operation = adapter.cancel_task if cancel else adapter.get_task
        identifier = "" if problem == "missing_id" else "x" * 4097 if problem == "long_id" else "task-1"
        with pytest.raises(GatewayError) as failure:
            operation(spec, identifier)
        assert (
            failure.value.code
            == {
                "missing_id": "invalid_task_id",
                "long_id": "invalid_task_id",
                "invalid_task": "invalid_task",
                "wrong_task": "task_correlation_failed",
            }[problem]
        )
        assert len(peer.requests) == (0 if problem in {"missing_id", "long_id"} else 1)


def test_carried_context_and_legacy_extension_header_are_explicit_on_the_wire() -> None:
    adapter, egress = gateway([response({"task": task()})], traceability_legacy_header=True)
    spec = replace(connection(), enabled_extensions=(TRACEABILITY_URI,))
    receipt = adapter.send(spec, replace(send_request(), context_id="ctx-1"), streaming=False)
    assert receipt.context_id == "ctx-1"
    assert egress.requests[0][2]["headers"]["X-A2A-Extensions"] == TRACEABILITY_URI
    body = egress.requests[0][2]["content"]
    assert isinstance(body, bytes)
    assert json.loads(body)["message"]["contextId"] == "ctx-1"
    with wire([response({"task": task()})]) as (real, real_spec, peer):
        with pytest.raises(GatewayError) as failure:
            real.send(real_spec, replace(send_request(), context_id="other-context"), streaming=False)
        assert failure.value.code == "context_correlation_failed"
        assert failure.value.known_receipt is not None
        assert failure.value.known_receipt.task_id == "task-1"
        assert len(peer.requests) == 1


@pytest.mark.parametrize("carrier", ["file_url", "field_key", "identifier"])
def test_reflected_secrets_preserve_only_safe_known_task_identity(carrier: str) -> None:
    token = "private-token"
    document = task()
    if carrier == "identifier":
        document["id"] = token
    elif carrier == "field_key":
        document["metadata"] = {token: "unsafe-key"}
    else:
        document["artifacts"] = [{"artifactId": "a", "parts": [{"url": f"https://files.example/{token}"}]}]
    with wire([response({"task": document})], auth=BearerAuth(token)) as (adapter, spec, peer):
        with pytest.raises(GatewayError) as failure:
            adapter.send(spec, send_request(), streaming=False)
        assert failure.value.code == "credential_reflection"
        assert token not in str(failure.value)
        if carrier != "identifier":
            assert failure.value.known_receipt is not None
            assert failure.value.known_receipt.payload == {
                "id": "task-1",
                "contextId": "ctx-1",
                "status": {"state": "TASK_STATE_WORKING"},
            }
        assert len(peer.requests) == 1


@pytest.mark.parametrize(
    ("tail", "code"),
    [
        (b"data: \xff\n\n", "invalid_stream_event"),
        (b"data: {broken\n\n", "invalid_stream_event"),
        ({"task": task()}, "invalid_stream_sequence"),
        (
            {
                "statusUpdate": {
                    "taskId": "different",
                    "contextId": "ctx-1",
                    "status": {"state": "TASK_STATE_COMPLETED"},
                }
            },
            "task_correlation_failed",
        ),
        (
            {
                "statusUpdate": {
                    "taskId": "task-1",
                    "contextId": "different",
                    "status": {"state": "TASK_STATE_COMPLETED"},
                }
            },
            "task_correlation_failed",
        ),
        (
            {
                "artifactUpdate": {
                    "taskId": "task-1",
                    "contextId": "ctx-1",
                    "append": True,
                    "artifact": {"artifactId": "unknown", "parts": [{"text": "append"}]},
                }
            },
            "invalid_artifact_append",
        ),
    ],
)
def test_invalid_stream_after_initial_task_retains_identity_without_resend(tail: object, code: str) -> None:
    with wire([stream({"task": task()}, tail)]) as (adapter, spec, peer):
        with pytest.raises(GatewayError) as failure:
            adapter.send(spec, send_request(), streaming=True)
        assert failure.value.code == code
        assert failure.value.known_receipt is not None
        assert failure.value.known_receipt.task_id == "task-1"
        assert not failure.value.submission_unknown
        assert len(peer.requests) == 1


@pytest.mark.parametrize("payload", [b": heartbeat\n\n", b"data: \xff\n\n", b"data: {broken\n\n"])
def test_stream_without_an_initial_task_remains_unknown(payload: bytes) -> None:
    with wire([stream(payload)]) as (adapter, spec, peer):
        with pytest.raises(GatewayError) as failure:
            adapter.send(spec, send_request(), streaming=True)
        assert failure.value.submission_unknown
        assert failure.value.known_receipt is None
        assert len(peer.requests) == 1


def test_initial_status_update_cannot_manufacture_a_task_before_an_initial_response() -> None:
    update = {"statusUpdate": {"taskId": "task-1", "contextId": "ctx-1", "status": {"state": "TASK_STATE_COMPLETED"}}}
    with wire([stream(update)]) as (adapter, spec, peer):
        with pytest.raises(GatewayError) as failure:
            adapter.send(spec, send_request(), streaming=True)
        assert failure.value.code == "invalid_response"
        assert failure.value.submission_unknown
        assert failure.value.known_receipt is None
        assert len(peer.requests) == 1


def test_activity_after_terminal_and_replacing_artifact_have_distinct_contracts() -> None:
    artifact = {"artifactId": "a", "parts": [{"text": "replacement"}]}
    update = {"artifactUpdate": {"taskId": "task-1", "contextId": "ctx-1", "artifact": artifact}}
    with wire([stream({"task": task("TASK_STATE_COMPLETED")}, update)]) as (adapter, spec, peer):
        with pytest.raises(GatewayError) as failure:
            adapter.send(spec, send_request(), streaming=True)
        assert failure.value.code == "event_after_terminal"
        assert len(peer.requests) == 1
    initial = task(artifacts=[{"artifactId": "a", "parts": [{"text": "old"}]}])
    with wire([stream({"task": initial}, update)]) as (adapter, spec, peer):
        receipt = adapter.send(spec, send_request(), streaming=True)
        assert receipt.payload["artifacts"] == [artifact]
        assert len(peer.requests) == 1


@pytest.mark.parametrize("limits", [GatewayLimits(sse_events=1), GatewayLimits(sse_event_bytes=10)])
def test_sse_count_and_event_size_are_bounded_without_automatic_replay(limits: GatewayLimits) -> None:
    with wire([stream({"task": task()}, b": heartbeat\n\n")], limits=limits) as (adapter, spec, peer):
        with pytest.raises(GatewayError) as failure:
            adapter.send(spec, send_request(), streaming=True)
        assert failure.value.code == "invalid_response"
        assert len(peer.requests) == 1


def test_truncated_http_stream_keeps_the_task_received_before_disconnect() -> None:
    reply = stream({"task": task()})
    reply.headers["content-length"] = str(len(reply.content) + 20)
    with wire([reply]) as (adapter, spec, peer):
        with pytest.raises(GatewayError) as failure:
            adapter.send(spec, send_request(), streaming=True)
        assert failure.value.code == "network_failure"
        assert failure.value.known_receipt is not None
        assert failure.value.known_receipt.task_id == "task-1"
        assert not failure.value.submission_unknown
        assert len(peer.requests) == 1
