"""Resend management adapter tests without live provider credentials."""

from __future__ import annotations

from dataclasses import dataclass

import httpx
import pytest

from core.human_input_v2.shared import NormalizedEmail
from repositories.human_input_v2.email_channel import (
    EmailProviderOperationError,
    EmailProviderValidationError,
    ResendCandidate,
)
from services.human_input_v2.resend_channel import ResendProviderGateway


@dataclass
class FakeResponse:
    status_code: int
    body: object

    def json(self):
        if isinstance(self.body, Exception):
            raise self.body
        return self.body


class FakeHTTPClient:
    def __init__(self, *responses: FakeResponse | Exception) -> None:
        self.responses = list(responses)
        self.calls: list[tuple[str, str, dict[str, object]]] = []

    def post(self, url: str, **kwargs: object):
        return self._request("POST", url, kwargs)

    def _request(self, method: str, url: str, kwargs: dict[str, object]):
        self.calls.append((method, url, kwargs))
        result = self.responses.pop(0)
        if isinstance(result, Exception):
            raise result
        return result


def _candidate() -> ResendCandidate:
    return ResendCandidate(
        sender_email=NormalizedEmail("approvals@example.com"),
        sender_name="Approvals",
        api_key="re_secret",
    )


def test_send_test_uses_resend_test_recipient_once_with_unique_idempotency_key() -> None:
    http_client = FakeHTTPClient(FakeResponse(200, {"id": "email-1"}))
    gateway = ResendProviderGateway(
        http_client=http_client,
        id_factory=lambda: "test-1",
    )

    gateway.send_test(_candidate())

    assert len(http_client.calls) == 1
    method, url, kwargs = http_client.calls[0]
    assert method == "POST"
    assert url == "https://api.resend.com/emails"
    assert kwargs["headers"]["Idempotency-Key"] == "human-input-channel-test/test-1"
    assert kwargs["headers"]["Authorization"] == "Bearer re_secret"
    assert kwargs["headers"]["User-Agent"] == "Dify-Human-Input/1.0"
    assert kwargs["max_retries"] == 0
    assert kwargs["json"] == {
        "from": "Approvals <approvals@example.com>",
        "to": ["delivered@resend.dev"],
        "subject": "Dify Human Input channel test",
        "html": (
            "<p>Your Resend channel is connected to Dify Human Input.</p>"
            "<p>You can close this email after confirming delivery.</p>"
        ),
    }


@pytest.mark.parametrize(
    ("response", "exception_type", "code"),
    [
        (FakeResponse(403, {"name": "invalid_api_key"}), EmailProviderValidationError, "invalid_api_key"),
        (FakeResponse(403, {"name": "restricted_api_key"}), EmailProviderValidationError, "invalid_api_key"),
        (
            FakeResponse(422, {"name": "invalid_from_address"}),
            EmailProviderValidationError,
            "invalid_sender",
        ),
        (
            FakeResponse(429, {"name": "monthly_quota_exceeded"}),
            EmailProviderOperationError,
            "provider_quota_exhausted",
        ),
        (FakeResponse(503, {}), EmailProviderOperationError, "provider_unavailable"),
        (FakeResponse(200, {}), EmailProviderOperationError, "provider_response_malformed"),
    ],
)
def test_send_test_maps_provider_responses_to_safe_failures(response, exception_type, code: str) -> None:
    gateway = ResendProviderGateway(http_client=FakeHTTPClient(response))

    with pytest.raises(exception_type) as raised:
        gateway.send_test(_candidate())

    assert raised.value.code == code
    assert "re_secret" not in repr(raised.value)


def test_transport_failure_is_classified_without_credential_material() -> None:
    request = httpx.Request("POST", "https://api.resend.com/emails")
    gateway = ResendProviderGateway(http_client=FakeHTTPClient(httpx.ReadTimeout("request timed out", request=request)))

    with pytest.raises(EmailProviderOperationError) as raised:
        gateway.send_test(_candidate())

    assert raised.value.code == "provider_timeout"
    assert "re_secret" not in repr(raised.value)
