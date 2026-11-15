"""A2A 1.0 HTTP+JSON adapter: read-only Verify and exactly-once-attempt dispatch.

The adapter never synthesizes context IDs or resends business requests. Parsed
receipts are transient; the caller materializes outputs and strips reusable file
payloads before persistence. A2A Subscribe, JSON-RPC, gRPC and Push are excluded.
"""

import base64
import hashlib
import ipaddress
import json
import time
from contextlib import suppress
from dataclasses import dataclass, replace
from typing import Literal
from urllib.parse import quote, urlsplit, urlunsplit

from pydantic import ValidationError

from services.external_agents.io_contracts import JsonObject, JsonValue
from services.external_agents.protocol import (
    TRACEABILITY_URI,
    BearerAuth,
    ConnectionSpec,
    CredentialDecoderPort,
    GatewayError,
    GatewayReceipt,
    SealedBearerAuth,
    SendRequest,
    VerificationResult,
)

from .transport import BoundedTransport, HTTPReply, TransportError
from .types import AgentCardV1, MessageV1, ResponseV1, SecurityRequirementV1, TaskV1, strict_json

_TERMINAL = frozenset({"TASK_STATE_COMPLETED", "TASK_STATE_FAILED", "TASK_STATE_CANCELED", "TASK_STATE_REJECTED"})


@dataclass(frozen=True, slots=True)
class GatewayLimits:
    card_bytes: int = 1024 * 1024
    response_bytes: int = 48 * 1024 * 1024
    sse_bytes: int = 64 * 1024 * 1024
    sse_event_bytes: int = 48 * 1024 * 1024
    sse_events: int = 10_000
    request_bytes: int = 48 * 1024 * 1024


DEFAULT_GATEWAY_LIMITS = GatewayLimits()


def checked_url(value: str, *, allow_loopback_http: bool = False) -> str:
    """Validate URL grammar; real DNS/address admission still belongs to SSRF policy.

    Production requires HTTPS and forbids credentials, query, fragment and
    control characters. Explicit loopback HTTP is for injected test/dev policy.
    """
    try:
        parsed = urlsplit(value)
        port = parsed.port
        host = parsed.hostname
        if not host or parsed.username is not None or parsed.password is not None:
            raise ValueError("Invalid endpoint")
        if parsed.query or parsed.fragment or any(ord(char) < 33 for char in value) or "\\" in value:
            raise ValueError("Invalid endpoint")
        loopback = host.lower() == "localhost"
        with suppress(ValueError):
            loopback = loopback or ipaddress.ip_address(host).is_loopback
        if parsed.scheme != "https" and not (allow_loopback_http and loopback and parsed.scheme == "http"):
            raise ValueError("HTTPS required")
        if port is not None and not 1 <= port <= 65535:
            raise ValueError("Invalid port")
    except ValueError:
        raise GatewayError(
            "invalid_endpoint", "A valid HTTPS endpoint without embedded credentials is required."
        ) from None
    return value.rstrip("/")


def _origin(url: str) -> tuple[str, str, int]:
    parsed = urlsplit(url)
    return parsed.scheme, (parsed.hostname or "").lower(), parsed.port or (443 if parsed.scheme == "https" else 80)


def _same_origin(first: str, second: str) -> None:
    if _origin(first) != _origin(second):
        raise GatewayError("cross_origin_interface", "The advertised interface must remain in the configured origin.")


class A2AGateway:
    def __init__(
        self,
        transport: BoundedTransport,
        *,
        credential_decoder: CredentialDecoderPort | None = None,
        limits: GatewayLimits = DEFAULT_GATEWAY_LIMITS,
        allow_loopback_http: bool = False,
        traceability_legacy_header: bool = False,
    ) -> None:
        """Receive configured adapters/settings; no service constructs infrastructure."""
        self._transport = transport
        self._decoder = credential_decoder
        self._limits = limits
        self._allow_loopback_http = allow_loopback_http
        self._legacy_trace_header = traceability_legacy_header

    def _url(self, value: str) -> str:
        return checked_url(value, allow_loopback_http=self._allow_loopback_http)

    def _headers(self, connection: ConnectionSpec) -> dict[str, str]:
        headers = {"A2A-Version": "1.0", "Accept": "application/a2a+json", "Accept-Encoding": "identity"}
        token = self._secret(connection)
        if token is not None:
            headers["Authorization"] = f"Bearer {token}"
        if any(uri != TRACEABILITY_URI for uri in connection.enabled_extensions):
            raise GatewayError("extension_unsupported", "The selected extension profile is not supported.")
        if connection.enabled_extensions:
            value = ",".join(connection.enabled_extensions)
            headers["A2A-Extensions"] = value
            if self._legacy_trace_header:
                headers["X-A2A-Extensions"] = value
        return headers

    def _secret(self, connection: ConnectionSpec) -> str | None:
        """Resolve a transient secret only inside this infrastructure boundary."""
        auth = connection.authentication
        token: str | None = None
        if isinstance(auth, BearerAuth):
            token = auth.token
        elif isinstance(auth, SealedBearerAuth):
            if self._decoder is None:
                raise GatewayError("credential_unavailable", "The connection credential cannot be resolved.")
            token = self._decoder.decrypt(auth.tenant_id, auth.ciphertext)
        if token is not None:
            if not token.strip() or len(token) > 65536 or any(c in token for c in ("\r", "\n", "\x00")):
                raise GatewayError("invalid_credential", "A nonempty safe Bearer token is required.")
        return token

    def _request(
        self,
        connection: ConnectionSpec,
        method: str,
        url: str,
        *,
        body: bytes | None = None,
        timeout_seconds: float,
        streaming: bool = False,
        card: bool = False,
    ) -> HTTPReply:
        self._url(url)
        _same_origin(connection.endpoint, url)
        headers = self._headers(connection)
        if body is not None:
            headers["Content-Type"] = "application/a2a+json"
        if streaming:
            headers["Accept"] = "text/event-stream"
        try:
            reply = self._transport.request(
                method,
                url,
                headers=headers,
                body=body,
                timeout_seconds=timeout_seconds,
                max_bytes=self._limits.card_bytes
                if card
                else self._limits.sse_bytes
                if streaming
                else self._limits.response_bytes,
                streaming=streaming,
            )
        except TransportError as error:
            known_receipt = None
            if streaming and error.partial_reply is not None and 200 <= error.partial_reply.status < 300:
                with suppress(ValueError):
                    known_receipt = self._stream_receipt(error.partial_reply)
                    known_receipt = self._scrub_receipt(known_receipt, connection)
            raise GatewayError(
                error.code,
                "The external service request did not produce a complete verified response.",
                submission_unknown=method == "POST"
                and "/message:" in url
                and known_receipt is None
                and error.code != "io_capacity_exhausted",
                known_receipt=known_receipt,
                retryable=method == "GET"
                and error.code in ("network_failure", "deadline_exceeded", "io_capacity_exhausted"),
            ) from None
        if reply.status in (401, 403):
            raise GatewayError(
                "authentication_failed" if reply.status == 401 else "permission_denied",
                "The external service rejected access.",
            )
        if 300 <= reply.status < 400:
            raise GatewayError("redirect_rejected", "External redirects are not followed.")
        if reply.status < 200 or reply.status >= 300:
            code = "task_not_found" if reply.status == 404 else "remote_request_failed"
            if url.endswith(":cancel"):
                code = (
                    "cancellation_unsupported"
                    if reply.status in (405, 501)
                    else "cancellation_unconfirmed"
                    if reply.status >= 500
                    else "cancellation_rejected"
                )
            if reply.status == 429:
                code = "rate_limited"
            retry_after = reply.headers.get("retry-after", "")
            raise GatewayError(
                code,
                "The external service rejected or failed the operation.",
                submission_unknown=method == "POST" and "/message:" in url and reply.status >= 500,
                retryable=method == "GET" and reply.status in (429, 500, 502, 503, 504),
                retry_after_seconds=float(retry_after) if retry_after.isdigit() else None,
            )
        content_type = reply.headers.get("content-type", "").split(";", 1)[0].strip().lower()
        allowed = {"application/json", "application/a2a+json"} if card or not streaming else {"text/event-stream"}
        if content_type not in allowed:
            raise GatewayError(
                "invalid_content_type",
                "The external service returned an unsupported response format.",
                submission_unknown=method == "POST",
            )
        return reply

    def verify(self, connection: ConnectionSpec, *, timeout_seconds: float = 30) -> VerificationResult:
        """Verify only Card/protected read; success never asserts execution credential validity."""
        endpoint = self._url(connection.endpoint)
        deadline = time.monotonic() + min(timeout_seconds, 30)
        parsed = urlsplit(endpoint)
        card_url = (
            endpoint
            if parsed.path.endswith("/.well-known/agent-card.json")
            else urlunsplit((parsed.scheme, parsed.netloc, "/.well-known/agent-card.json", "", ""))
        )
        reply = self._request(connection, "GET", card_url, timeout_seconds=timeout_seconds, card=True)
        try:
            card = AgentCardV1.model_validate(strict_json(reply.body))
        except ValueError:
            raise GatewayError(
                "invalid_agent_card", "The Agent Card does not match the frozen A2A 1.0 profile."
            ) from None
        interface = next(
            (
                item
                for item in card.supportedInterfaces
                if item.protocolBinding == "HTTP+JSON" and item.protocolVersion == "1.0"
            ),
            None,
        )
        if interface is None:
            raise GatewayError("profile_unsupported", "The Agent does not advertise A2A 1.0 HTTP+JSON.")
        self._url(interface.url)
        _same_origin(endpoint, interface.url)
        required = tuple(ext.uri for ext in card.capabilities.extensions if ext.required)
        if any(uri != TRACEABILITY_URI for uri in required):
            raise GatewayError("required_extension_unsupported", "A required extension is unsupported.")
        negotiated = replace(
            connection, enabled_extensions=tuple(dict.fromkeys((*connection.enabled_extensions, *required)))
        )
        self._validate_auth(card, connection)
        auth_check: LiteralAuthCheck = "not_exercised"
        if card.capabilities.extendedAgentCard:
            extended_url = self._operation_url(interface.url, interface.tenant, "extendedAgentCard")
            protected = self._request(
                negotiated, "GET", extended_url, timeout_seconds=deadline - time.monotonic(), card=True
            )
            try:
                AgentCardV1.model_validate(strict_json(protected.body))
            except ValueError:
                raise GatewayError("invalid_agent_card", "The protected Agent Card is invalid.") from None
            if isinstance(connection.authentication, BearerAuth | SealedBearerAuth):
                auth_check = "passed_for_read_endpoint"
        value = card.model_dump(mode="json", exclude_unset=True)
        digest = hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        secret = self._secret(connection)
        if secret and any(
            secret in identifier or quote(secret, safe="") in identifier
            for identifier in (interface.url, interface.tenant or "")
        ):
            raise GatewayError("credential_reflection", "The Agent interface reflected a private credential.")
        # Extension params have no frozen public Traceability v1 parameter
        # schema. Unknown nested params and signatures are never Console data.
        value.pop("signatures", None)
        capabilities = value.get("capabilities", {})
        for extension in capabilities.get("extensions", []):
            extension.pop("params", None)
        value = self._scrub_object(value, secret)
        return VerificationResult(
            card=value,
            interface_url=interface.url,
            remote_tenant=interface.tenant,
            auth_check=auth_check,
            card_fingerprint=digest,
            streaming=card.capabilities.streaming,
            required_extensions=required,
        )

    @staticmethod
    def _validate_auth(card: AgentCardV1, connection: ConnectionSpec) -> None:
        if card.securityRequirements:

            def bearer_scheme(name: str) -> bool:
                scheme = card.securitySchemes.get(name, {}).get("httpAuthSecurityScheme")
                if not isinstance(scheme, dict):
                    return False
                value = scheme.get("scheme")
                return isinstance(value, str) and value.lower() == "bearer"

            def supported(requirement: SecurityRequirementV1) -> bool:
                schemes = requirement.schemes
                if not schemes:
                    return True
                if not isinstance(connection.authentication, BearerAuth | SealedBearerAuth):
                    return False
                return all(bearer_scheme(name) for name in schemes)

            if not any(supported(requirement) for requirement in card.securityRequirements):
                raise GatewayError(
                    "authentication_incompatible", "The selected authentication cannot satisfy the Card requirements."
                )

    @staticmethod
    def _operation_url(interface: str, tenant: str | None, operation: str) -> str:
        prefix = f"{quote(tenant, safe='')}/" if tenant else ""
        return f"{interface.rstrip('/')}/{prefix}{operation}"

    def _interface(self, connection: ConnectionSpec, operation: str) -> str:
        if not connection.interface_url:
            raise GatewayError("connection_not_verified", "An admitted frozen interface is required.")
        self._url(connection.endpoint)
        self._url(connection.interface_url)
        _same_origin(connection.endpoint, connection.interface_url)
        return self._operation_url(connection.interface_url, connection.remote_tenant, operation)

    def send(
        self, connection: ConnectionSpec, request: SendRequest, *, streaming: bool, timeout_seconds: float = 30
    ) -> GatewayReceipt:
        """Dispatch one new message; never retry POST on transport/protocol uncertainty."""
        message: dict[str, object] = {
            "messageId": request.message_id,
            "role": "ROLE_USER",
            "parts": list(request.parts),
        }
        if request.context_id:
            message["contextId"] = request.context_id
        try:
            MessageV1.model_validate(message)
        except ValidationError:
            raise GatewayError(
                "invalid_request", "The external task input does not match the frozen wire profile."
            ) from None
        body = json.dumps(
            {
                "message": message,
                "configuration": {
                    "returnImmediately": True,
                    "historyLength": 0,
                    "acceptedOutputModes": list(request.accepted_output_modes),
                },
            },
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
        ).encode()
        if len(body) > self._limits.request_bytes:
            raise GatewayError("request_too_large", "The encoded task request exceeds the effective byte limit.")
        reply = self._request(
            connection,
            "POST",
            self._interface(connection, "message:stream" if streaming else "message:send"),
            body=body,
            timeout_seconds=timeout_seconds,
            streaming=streaming,
        )
        try:
            receipt = (
                self._stream_receipt(reply)
                if streaming
                else self._receipt(ResponseV1.model_validate(strict_json(reply.body)))
            )
        except ValueError as error:
            if isinstance(error, GatewayError):
                safe_known = self._scrub_receipt(error.known_receipt, connection) if error.known_receipt else None
                raise GatewayError(
                    error.code, str(error), submission_unknown=error.submission_unknown, known_receipt=safe_known
                ) from None
            raise GatewayError(
                "invalid_response", "The external response is not a valid A2A 1.0 result.", submission_unknown=True
            ) from None
        receipt = self._scrub_receipt(receipt, connection)
        self._correlate(receipt, request.context_id)
        return receipt

    def get_task(self, connection: ConnectionSpec, task_id: str, *, timeout_seconds: float = 30) -> GatewayReceipt:
        """Query one owned remote Task; never substitute a different returned Task ID."""
        return self._task_operation(connection, task_id, cancel=False, timeout_seconds=timeout_seconds)

    def cancel_task(self, connection: ConnectionSpec, task_id: str, *, timeout_seconds: float = 30) -> GatewayReceipt:
        """Request cancellation once; returned non-Canceled state is not cancellation proof."""
        return self._task_operation(connection, task_id, cancel=True, timeout_seconds=timeout_seconds)

    def _task_operation(
        self, connection: ConnectionSpec, task_id: str, *, cancel: bool, timeout_seconds: float
    ) -> GatewayReceipt:
        if not task_id or len(task_id) > 4096:
            raise GatewayError("invalid_task_id", "A known remote task ID is required.")
        operation = f"tasks/{quote(task_id, safe='')}{':cancel' if cancel else ''}"
        reply = self._request(
            connection,
            "POST" if cancel else "GET",
            self._interface(connection, operation),
            body=b"{}" if cancel else None,
            timeout_seconds=timeout_seconds,
        )
        try:
            task = TaskV1.model_validate(strict_json(reply.body))
        except ValueError:
            raise GatewayError("invalid_task", "The external Task response is invalid.") from None
        if task.id != task_id:
            raise GatewayError("task_correlation_failed", "The response belongs to another task.")
        return self._scrub_receipt(self._receipt(ResponseV1(task=task)), connection)

    @staticmethod
    def _scrub_object(value: JsonObject, secret: str | None) -> JsonObject:
        scrubbed = A2AGateway._scrub(value, secret)
        if not isinstance(scrubbed, dict):
            raise GatewayError("invalid_response", "The sanitized result must be an object.")
        return scrubbed

    @staticmethod
    def _scrub(value: JsonValue, secret: str | None) -> JsonValue:
        """Remove credential reflection recursively; never silently rewrite file bytes."""
        if not secret:
            return value
        if isinstance(value, str):
            return value.replace(secret, "[REDACTED]").replace(quote(secret, safe=""), "[REDACTED]")
        if isinstance(value, list):
            return [A2AGateway._scrub(item, secret) for item in value]
        if isinstance(value, dict):
            url = value.get("url")
            if isinstance(url, str) and (secret in url or quote(secret, safe="") in url):
                raise GatewayError("credential_reflection", "Returned file URL reflected a private credential.")
            raw = value.get("raw")
            if isinstance(raw, str):
                decoded = b""
                with suppress(ValueError):
                    decoded = base64.b64decode(raw, validate=True)
                if secret.encode() in decoded or secret in raw:
                    raise GatewayError("credential_reflection", "Returned file content reflected a private credential.")
            if any(secret in key or quote(secret, safe="") in key for key in value):
                raise GatewayError("credential_reflection", "Returned field names reflected a private credential.")
            return {key: A2AGateway._scrub(item, secret) for key, item in value.items()}
        return value

    def _scrub_receipt(self, receipt: GatewayReceipt, connection: ConnectionSpec) -> GatewayReceipt:
        secret = self._secret(connection)
        if secret and any(secret in identifier for identifier in (receipt.task_id, receipt.context_id) if identifier):
            raise GatewayError(
                "credential_reflection",
                "Returned task identifiers reflected a private credential.",
                submission_unknown=True,
            )
        try:
            return replace(receipt, payload=self._scrub_object(receipt.payload, secret))
        except GatewayError as error:
            known = None
            if receipt.kind == "task":
                known = replace(
                    receipt,
                    payload={
                        "id": receipt.task_id,
                        "contextId": receipt.context_id,
                        "status": {"state": receipt.state},
                    },
                )
            raise GatewayError(error.code, str(error), known_receipt=known) from None

    @staticmethod
    def _receipt(response: ResponseV1) -> GatewayReceipt:
        if response.task is not None:
            task = response.task
            return GatewayReceipt(
                kind="task",
                payload=task.model_dump(mode="json", exclude_unset=True),
                task_id=task.id,
                context_id=task.contextId,
                state=task.status.state,
            )
        if response.message is not None:
            message = response.message
            if message.role != "ROLE_AGENT" or not message.contextId:
                raise GatewayError(
                    "invalid_message", "Server Message context and role are required.", submission_unknown=True
                )
            return GatewayReceipt(
                kind="message",
                payload=message.model_dump(mode="json", exclude_unset=True),
                context_id=message.contextId,
            )
        raise GatewayError("invalid_response", "An initial Task or Message is required.", submission_unknown=True)

    @staticmethod
    def _correlate(receipt: GatewayReceipt, carried_context: str | None) -> None:
        if carried_context and receipt.context_id and carried_context != receipt.context_id:
            raise GatewayError(
                "context_correlation_failed", "The response changed the requested context.", known_receipt=receipt
            )

    def _stream_receipt(self, reply: HTTPReply) -> GatewayReceipt:
        body = reply.body.replace(b"\r\n", b"\n").replace(b"\r", b"\n")
        blocks = body.split(b"\n\n")[:-1]
        if len(blocks) > self._limits.sse_events:
            raise ValueError("Too many stream events")
        current: GatewayReceipt | None = None
        for block in blocks:
            try:
                text = block.decode("utf-8", errors="strict")
            except UnicodeDecodeError:
                raise GatewayError(
                    "invalid_stream_event",
                    "The stream is not valid UTF-8.",
                    submission_unknown=current is None,
                    known_receipt=current,
                ) from None
            data = "\n".join(line[5:].lstrip(" ") for line in text.split("\n") if line.startswith("data:"))
            if data:
                if len(data.encode()) > self._limits.sse_event_bytes:
                    raise ValueError("Oversized SSE event")
                try:
                    response = ResponseV1.model_validate(strict_json(data))
                except ValueError:
                    raise GatewayError(
                        "invalid_stream_event",
                        "The stream event is invalid.",
                        submission_unknown=current is None,
                        known_receipt=current,
                    ) from None
                if current is None:
                    current = self._receipt(response)
                elif response.task is not None or response.message is not None or current.kind == "message":
                    raise GatewayError(
                        "invalid_stream_sequence",
                        "The stream changed its initial response shape.",
                        known_receipt=current,
                    )
                else:
                    current = self._apply_update(current, response)
        if current is None:
            raise GatewayError(
                "submission_unknown",
                "The stream ended before a known Task or Message was received.",
                submission_unknown=True,
            )
        return current

    @staticmethod
    def _apply_update(current: GatewayReceipt, response: ResponseV1) -> GatewayReceipt:
        event = response.statusUpdate or response.artifactUpdate
        if (
            event is None
            or event.taskId != current.task_id
            or (current.context_id and event.contextId != current.context_id)
        ):
            raise GatewayError(
                "task_correlation_failed", "A stream update belongs to another task/context.", known_receipt=current
            )
        task = TaskV1.model_validate(current.payload)
        if task.status.state in _TERMINAL:
            raise GatewayError(
                "event_after_terminal", "The stream reported activity after a terminal state.", known_receipt=current
            )
        task.contextId = event.contextId
        if response.statusUpdate:
            task.status = response.statusUpdate.status
        elif response.artifactUpdate:
            update = response.artifactUpdate
            existing = next((a for a in task.artifacts if a.artifactId == update.artifact.artifactId), None)
            if existing is None:
                if update.append:
                    raise GatewayError(
                        "invalid_artifact_append", "An append update requires a known artifact.", known_receipt=current
                    )
                task.artifacts = [*task.artifacts, update.artifact]
            else:
                replacement = update.artifact.model_copy(deep=True)
                if update.append:
                    replacement.parts = existing.parts + replacement.parts
                task.artifacts = [replacement if a.artifactId == replacement.artifactId else a for a in task.artifacts]
        return A2AGateway._receipt(ResponseV1(task=task))


type LiteralAuthCheck = Literal["passed_for_read_endpoint", "not_exercised"]
