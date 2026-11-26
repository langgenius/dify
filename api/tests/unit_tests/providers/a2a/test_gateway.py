"""Exercise strict A2A receipts with real HTTP response/stream objects and recording egress."""

import base64
import json
import time
from collections.abc import Iterator
from typing import TypedDict, override

import httpx
import pytest

from providers.a2a.gateway import DEFAULT_GATEWAY_LIMITS, A2AGateway, GatewayLimits, checked_url
from providers.a2a.transport import BoundedTransport
from services.external_agents.io_contracts import JsonObject, JsonValue
from services.external_agents.protocol import (
    TRACEABILITY_URI,
    Authentication,
    BearerAuth,
    ConnectionSpec,
    CredentialDecoderPort,
    GatewayError,
    NoAuth,
    ResponseIssue,
    SealedBearerAuth,
    SendRequest,
)


class RecordedOptions(TypedDict):
    headers: dict[str, str]
    content: bytes | None
    timeout: httpx.Timeout
    max_retries: int
    follow_redirects: bool
    ssl_verify: bool
    stream_response: bool


class RecordingRequester:
    def __init__(self, responses: list[httpx.Response]) -> None:
        self.responses = responses
        self.requests: list[tuple[str, str, RecordedOptions]] = []

    def request(self, method: str, url: str, **kwargs: object) -> httpx.Response:
        raw_headers, content, timeout = kwargs["headers"], kwargs["content"], kwargs["timeout"]
        assert isinstance(raw_headers, dict)
        headers: dict[str, str] = {}
        for key, value in raw_headers.items():
            assert isinstance(key, str)
            assert isinstance(value, str)
            headers[key] = value
        assert isinstance(content, bytes) or content is None
        assert isinstance(timeout, httpx.Timeout)
        retries, redirects, verify, stream = (
            kwargs[key] for key in ("max_retries", "follow_redirects", "ssl_verify", "stream_response")
        )
        assert isinstance(retries, int)
        assert redirects is False
        assert verify is True
        assert isinstance(stream, bool)
        options: RecordedOptions = {
            "headers": headers,
            "content": content,
            "timeout": timeout,
            "max_retries": retries,
            "follow_redirects": redirects,
            "ssl_verify": verify,
            "stream_response": stream,
        }
        self.requests.append((method, url, options))
        assert retries == 0
        return self.responses.pop(0)


def response(
    value: object, *, status: int = 200, content_type: str = "application/a2a+json", **headers: str
) -> httpx.Response:
    return httpx.Response(status, content=json.dumps(value).encode(), headers={"content-type": content_type, **headers})


def card(*, extensions: list[dict[str, object]] | None = None, extended: bool = False) -> dict[str, object]:
    return {
        "name": "Contract agent",
        "description": "Review contracts",
        "version": "v1",
        "supportedInterfaces": [
            {"url": "https://agent.example/a2a/v1", "protocolBinding": "HTTP+JSON", "protocolVersion": "1.0"}
        ],
        "capabilities": {"streaming": True, "extendedAgentCard": extended, "extensions": extensions or []},
        "defaultInputModes": ["text/plain"],
        "defaultOutputModes": ["text/plain"],
        "skills": [],
    }


def task(state: str = "TASK_STATE_WORKING", **extra: object) -> dict[str, object]:
    return {"id": "task-1", "contextId": "ctx-1", "status": {"state": state}, **extra}


_NO_AUTH = NoAuth()


def connection(auth: Authentication = _NO_AUTH) -> ConnectionSpec:
    return ConnectionSpec(
        endpoint="https://agent.example/a2a/v1", interface_url="https://agent.example/a2a/v1", authentication=auth
    )


def send_request() -> SendRequest:
    return SendRequest(message_id="message-1", parts=({"text": "Review this contract"},))


def gateway(
    responses: list[httpx.Response],
    *,
    credential_decoder: CredentialDecoderPort | None = None,
    limits: GatewayLimits = DEFAULT_GATEWAY_LIMITS,
    allow_loopback_http: bool = False,
    traceability_legacy_header: bool = False,
) -> tuple[A2AGateway, RecordingRequester]:
    egress = RecordingRequester(responses)
    return A2AGateway(
        BoundedTransport(egress),
        credential_decoder=credential_decoder,
        limits=limits,
        allow_loopback_http=allow_loopback_http,
        traceability_legacy_header=traceability_legacy_header,
    ), egress


def test_verify_uses_origin_root_and_does_not_dispatch() -> None:
    adapter, egress = gateway([response(card())])
    result = adapter.verify(connection(BearerAuth("secret")))
    assert result.auth_check == "not_exercised"
    assert result.interface_url == "https://agent.example/a2a/v1"
    assert [row[:2] for row in egress.requests] == [("GET", "https://agent.example/.well-known/agent-card.json")]
    assert result.profile_version == "a2a-1.0-http-json.v1"
    assert "secret" not in repr(connection(BearerAuth("secret")))


def test_transport_timeout_configuration_is_clamped_to_the_call_deadline() -> None:
    egress = RecordingRequester([response(card()), response(card())])
    transport = BoundedTransport(egress, connect_timeout_seconds=2, request_timeout_seconds=8)
    for deadline in (4, 20):
        transport.request(
            "GET", "https://agent.example", headers={}, body=None, timeout_seconds=deadline, max_bytes=1024 * 1024
        )
    assert [request[2]["timeout"].connect for request in egress.requests] == [2, 2]
    assert [request[2]["timeout"].read for request in egress.requests] == [4, 8]
    with pytest.raises(ValueError, match="timeouts"):
        BoundedTransport(egress, request_timeout_seconds=31)


def test_verify_only_uses_declared_protected_read_and_reports_scope() -> None:
    adapter, egress = gateway([response(card(extended=True)), response(card())])
    result = adapter.verify(connection(BearerAuth("safe-token")))
    assert result.auth_check == "passed_for_read_endpoint"
    assert [request[0] for request in egress.requests] == ["GET", "GET"]
    assert egress.requests[1][1] == "https://agent.example/a2a/v1/extendedAgentCard"


@pytest.mark.parametrize(
    ("status", "code"), [(401, "authentication_failed"), (403, "permission_denied"), (302, "redirect_rejected")]
)
def test_verify_refusal_blocks_success(status: int, code: str) -> None:
    adapter, egress = gateway([response({}, status=status)])
    with pytest.raises(GatewayError) as error:
        adapter.verify(connection())
    assert error.value.code == code
    assert len(egress.requests) == 1


@pytest.mark.parametrize(
    "endpoint",
    [
        "http://agent.example",
        "https://user:secret@agent.example",
        "https://agent.example?secret=1",
        "https://agent.example/#x",
        "https://agent.example\\evil",
    ],
)
def test_invalid_endpoint_never_reaches_transport(endpoint: str) -> None:
    with pytest.raises(GatewayError, match="HTTPS"):
        checked_url(endpoint)


def test_unknown_required_extension_is_rejected() -> None:
    adapter, _ = gateway([response(card(extensions=[{"uri": "https://unknown.example/v1", "required": True}]))])
    with pytest.raises(GatewayError) as error:
        adapter.verify(connection())
    assert error.value.code == "required_extension_unsupported"


def test_verify_negotiates_supported_required_extension_only_after_reading_the_card() -> None:
    required = card(extensions=[{"uri": TRACEABILITY_URI, "required": True}], extended=True)
    adapter, egress = gateway([response(required), response(required)])
    verified = adapter.verify(connection(BearerAuth("fixture-token")))
    assert verified.required_extensions == (TRACEABILITY_URI,)
    assert verified.auth_check == "passed_for_read_endpoint"
    assert "A2A-Extensions" not in egress.requests[0][2]["headers"]
    assert egress.requests[1][2]["headers"]["A2A-Extensions"] == TRACEABILITY_URI
    assert all(request[0] == "GET" for request in egress.requests)


def test_every_operation_uses_the_same_enabled_extension_header() -> None:
    adapter, egress = gateway([response({"task": task()}), response(task()), response(task("TASK_STATE_CANCELED"))])
    spec = ConnectionSpec(
        endpoint="https://agent.example",
        interface_url="https://agent.example/a2a",
        authentication=NoAuth(),
        enabled_extensions=(TRACEABILITY_URI,),
    )
    adapter.send(spec, send_request(), streaming=False)
    adapter.get_task(spec, "task-1")
    adapter.cancel_task(spec, "task-1")
    assert [request[2]["headers"]["A2A-Extensions"] for request in egress.requests] == [TRACEABILITY_URI] * 3


def test_cross_origin_interface_is_rejected() -> None:
    other = card()
    other["supportedInterfaces"] = [
        {"url": "https://other.example/a2a", "protocolBinding": "HTTP+JSON", "protocolVersion": "1.0"}
    ]
    adapter, _ = gateway([response(other)])
    with pytest.raises(GatewayError) as error:
        adapter.verify(connection())
    assert error.value.code == "cross_origin_interface"


def test_sealed_secret_is_resolved_only_during_io() -> None:
    class Decoder:
        def decrypt(self, tenant_id: str, ciphertext: str) -> str:
            assert (tenant_id, ciphertext) == ("tenant-1", "cipher")
            return "decrypted-token"

    adapter, egress = gateway([response({"task": task()})], credential_decoder=Decoder())
    receipt = adapter.send(connection(SealedBearerAuth("tenant-1", "cipher")), send_request(), streaming=False)
    assert receipt.task_id == "task-1"
    assert egress.requests[0][2]["headers"]["Authorization"] == "Bearer decrypted-token"
    assert "decrypted-token" not in repr(receipt)


def test_send_is_single_post_and_preserves_routing_and_minor_version() -> None:
    adapter, egress = gateway([response({"task": task()})])
    spec = ConnectionSpec(
        endpoint="https://agent.example",
        interface_url="https://agent.example/a2a/v1",
        remote_tenant="remote/team",
        authentication=NoAuth(),
    )
    result = adapter.send(spec, send_request(), streaming=False)
    assert result.kind == "task"
    method, url, kwargs = egress.requests[0]
    assert (method, url) == ("POST", "https://agent.example/a2a/v1/remote%2Fteam/message:send")
    assert kwargs["headers"]["A2A-Version"] == "1.0"
    content = kwargs["content"]
    assert isinstance(content, bytes)
    body = json.loads(content)
    assert body["configuration"]["returnImmediately"] is True
    assert "contextId" not in body["message"]
    assert "taskId" not in body["message"]
    assert len(egress.requests) == 1


def test_server_error_never_retries_creation() -> None:
    adapter, egress = gateway([response({"secret": "raw peer error"}, status=503)])
    with pytest.raises(GatewayError) as error:
        adapter.send(connection(), send_request(), streaming=False)
    assert error.value.submission_unknown
    assert "raw peer" not in str(error.value)
    assert len(egress.requests) == 1


@pytest.mark.parametrize("body", [b'{"task":{},"task":{}}', b'{"task":NaN}', b'{"jsonrpc":"2.0","result":{}}'])
def test_invalid_wire_does_not_coerce_or_fallback(body: bytes) -> None:
    adapter, egress = gateway([httpx.Response(200, content=body, headers={"content-type": "application/a2a+json"})])
    with pytest.raises(GatewayError):
        adapter.send(connection(), send_request(), streaming=False)
    assert len(egress.requests) == 1


def test_direct_message_requires_server_context() -> None:
    value = {"message": {"messageId": "m", "role": "ROLE_AGENT", "parts": [{"text": "ok"}]}}
    adapter, _ = gateway([response(value)])
    with pytest.raises(GatewayError) as error:
        adapter.send(connection(), send_request(), streaming=False)
    assert error.value.code == "invalid_message"


def test_get_task_missing_optional_context_is_not_fabricated() -> None:
    value = task()
    value.pop("contextId")
    adapter, _ = gateway([response(value)])
    result = adapter.get_task(connection(), "task-1")
    assert result.context_id is None
    assert "contextId" not in result.payload


def test_query_retry_after_and_cancel_refusal_are_explicit() -> None:
    adapter, egress = gateway([response({}, status=429, **{"retry-after": "7"}), response({}, status=501)])
    with pytest.raises(GatewayError) as error:
        adapter.get_task(connection(), "task-1")
    assert error.value.retryable
    assert error.value.retry_after_seconds == 7
    with pytest.raises(GatewayError) as error:
        adapter.cancel_task(connection(), "task-1")
    assert error.value.code == "cancellation_unsupported"
    assert not error.value.submission_unknown
    assert len(egress.requests) == 2


@pytest.mark.parametrize(
    ("status", "code"),
    [
        (500, "cancellation_unconfirmed"),
        (502, "cancellation_unconfirmed"),
        (503, "cancellation_unconfirmed"),
        (409, "cancellation_rejected"),
    ],
)
def test_cancel_server_failure_is_not_authoritative_refusal_and_never_replays(status: int, code: str) -> None:
    adapter, egress = gateway([response({}, status=status)])
    with pytest.raises(GatewayError) as error:
        adapter.cancel_task(connection(), "task-1")
    assert error.value.code == code
    assert len(egress.requests) == 1
    assert not error.value.submission_unknown


def test_sse_assembles_artifacts_before_terminal_and_uses_standard_header() -> None:
    records = [
        {"task": task()},
        {
            "artifactUpdate": {
                "taskId": "task-1",
                "contextId": "ctx-1",
                "artifact": {"artifactId": "a", "parts": [{"text": "one"}]},
            }
        },
        {
            "artifactUpdate": {
                "taskId": "task-1",
                "contextId": "ctx-1",
                "artifact": {"artifactId": "a", "parts": [{"text": "two"}]},
                "append": True,
            }
        },
        {"statusUpdate": {"taskId": "task-1", "contextId": "ctx-1", "status": {"state": "TASK_STATE_COMPLETED"}}},
    ]
    body = "".join(f"data: {json.dumps(item)}\n\n" for item in records)
    adapter, egress = gateway(
        [httpx.Response(200, content=body.encode(), headers={"content-type": "text/event-stream"})]
    )
    spec = ConnectionSpec(
        endpoint="https://agent.example",
        interface_url="https://agent.example",
        authentication=NoAuth(),
        enabled_extensions=(TRACEABILITY_URI,),
    )
    result = adapter.send(spec, send_request(), streaming=True)
    assert result.state == "TASK_STATE_COMPLETED"
    artifacts = result.payload["artifacts"]
    assert isinstance(artifacts, list)
    first_artifact = artifacts[0]
    assert isinstance(first_artifact, dict)
    assert first_artifact["parts"] == [{"text": "one"}, {"text": "two"}]
    assert egress.requests[0][2]["headers"]["A2A-Extensions"] == TRACEABILITY_URI
    assert "X-A2A-Extensions" not in egress.requests[0][2]["headers"]


def test_bounded_sse_window_returns_known_task_without_second_business_post() -> None:
    class SlowStream(httpx.SyncByteStream):
        @override
        def __iter__(self) -> Iterator[bytes]:
            yield f"data: {json.dumps({'task': task()})}\n\n".encode()
            time.sleep(0.1)
            yield b": heartbeat\n\n"

    adapter, egress = gateway([httpx.Response(200, stream=SlowStream(), headers={"content-type": "text/event-stream"})])
    result = adapter.send(connection(), send_request(), streaming=True, timeout_seconds=0.02)
    assert result.task_id == "task-1"
    assert len(egress.requests) == 1


def test_encoded_body_limit_rejects_before_post() -> None:
    adapter, egress = gateway([], limits=GatewayLimits(request_bytes=10))
    with pytest.raises(GatewayError) as error:
        adapter.send(connection(), send_request(), streaming=False)
    assert error.value.code == "request_too_large"
    assert not egress.requests


def test_card_and_response_cannot_reflect_bearer_into_public_values() -> None:
    token = "private-bearer-credential"
    value = card(extensions=[{"uri": TRACEABILITY_URI, "description": f"echo {token}", "params": {"unknown": token}}])
    value["description"] = f"description {token}"
    skill: JsonObject = {"id": "s", "name": "Skill", "description": token, "tags": [], "examples": [token]}
    value["skills"] = [skill]
    adapter, _ = gateway([response(value)])
    verified = adapter.verify(connection(BearerAuth(token)))
    assert token not in json.dumps(verified.card)
    description = verified.card["description"]
    assert isinstance(description, str)
    assert "[REDACTED]" in description
    capabilities = verified.card["capabilities"]
    assert isinstance(capabilities, dict)
    extensions = capabilities["extensions"]
    assert isinstance(extensions, list)
    extension = extensions[0]
    assert isinstance(extension, dict)
    assert "params" not in extension
    payload = {
        "message": {
            "messageId": "m",
            "contextId": "ctx",
            "role": "ROLE_AGENT",
            "parts": [{"data": {"result": token, "nested": {"value": token}}}],
        }
    }
    adapter, _ = gateway([response(payload)])
    result = adapter.send(connection(BearerAuth(token)), send_request(), streaming=False)
    assert token not in json.dumps(result.payload)


def test_binary_credential_echo_is_rejected_without_mutating_file_bytes() -> None:
    token = "private-bearer-credential"
    value = task(
        "TASK_STATE_COMPLETED",
        artifacts=[
            {
                "artifactId": "report",
                "parts": [
                    {
                        "raw": base64.b64encode(token.encode()).decode(),
                        "filename": "report.txt",
                        "mediaType": "text/plain",
                    }
                ],
            }
        ],
    )
    adapter, _ = gateway([response({"task": value})])
    with pytest.raises(GatewayError) as error:
        adapter.send(connection(BearerAuth(token)), send_request(), streaming=False)
    assert error.value.code == "credential_reflection"
    assert error.value.known_receipt is not None
    assert error.value.known_receipt.task_id == "task-1"
    assert token not in repr(error.value.known_receipt)
    assert "artifacts" not in error.value.known_receipt.payload


def test_incomplete_final_utf8_event_does_not_erase_known_task() -> None:
    body = f"data: {json.dumps({'task': task()})}\n\n".encode() + b'data: {"partial":"\xe4'
    adapter, _ = gateway([httpx.Response(200, content=body, headers={"content-type": "text/event-stream"})])
    assert adapter.send(connection(), send_request(), streaming=True).task_id == "task-1"


def diagnostic_message(*, omit: tuple[str, ...] = (), **changes: JsonValue) -> JsonObject:
    """Build an ordinary direct reply, with controlled missing/invalid fields."""
    message: JsonObject = {
        "messageId": "reply",
        "role": "ROLE_AGENT",
        "contextId": "context",
        "parts": [{"text": "result"}],
        **changes,
    }
    return {"message": {key: value for key, value in message.items() if key not in omit}}


@pytest.mark.parametrize("streaming", [False, True])
@pytest.mark.parametrize(
    ("payload", "issue", "code"),
    [
        (diagnostic_message(omit=("contextId",)), ResponseIssue.MESSAGE_CONTEXT_ID_MISSING, "invalid_message"),
        (diagnostic_message(contextId=None), ResponseIssue.MESSAGE_CONTEXT_ID_MISSING, "invalid_message"),
        (diagnostic_message(contextId=""), ResponseIssue.MESSAGE_CONTEXT_ID_INVALID, "invalid_response"),
        (diagnostic_message(contextId=42), ResponseIssue.MESSAGE_CONTEXT_ID_INVALID, "invalid_response"),
        (diagnostic_message(contextId=[]), ResponseIssue.MESSAGE_CONTEXT_ID_INVALID, "invalid_response"),
        (diagnostic_message(contextId={}), ResponseIssue.MESSAGE_CONTEXT_ID_INVALID, "invalid_response"),
        (diagnostic_message(omit=("role",)), ResponseIssue.MESSAGE_ROLE_MISSING, "invalid_response"),
        (diagnostic_message(role=None), ResponseIssue.MESSAGE_ROLE_INVALID, "invalid_response"),
        (diagnostic_message(role="agent"), ResponseIssue.MESSAGE_ROLE_INVALID, "invalid_response"),
        (diagnostic_message(role="ROLE_UNKNOWN"), ResponseIssue.MESSAGE_ROLE_INVALID, "invalid_response"),
        (diagnostic_message(role=42), ResponseIssue.MESSAGE_ROLE_INVALID, "invalid_response"),
        (diagnostic_message(role=[]), ResponseIssue.MESSAGE_ROLE_INVALID, "invalid_response"),
        (diagnostic_message(role={}), ResponseIssue.MESSAGE_ROLE_INVALID, "invalid_response"),
        (diagnostic_message(role="ROLE_USER"), ResponseIssue.MESSAGE_ROLE_INVALID, "invalid_message"),
        (
            diagnostic_message(omit=("contextId", "role")),
            ResponseIssue.MESSAGE_CONTEXT_ID_AND_ROLE_INVALID,
            "invalid_response",
        ),
        (
            diagnostic_message(omit=("contextId",), role="ROLE_USER"),
            ResponseIssue.MESSAGE_CONTEXT_ID_AND_ROLE_INVALID,
            "invalid_message",
        ),
        (
            diagnostic_message(contextId=42, role=None),
            ResponseIssue.MESSAGE_CONTEXT_ID_AND_ROLE_INVALID,
            "invalid_response",
        ),
    ],
)
def test_received_initial_message_diagnoses_fields_without_resending(
    payload: JsonObject, issue: ResponseIssue, code: str, streaming: bool
) -> None:
    from tests.unit_tests.providers.a2a.test_gateway_branches import stream, wire

    reply = stream(payload) if streaming else response(payload)
    with wire([reply]) as (adapter, spec, peer):
        with pytest.raises(GatewayError) as failure:
            adapter.send(spec, send_request(), streaming=streaming)
        error = failure.value
        assert error.code == ("invalid_stream_event" if streaming and code == "invalid_response" else code)
        assert error.response_issue is issue
        assert error.submission_unknown
        assert not error.retryable
        assert error.known_receipt is None
        assert "external agent reply" in str(error)
        assert "external agent maintainer" in str(error)
        if "context_id" in issue.value:
            assert "message.contextId" in str(error)
        if "role" in issue.value:
            assert "message.role" in str(error)
            assert "ROLE_AGENT" in str(error)
        assert [request[0] for request in peer.requests] == ["POST"]


@pytest.mark.parametrize("streaming", [False, True])
@pytest.mark.parametrize("context", ["context", " "])
def test_valid_direct_message_keeps_the_existing_context_contract(context: str, streaming: bool) -> None:
    from tests.unit_tests.providers.a2a.test_gateway_branches import stream, wire

    payload = diagnostic_message(contextId=context)
    with wire([stream(payload) if streaming else response(payload)]) as (adapter, spec, peer):
        receipt = adapter.send(spec, send_request(), streaming=streaming)
        assert receipt.kind == "message"
        assert receipt.context_id == context
        assert [request[0] for request in peer.requests] == ["POST"]


@pytest.mark.parametrize(
    "payload",
    [
        None,
        42,
        [],
        {"message": "not-a-message"},
        {"task": {"role": "ROLE_USER"}},
        {**diagnostic_message(omit=("contextId",)), "task": task()},
        {**diagnostic_message(omit=("contextId",)), "unexpected-peer-key": "untrusted"},
        diagnostic_message(parts=[]),
        {"statusUpdate": {"taskId": "task", "contextId": "ctx", "status": {"state": "TASK_STATE_WORKING"}}},
    ],
)
def test_other_invalid_response_shapes_do_not_claim_message_field_diagnostics(payload: object) -> None:
    from tests.unit_tests.providers.a2a.test_gateway_branches import wire

    with wire([response(payload)]) as (adapter, spec, peer):
        with pytest.raises(GatewayError) as failure:
            adapter.send(spec, send_request(), streaming=False)
        assert failure.value.code == "invalid_response"
        assert failure.value.response_issue is None
        assert failure.value.submission_unknown
        assert [request[0] for request in peer.requests] == ["POST"]


@pytest.mark.parametrize(
    ("reply", "code", "unknown"),
    [
        (
            httpx.Response(200, content=b'{"message":', headers={"content-type": "application/json"}),
            "invalid_response",
            True,
        ),
        (
            httpx.Response(200, content=b'{"message":{},"message":{}}', headers={"content-type": "application/json"}),
            "invalid_response",
            True,
        ),
        (response(diagnostic_message(omit=("contextId",)), content_type="text/html"), "invalid_content_type", True),
        (response(diagnostic_message(omit=("contextId",)), status=401), "authentication_failed", False),
        (response(diagnostic_message(omit=("contextId",)), status=403), "permission_denied", False),
        (response(diagnostic_message(omit=("contextId",)), status=429), "rate_limited", False),
        (response(diagnostic_message(omit=("contextId",)), status=500), "remote_request_failed", True),
        (
            httpx.Response(
                200, content=b'{"message":', headers={"content-type": "application/json", "content-length": "500"}
            ),
            "network_failure",
            True,
        ),
    ],
)
def test_non_message_failures_keep_their_codes_without_field_diagnostics(
    reply: httpx.Response, code: str, unknown: bool
) -> None:
    from tests.unit_tests.providers.a2a.test_gateway_branches import wire

    with wire([reply]) as (adapter, spec, peer):
        with pytest.raises(GatewayError) as failure:
            adapter.send(spec, send_request(), streaming=False)
        assert failure.value.code == code
        assert failure.value.response_issue is None
        assert failure.value.submission_unknown is unknown
        assert not failure.value.retryable
        assert failure.value.known_receipt is None
        assert [request[0] for request in peer.requests] == ["POST"]


@pytest.mark.parametrize("streaming", [False, True])
def test_diagnostics_never_echo_rejected_values_or_credentials(streaming: bool) -> None:
    from tests.unit_tests.providers.a2a.test_gateway_branches import stream, wire

    token = "private-bearer-diagnostic-sentinel"
    payload = diagnostic_message(role={token: token}, contextId=[token], metadata={token: token})
    with wire([stream(payload) if streaming else response(payload)], auth=BearerAuth(token)) as (adapter, spec, peer):
        with pytest.raises(GatewayError) as failure:
            adapter.send(spec, send_request(), streaming=streaming)
        error = failure.value
        assert error.response_issue is ResponseIssue.MESSAGE_CONTEXT_ID_AND_ROLE_INVALID
        assert token not in str(error)
        assert token not in repr(error)
        assert error.submission_unknown
        assert error.known_receipt is None
        assert [request[0] for request in peer.requests] == ["POST"]


@pytest.mark.parametrize("omit", [("role",), ("contextId",)])
def test_invalid_later_message_preserves_known_task_without_initial_reply_diagnostic(omit: tuple[str, ...]) -> None:
    from tests.unit_tests.providers.a2a.test_gateway_branches import stream, wire

    with wire([stream({"task": task()}, diagnostic_message(omit=omit))]) as (adapter, spec, peer):
        with pytest.raises(GatewayError) as failure:
            adapter.send(spec, send_request(), streaming=True)
        assert failure.value.response_issue is None
        assert failure.value.known_receipt is not None
        assert failure.value.known_receipt.task_id == "task-1"
        assert not failure.value.submission_unknown
        assert [request[0] for request in peer.requests] == ["POST"]
