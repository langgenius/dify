"""Request-scoped Resend validation and test-delivery adapter for Human Input v2."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any, Never, Protocol

import httpx

from core.helper import ssrf_proxy
from core.human_input_v2.shared import NormalizedEmail
from libs.uuid_utils import uuidv7
from repositories.human_input_v2.email_channel import (
    EmailProviderOperationError,
    EmailProviderValidationError,
    ResendCandidate,
)

_RESEND_API_ORIGIN = "https://api.resend.com"
_USER_AGENT = "Dify-Human-Input/1.0"
_TEST_SUBJECT = "Dify Human Input channel test"
_TEST_HTML = (
    "<p>Your Resend channel is connected to Dify Human Input.</p>"
    "<p>You can close this email after confirming delivery.</p>"
)


class ResendHTTPResponse(Protocol):
    status_code: int

    def json(self) -> Any: ...


class ResendHTTPClient(Protocol):
    def get(self, url: str, **kwargs: Any) -> ResendHTTPResponse: ...

    def post(self, url: str, **kwargs: Any) -> ResendHTTPResponse: ...


class ResendProviderGateway:
    """Perform Resend management I/O without shared SDK credential state."""

    def __init__(
        self,
        *,
        http_client: ResendHTTPClient = ssrf_proxy,
        timeout_seconds: float = 10,
        id_factory: Callable[[], str] = lambda: str(uuidv7()),
    ) -> None:
        if timeout_seconds <= 0:
            raise ValueError("Resend timeout must be positive")
        self._http_client = http_client
        self._timeout_seconds = timeout_seconds
        self._id_factory = id_factory

    def validate(self, candidate: ResendCandidate) -> None:
        """Verify the credential and exact sender domain without sending Email."""

        body = self._request("get", "/domains", candidate.api_key)
        domains = body.get("data")
        if not isinstance(domains, list):
            raise EmailProviderOperationError("provider_response_malformed")

        sender_domain = str(candidate.sender_email).rsplit("@", maxsplit=1)[-1].casefold()
        matching_domain = next(
            (
                domain
                for domain in domains
                if isinstance(domain, Mapping)
                and isinstance(domain.get("name"), str)
                and domain["name"].casefold() == sender_domain
            ),
            None,
        )
        if matching_domain is None:
            raise EmailProviderValidationError("sender_domain_not_found")
        if matching_domain.get("status") != "verified":
            raise EmailProviderValidationError("sender_domain_not_verified")
        capabilities = matching_domain.get("capabilities")
        if not isinstance(capabilities, Mapping) or capabilities.get("sending") != "enabled":
            raise EmailProviderValidationError("sender_domain_sending_disabled")

    def send_test(self, candidate: ResendCandidate, recipient: NormalizedEmail) -> None:
        """Send one idempotent test message to the authenticated operator."""

        sender = f"{candidate.sender_name} <{candidate.sender_email}>"
        body = self._request(
            "post",
            "/emails",
            candidate.api_key,
            json={
                "from": sender,
                "to": [str(recipient)],
                "subject": _TEST_SUBJECT,
                "html": _TEST_HTML,
            },
            idempotency_key=f"human-input-channel-test/{self._id_factory()}",
        )
        message_id = body.get("id")
        if not isinstance(message_id, str) or not message_id.strip():
            raise EmailProviderOperationError("provider_response_malformed")

    def _request(
        self,
        method: str,
        path: str,
        api_key: str,
        *,
        json: Mapping[str, Any] | None = None,
        idempotency_key: str | None = None,
    ) -> Mapping[str, Any]:
        headers = {
            "Authorization": f"Bearer {api_key}",
            "User-Agent": _USER_AGENT,
        }
        if idempotency_key is not None:
            headers["Idempotency-Key"] = idempotency_key
        request = self._http_client.get if method == "get" else self._http_client.post
        try:
            response = request(
                f"{_RESEND_API_ORIGIN}{path}",
                headers=headers,
                json=json,
                timeout=self._timeout_seconds,
                max_retries=0,
            )
        except httpx.TimeoutException as error:
            raise EmailProviderOperationError("provider_timeout") from error
        except httpx.RequestError as error:
            raise EmailProviderOperationError("provider_connection_failed") from error

        body = self._safe_body(response)
        if 200 <= response.status_code < 300:
            return body
        self._raise_provider_error(response.status_code, body)

    @staticmethod
    def _safe_body(response: ResendHTTPResponse) -> Mapping[str, Any]:
        try:
            body = response.json()
        except ValueError:
            return {}
        return body if isinstance(body, Mapping) else {}

    @staticmethod
    def _raise_provider_error(status_code: int, body: Mapping[str, Any]) -> Never:
        error_name = body.get("name")
        safe_name = error_name if isinstance(error_name, str) else None
        if safe_name in {"missing_api_key", "invalid_api_key"}:
            raise EmailProviderValidationError("invalid_api_key")
        if safe_name == "restricted_api_key":
            raise EmailProviderValidationError("provider_full_access_required")
        if safe_name == "invalid_from_address":
            raise EmailProviderValidationError("invalid_sender")
        if safe_name == "validation_error":
            raise EmailProviderValidationError("provider_validation_failed")
        if safe_name in {"daily_quota_exceeded", "monthly_quota_exceeded"}:
            raise EmailProviderOperationError("provider_quota_exhausted")
        if status_code == 429 or safe_name == "rate_limit_exceeded":
            raise EmailProviderOperationError("provider_rate_limited")
        if status_code >= 500:
            raise EmailProviderOperationError("provider_unavailable")
        if status_code in {401, 403}:
            raise EmailProviderValidationError("invalid_api_key")
        raise EmailProviderValidationError("provider_rejected")


__all__ = [
    "ResendHTTPClient",
    "ResendHTTPResponse",
    "ResendProviderGateway",
]
