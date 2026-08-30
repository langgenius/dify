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

    def get(self, url: str, **kwargs: object):
        return self._request("GET", url, kwargs)

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


def _verified_domains() -> FakeResponse:
    return FakeResponse(
        200,
        {
            "data": [
                {
                    "name": "example.com",
                    "status": "verified",
                    "capabilities": {"sending": "enabled"},
                }
            ]
        },
    )


def test_validate_uses_full_access_domain_read_without_sending_email() -> None:
    http_client = FakeHTTPClient(_verified_domains())
    gateway = ResendProviderGateway(http_client=http_client)

    gateway.validate(_candidate())

    assert len(http_client.calls) == 1
    method, url, kwargs = http_client.calls[0]
    assert method == "GET"
    assert url == "https://api.resend.com/domains"
    assert kwargs["headers"]["Authorization"] == "Bearer re_secret"
    assert kwargs["headers"]["User-Agent"] == "Dify-Human-Input/1.0"
    assert kwargs["max_retries"] == 0
    assert "re_secret" not in repr(gateway)


@pytest.mark.parametrize(
    ("domain", "code"),
    [
        (None, "sender_domain_not_found"),
        (
            {
                "name": "example.com",
                "status": "pending",
                "capabilities": {"sending": "enabled"},
            },
            "sender_domain_not_verified",
        ),
        (
            {
                "name": "example.com",
                "status": "verified",
                "capabilities": {"sending": "disabled"},
            },
            "sender_domain_sending_disabled",
        ),
    ],
)
def test_validate_classifies_unusable_sender_domain(domain, code: str) -> None:
    domains = [] if domain is None else [domain]
    gateway = ResendProviderGateway(http_client=FakeHTTPClient(FakeResponse(200, {"data": domains})))

    with pytest.raises(EmailProviderValidationError) as raised:
        gateway.validate(_candidate())

    assert raised.value.code == code


def test_validate_rejects_sending_only_key_because_domain_cannot_be_checked() -> None:
    gateway = ResendProviderGateway(http_client=FakeHTTPClient(FakeResponse(401, {"name": "restricted_api_key"})))

    with pytest.raises(EmailProviderValidationError) as raised:
        gateway.validate(_candidate())

    assert raised.value.code == "provider_full_access_required"


def test_send_test_targets_operator_once_with_unique_idempotency_key() -> None:
    http_client = FakeHTTPClient(FakeResponse(200, {"id": "email-1"}))
    gateway = ResendProviderGateway(
        http_client=http_client,
        id_factory=lambda: "test-1",
    )

    gateway.send_test(_candidate(), NormalizedEmail("operator@example.com"))

    assert len(http_client.calls) == 1
    method, url, kwargs = http_client.calls[0]
    assert method == "POST"
    assert url == "https://api.resend.com/emails"
    assert kwargs["headers"]["Idempotency-Key"] == "human-input-channel-test/test-1"
    assert kwargs["max_retries"] == 0
    assert kwargs["json"] == {
        "from": "Approvals <approvals@example.com>",
        "to": ["operator@example.com"],
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
        gateway.send_test(_candidate(), NormalizedEmail("operator@example.com"))

    assert raised.value.code == code
    assert "re_secret" not in repr(raised.value)


def test_transport_failure_is_classified_without_credential_material() -> None:
    request = httpx.Request("GET", "https://api.resend.com/domains")
    gateway = ResendProviderGateway(http_client=FakeHTTPClient(httpx.ReadTimeout("request timed out", request=request)))

    with pytest.raises(EmailProviderOperationError) as raised:
        gateway.validate(_candidate())

    assert raised.value.code == "provider_timeout"
    assert "re_secret" not in repr(raised.value)
