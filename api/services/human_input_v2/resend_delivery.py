"""Request-scoped Resend transport and delivery adapter."""

from __future__ import annotations

import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Any, Protocol

import httpx

from core.human_input_v2.delivery_runtime import (
    DeliveryOutcome,
    DeliveryOutcomeStatus,
    PreparedRenderedEmailDelivery,
    fingerprint_rendered_email,
)
from core.human_input_v2.entities import EmailProviderType

_RESEND_API_ORIGIN = "https://api.resend.com"


@dataclass(frozen=True, slots=True)
class ResendHTTPResult:
    status_code: int
    body: Mapping[str, Any] = field(repr=False)
    retry_after_seconds: float | None


class ResendTransportError(RuntimeError):
    """Classified transport failure that cannot retain request details."""

    code: str

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class ResendTransport(Protocol):
    def send(self, prepared: PreparedRenderedEmailDelivery) -> ResendHTTPResult: ...


class HttpxResendTransport:
    """Create and close one HTTP client for each provider invocation."""

    def __init__(
        self,
        *,
        timeout_seconds: float = 10,
        client_factory: Callable[..., httpx.Client] = httpx.Client,
    ) -> None:
        if timeout_seconds <= 0:
            raise ValueError("Resend timeout must be positive")
        self._timeout_seconds = timeout_seconds
        self._client_factory = client_factory

    def send(self, prepared: PreparedRenderedEmailDelivery) -> ResendHTTPResult:
        request = prepared.request
        snapshot = prepared.snapshot
        sender = (
            f"{snapshot.sender_name} <{snapshot.sender_email}>" if snapshot.sender_name else str(snapshot.sender_email)
        )
        payload: dict[str, Any] = {
            "from": sender,
            "to": [str(request.recipient)],
            "subject": request.subject,
            "html": request.html,
        }
        if request.text is not None:
            payload["text"] = request.text
        headers = {
            "Authorization": f"Bearer {snapshot.credential.value}",
            "Idempotency-Key": request.idempotency_key,
        }
        try:
            with self._client_factory(base_url=_RESEND_API_ORIGIN, timeout=self._timeout_seconds) as client:
                response = client.post("/emails", json=payload, headers=headers)
        except httpx.TimeoutException as error:
            raise ResendTransportError("provider_timeout") from error
        except httpx.TransportError as error:
            raise ResendTransportError("provider_connection_failed") from error
        try:
            body = response.json()
        except ValueError:
            body = {}
        if not isinstance(body, Mapping):
            body = {}
        return ResendHTTPResult(
            status_code=response.status_code,
            body=body,
            retry_after_seconds=_parse_retry_after(response.headers.get("Retry-After")),
        )


class ResendEmailProviderAdapter:
    provider = EmailProviderType.RESEND

    def __init__(
        self,
        transport: ResendTransport,
        *,
        max_attempts: int = 3,
        max_retry_after_seconds: float = 5,
        sleeper: Callable[[float], None] = time.sleep,
    ) -> None:
        if max_attempts < 1:
            raise ValueError("Resend max attempts must be positive")
        if max_retry_after_seconds < 0:
            raise ValueError("Resend maximum retry delay must not be negative")
        self._transport = transport
        self._max_attempts = max_attempts
        self._max_retry_after_seconds = max_retry_after_seconds
        self._sleeper = sleeper

    def send(self, prepared: PreparedRenderedEmailDelivery) -> DeliveryOutcome:
        if fingerprint_rendered_email(prepared.request) != prepared.payload_fingerprint:
            return DeliveryOutcome.terminal("delivery_payload_changed")
        last_outcome = DeliveryOutcome.retryable("provider_unavailable")
        for attempt_index in range(self._max_attempts):
            try:
                result = self._transport.send(prepared)
                outcome = self._classify(result)
            except ResendTransportError as error:
                outcome = DeliveryOutcome.retryable(error.code)
            if outcome.status is not DeliveryOutcomeStatus.RETRYABLE_FAILURE:
                return outcome
            last_outcome = outcome
            if attempt_index + 1 < self._max_attempts:
                delay = outcome.failure.retry.retry_after_seconds if outcome.failure and outcome.failure.retry else None
                self._sleeper(min(delay or 0, self._max_retry_after_seconds))
        return last_outcome

    def _classify(self, result: ResendHTTPResult) -> DeliveryOutcome:
        if 200 <= result.status_code < 300:
            message_id = result.body.get("id")
            if isinstance(message_id, str) and message_id.strip():
                return DeliveryOutcome.accepted(message_id)
            return DeliveryOutcome.terminal("provider_response_malformed")

        error_name = result.body.get("name")
        error_code = error_name if isinstance(error_name, str) else None
        if error_code == "daily_quota_exceeded":
            return DeliveryOutcome.terminal("provider_quota_exhausted")
        if result.status_code == 429 or error_code == "rate_limit_exceeded":
            retry_after = result.retry_after_seconds
            if retry_after is not None:
                retry_after = min(retry_after, self._max_retry_after_seconds)
            return DeliveryOutcome.retryable(
                "provider_rate_limited",
                retry_after_seconds=retry_after,
            )
        if error_code == "concurrent_idempotent_requests":
            return DeliveryOutcome.retryable("provider_idempotency_in_progress")
        if error_code in {"idempotency_key_in_use", "validation_error"} and result.status_code == 409:
            return DeliveryOutcome.terminal("provider_idempotency_conflict")
        if result.status_code >= 500:
            return DeliveryOutcome.retryable("provider_unavailable")
        return DeliveryOutcome.terminal("provider_rejected")


def _parse_retry_after(value: str | None) -> float | None:
    if value is None:
        return None
    try:
        parsed = float(value)
    except ValueError:
        return None
    return max(parsed, 0)


__all__ = [
    "HttpxResendTransport",
    "ResendEmailProviderAdapter",
    "ResendHTTPResult",
    "ResendTransport",
    "ResendTransportError",
]
