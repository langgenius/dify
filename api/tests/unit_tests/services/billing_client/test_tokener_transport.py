"""The private signup bootstrap reply and credential must never leak on failure."""

from datetime import datetime

import httpx
import pytest

from services.billing_client import transport
from services.billing_client.billing import BootstrapTokenerTenantReply
from services.errors.billing import BillingUpstreamInvalidResponseError, BillingUpstreamUnavailableError
from tests.helpers.unit.config_override import apply_config_overrides

_PATH = "/internal/v1/tokener/tenants/{tenant_id}/bootstrap"
_SECRET = "fake-test-only-provisioning-secret"
_ERRORS = transport.ServiceErrors(
    is_reason=lambda _: False,
    unavailable=BillingUpstreamUnavailableError,
    invalid_response=BillingUpstreamInvalidResponseError,
)


class _BootstrapReply(transport.BillingModel):
    generated_at: datetime
    ready: bool
    data_plane_api_key: str


def test_generated_signup_reply_does_not_repr_the_one_time_key() -> None:
    reply = BootstrapTokenerTenantReply(
        tenant_id="tenant-1", status="ready", data_plane_api_key=_SECRET, retryable=False, error_code=""
    )
    assert _SECRET not in repr(reply)
    assert reply.data_plane_api_key == _SECRET


def _request() -> _BootstrapReply:
    return transport.request(
        transport.Upstream.TOKENER_BILLING,
        "POST",
        _PATH,
        response_model=_BootstrapReply,
        errors=_ERRORS,
        path_params={"tenant_id": "tenant-1"},
        params={},
        body=None,
    )


def test_tokener_upstream_uses_its_configured_origin_and_does_not_follow_redirects(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    apply_config_overrides(monkeypatch, TOKENER_BILLING_API_URL="https://billing.example.test/")
    destinations: list[str] = []

    def respond(request: httpx.Request) -> httpx.Response:
        destinations.append(str(request.url))
        return httpx.Response(307, headers={"Location": "https://other.example.test/bootstrap"})

    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        monkeypatch.setattr(transport, "_http_client", client)
        with pytest.raises(BillingUpstreamInvalidResponseError):
            _request()

    assert destinations == ["https://billing.example.test/internal/v1/tokener/tenants/tenant-1/bootstrap"]


def test_tokener_upstream_without_configuration_never_falls_back_to_legacy_billing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    apply_config_overrides(monkeypatch, TOKENER_BILLING_API_URL="", BILLING_API_URL="https://legacy.example.test")

    def unexpected_request(_request: httpx.Request) -> httpx.Response:
        raise AssertionError("A missing signup upstream must not cause an HTTP request")

    with httpx.Client(transport=httpx.MockTransport(unexpected_request)) as client:
        monkeypatch.setattr(transport, "_http_client", client)
        with pytest.raises(BillingUpstreamUnavailableError, match="not configured"):
            _request()


def test_malformed_success_reply_does_not_return_salvaged_data_or_chain_key_details(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    apply_config_overrides(monkeypatch, TOKENER_BILLING_API_URL="https://billing.example.test")

    def respond(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"generated_at": "invalid", "ready": "true", "data_plane_api_key": _SECRET})

    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        monkeypatch.setattr(transport, "_http_client", client)
        with pytest.raises(BillingUpstreamInvalidResponseError) as caught:
            _request()

    assert caught.value.__cause__ is None
    assert caught.value.__context__ is None
    assert _SECRET not in str(caught.value)
