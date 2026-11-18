"""Verify the signup and metering service through the generated Billing client."""

import json
from collections.abc import Callable, Iterator
from typing import Literal

import httpx
import pytest

from services.billing_client import transport
from services.billing_service import BillingService, TokenerBootstrapUpstreamError
from services.errors.billing import BillingUpstreamInvalidResponseError, BillingUpstreamUnavailableError

TENANT = "11111111-1111-1111-1111-111111111111"
OTHER_TENANT = "22222222-2222-2222-2222-222222222222"
TEST_KEY = "synthetic-one-time-key"
PRIVATE_URL = "https://tokener-billing.example.test"
NOW = "2026-11-18T00:00:00Z"


@pytest.fixture
def mock_billing_http(
    monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
) -> Iterator[Callable[[Callable[[httpx.Request], httpx.Response]], None]]:
    """Replace only HTTP I/O; all protocol validation and service branching remain real."""
    config_overrides(TOKENER_BILLING_API_URL=PRIVATE_URL)
    clients: list[httpx.Client] = []

    def bind(respond: Callable[[httpx.Request], httpx.Response]) -> None:
        client = httpx.Client(transport=httpx.MockTransport(respond))
        clients.append(client)
        monkeypatch.setattr(transport, "_http_client", client)

    try:
        yield bind
    finally:
        for client in clients:
            client.close()


@pytest.mark.parametrize(
    ("status", "error_code", "expected_code"),
    [("ready", "", None), ("pending", "org_pending", "org_pending"), ("pending", "unsafe url?key", None)],
)
def test_bootstrap_returns_credential_only_when_ready(
    mock_billing_http: Callable[[Callable[[httpx.Request], httpx.Response]], None],
    status: Literal["ready", "pending"],
    error_code: str,
    expected_code: str | None,
) -> None:
    def respond(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert str(request.url) == f"{PRIVATE_URL}/internal/v1/tokener/tenants/{TENANT}/bootstrap"
        assert json.loads(request.content) == {"tenant_id": TENANT, "display_name": "Test workspace"}
        return httpx.Response(
            200,
            json={
                "tenant_id": TENANT,
                "status": status,
                "retryable": status == "pending",
                "data_plane_api_key": TEST_KEY,
                "error_code": error_code,
            },
        )

    mock_billing_http(respond)
    result = BillingService.bootstrap_tokener_tenant(TENANT, "Test workspace")
    assert result["status"] == status
    assert result["tenant_id"] == TENANT
    assert result["retryable"] is (status == "pending")
    assert result.get("data_plane_api_key") == (TEST_KEY if status == "ready" else None)
    assert result.get("error_code") == expected_code


@pytest.mark.parametrize(
    ("tenant_id", "key", "expected_code", "retryable"),
    [
        (OTHER_TENANT, TEST_KEY, "tokener_bootstrap_invalid_response", False),
        (TENANT, None, "tokener_bootstrap_key_missing", True),
    ],
)
def test_bootstrap_rejects_wrong_owner_or_missing_key(
    mock_billing_http: Callable[[Callable[[httpx.Request], httpx.Response]], None],
    tenant_id: str,
    key: str | None,
    expected_code: str,
    retryable: bool,
) -> None:
    mock_billing_http(
        lambda _: httpx.Response(
            200,
            json={
                "tenant_id": tenant_id,
                "status": "ready",
                "retryable": False,
                "data_plane_api_key": key,
                "error_code": "",
            },
        )
    )
    with pytest.raises(TokenerBootstrapUpstreamError, match=expected_code) as caught:
        BillingService.bootstrap_tokener_tenant(TENANT, "Test workspace")
    assert caught.value.retryable is retryable
    assert TEST_KEY not in str(caught.value)


@pytest.mark.parametrize(
    ("status_code", "expected_code", "retryable", "metering_error"),
    [
        (409, "tokener_bootstrap_invalid_response", False, BillingUpstreamInvalidResponseError),
        (502, "tokener_bootstrap_unavailable", True, BillingUpstreamInvalidResponseError),
        (503, "tokener_bootstrap_unavailable", True, BillingUpstreamUnavailableError),
    ],
)
def test_tokener_http_errors_remain_safe_and_classified(
    mock_billing_http: Callable[[Callable[[httpx.Request], httpx.Response]], None],
    status_code: int,
    expected_code: str,
    retryable: bool,
    metering_error: type[Exception],
) -> None:
    mock_billing_http(lambda _: httpx.Response(status_code, json={"message": TEST_KEY}))
    with pytest.raises(TokenerBootstrapUpstreamError, match=expected_code) as caught:
        BillingService.bootstrap_tokener_tenant(TENANT, "Test workspace")
    assert caught.value.retryable is retryable
    assert TEST_KEY not in str(caught.value)
    with pytest.raises(metering_error):
        BillingService.get_tokener_metering(TENANT)


def test_native_billing_never_falls_back_when_unconfigured(config_overrides: Callable[..., None]) -> None:
    config_overrides(TOKENER_BILLING_API_URL="", BILLING_API_URL="https://legacy-billing.example.test")
    with pytest.raises(TokenerBootstrapUpstreamError, match="tokener_billing_api_not_configured") as caught:
        BillingService.bootstrap_tokener_tenant(TENANT, "Test workspace")
    assert caught.value.retryable is False
    with pytest.raises(BillingUpstreamUnavailableError):
        BillingService.get_tokener_metering(TENANT)


@pytest.mark.parametrize("usage_available", [True, False])
def test_metering_keeps_zero_usage_distinct_from_unavailable(
    mock_billing_http: Callable[[Callable[[httpx.Request], httpx.Response]], None], usage_available: bool
) -> None:
    month = {"start_date": "2026-11-01", "end_date": "2026-11-30"}
    month |= (
        {"status": "available", "billed_usd_micro": "0", "request_count": "0"}
        if usage_available
        else {"status": "unavailable", "error_code": "usage_unavailable"}
    )
    payload: dict[str, object] = {
        "tenant_id": TENANT,
        "currency": "USD",
        "available_usd_micro": "1000000",
        "current_month": month,
        "balance_generated_at": NOW,
    }
    if usage_available:
        payload["usage_generated_at"] = NOW

    def respond(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        assert str(request.url) == f"{PRIVATE_URL}/internal/v1/tokener/tenants/{TENANT}/metering"
        return httpx.Response(200, json=payload)

    mock_billing_http(respond)
    assert BillingService.get_tokener_metering(TENANT) == payload


@pytest.mark.parametrize(
    ("tenant_id", "status", "usage_timestamp", "usage_values"),
    [
        (OTHER_TENANT, "available", True, {"billed_usd_micro": "6", "request_count": "1"}),
        (TENANT, "available", False, {"billed_usd_micro": "6", "request_count": "1"}),
        (TENANT, "available", True, {"billed_usd_micro": "invalid", "request_count": "1"}),
        (TENANT, "unavailable", True, {"error_code": "usage_unavailable"}),
    ],
)
def test_metering_rejects_cross_tenant_or_inconsistent_usage(
    mock_billing_http: Callable[[Callable[[httpx.Request], httpx.Response]], None],
    tenant_id: str,
    status: str,
    usage_timestamp: bool,
    usage_values: dict[str, str],
) -> None:
    payload: dict[str, object] = {
        "tenant_id": tenant_id,
        "currency": "USD",
        "available_usd_micro": "1000000",
        "current_month": {"status": status, "start_date": "2026-11-01", "end_date": "2026-11-30", **usage_values},
        "balance_generated_at": NOW,
    }
    if usage_timestamp:
        payload["usage_generated_at"] = NOW
    mock_billing_http(lambda _: httpx.Response(200, json=payload))
    with pytest.raises(BillingUpstreamInvalidResponseError):
        BillingService.get_tokener_metering(TENANT)
