import inspect
import logging
import types
from collections.abc import Callable
from typing import assert_type, get_args

import httpx
import pytest
import tenacity

from services.billing_client import billing, saas, transport
from services.billing_client.transport import BillingModel, Upstream
from services.errors.billing import (
    BillingUpstreamError,
    BillingUpstreamInvalidResponseError,
    BillingUpstreamUnavailableError,
    UnknownErrorReason,
    UpstreamErrorBody,
)
from tests.unit_tests.services.billing_client.conftest import RespondWith


class _Reply(BillingModel):
    ok: bool


class _VirtualClock:
    """Advance tenacity's clock instead of sleeping, keeping the production retry policy."""

    def __init__(self) -> None:
        self.elapsed = 0.0
        self.sleeps: list[float] = []

    def monotonic(self) -> float:
        return self.elapsed

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.elapsed += seconds


def _get(upstream: Upstream) -> _Reply:
    return transport.request(
        upstream, "GET", "/probe", response_model=_Reply, errors=saas.ERRORS, path_params={}, params={}, body=None
    )


@pytest.mark.parametrize(
    ("status", "error"),
    [
        (400, BillingUpstreamInvalidResponseError),
        (408, BillingUpstreamUnavailableError),
        (429, BillingUpstreamUnavailableError),
        (503, BillingUpstreamUnavailableError),
    ],
)
def test_non_ok_status_maps_to_upstream_errors(respond_with: RespondWith, status: int, error: type[Exception]) -> None:
    respond_with(
        httpx.Response(status, json={"code": status, "reason": "NETWORK_ACCESS_VERSION_CONFLICT", "message": "over"})
    )

    with pytest.raises(error) as exc_info:
        _get(Upstream.BILLING)

    assert isinstance(exc_info.value, BillingUpstreamError)
    assert exc_info.value.status_code == status
    assert exc_info.value.body == UpstreamErrorBody(code=status, message="over")
    assert isinstance(exc_info.value, saas.UpstreamError)
    assert exc_info.value.reason == "NETWORK_ACCESS_VERSION_CONFLICT"


@pytest.mark.parametrize(
    ("content", "body", "reason"),
    [
        (b"upstream crashed", None, None),
        (b"[]", None, None),
        (
            b'{"code": "x", "reason": "NETWORK_ACCESS_GROUP_NAME_CONFLICT", "metadata": {"k": 1}}',
            UpstreamErrorBody(),
            "NETWORK_ACCESS_GROUP_NAME_CONFLICT",
        ),
        (b'{"code": 409, "reason": 409, "message": "taken"}', UpstreamErrorBody(code=409, message="taken"), None),
        (b'{"code": 409, "message": "taken"}', UpstreamErrorBody(code=409, message="taken"), None),
        (b'{"reason": ""}', UpstreamErrorBody(), ""),
    ],
)
def test_error_body_keeps_well_typed_fields(
    respond_with: RespondWith, content: bytes, body: UpstreamErrorBody | None, reason: str | None
) -> None:
    respond_with(httpx.Response(409, content=content))

    with pytest.raises(saas.UpstreamInvalidResponseError) as exc_info:
        _get(Upstream.BILLING)

    assert exc_info.value.body == body
    assert exc_info.value.reason == reason


@pytest.mark.parametrize(
    ("status", "error"), [(409, BillingUpstreamInvalidResponseError), (503, BillingUpstreamUnavailableError)]
)
def test_unknown_reason_is_kept_apart_and_reported(
    respond_with: RespondWith, caplog: pytest.LogCaptureFixture, status: int, error: type[Exception]
) -> None:
    respond_with(httpx.Response(status, json={"code": status, "reason": "SHIPPED_LATER", "message": "new"}))

    with caplog.at_level(logging.ERROR, logger=transport.__name__), pytest.raises(error) as exc_info:
        _get(Upstream.SAAS)

    assert isinstance(exc_info.value, saas.UpstreamError)
    assert exc_info.value.reason == UnknownErrorReason("SHIPPED_LATER")
    assert exc_info.value.body == UpstreamErrorBody(code=status, message="new")
    [record] = caplog.records
    assert record.levelno == logging.ERROR
    assert (
        record.getMessage() == "Unknown saas error reason SHIPPED_LATER from GET /probe; regenerate the billing client"
    )


def test_unknown_reason_is_logged_without_foreign_characters(
    respond_with: RespondWith, caplog: pytest.LogCaptureFixture
) -> None:
    reason = "SHIPPED_LATER\nERROR forged entry <script>" + "X" * 100
    respond_with(httpx.Response(409, json={"code": 409, "reason": reason}))

    with caplog.at_level(logging.ERROR, logger=transport.__name__), pytest.raises(saas.UpstreamError) as exc_info:
        _get(Upstream.SAAS)

    assert exc_info.value.reason == UnknownErrorReason(reason)
    [record] = caplog.records
    logged = record.getMessage().removeprefix("Unknown saas error reason ").partition(" ")[0]
    assert logged == ("SHIPPED_LATERERROR" + "X" * 100)[:64]


@pytest.mark.parametrize(
    ("call", "own", "other"),
    [
        (lambda: billing.subscription_get_subscription_info(tenant_id="t", exclude_vector_space=False), billing, saas),
        (lambda: saas.account_check_account_in_freeze(email="a@example.com"), saas, billing),
    ],
)
def test_generated_operation_raises_its_own_service_errors(
    respond_with: RespondWith, call: Callable[[], object], own: types.ModuleType, other: types.ModuleType
) -> None:
    respond_with(httpx.Response(503, json={"code": 503, "reason": ""}))

    with pytest.raises(BillingUpstreamUnavailableError) as exc_info:
        call()

    assert isinstance(exc_info.value, own.UpstreamUnavailableError)
    assert not isinstance(exc_info.value, other.UpstreamError)
    assert exc_info.value.reason == ""


def test_service_errors_type_their_own_reason() -> None:
    def read(saas_error: saas.UpstreamError, billing_error: billing.UpstreamError) -> None:
        assert_type(saas_error.reason, saas.ErrorReason | UnknownErrorReason | None)
        assert_type(billing_error.reason, billing.ErrorReason | UnknownErrorReason | None)

    read(saas.UpstreamUnavailableError(reason="APP_NOT_FOUND"), billing.UpstreamInvalidResponseError(reason=""))
    assert not hasattr(BillingUpstreamError(), "reason")


def test_transport_branches_on_no_specific_reason() -> None:
    source = inspect.getsource(transport)
    reasons = set(get_args(billing.ErrorReason.__value__)) | set(get_args(saas.ErrorReason.__value__))

    assert [reason for reason in reasons if reason and reason in source] == []


def test_unreachable_upstream_has_no_status(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    monkeypatch.setattr("services.billing_client.transport._send.retry.stop", tenacity.stop_after_attempt(1))
    monkeypatch.setattr(transport, "_http_client", httpx.Client(transport=httpx.MockTransport(handler)))

    with pytest.raises(BillingUpstreamUnavailableError) as exc_info:
        _get(Upstream.BILLING)

    assert exc_info.value.status_code is None
    assert exc_info.value.body is None


def test_request_error_is_retried_then_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    attempts: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        attempts.append(request)
        raise httpx.ConnectError("connection refused", request=request)

    clock = _VirtualClock()
    # Replace tenacity's module reference, not the process-wide time module.
    monkeypatch.setattr(tenacity, "time", clock)
    monkeypatch.setattr("services.billing_client.transport._send.retry.sleep", clock.sleep)
    monkeypatch.setattr(transport, "_http_client", httpx.Client(transport=httpx.MockTransport(handler)))

    with pytest.raises(BillingUpstreamUnavailableError):
        _get(Upstream.BILLING)

    # The next two-second wait would reach the ten-second stop boundary.
    assert len(attempts) == 5
    assert clock.sleeps == [2, 2, 2, 2]


@pytest.mark.parametrize(
    ("upstream", "quota_url", "expected"),
    [
        (Upstream.BILLING, "http://quota/v1", "http://billing/v1/probe"),
        (Upstream.SAAS, "http://quota/v1", "http://billing/v1/probe"),
        (Upstream.BILLING_QUOTA, "http://quota/v1", "http://quota/v1/probe"),
        (Upstream.BILLING_QUOTA, "", "http://billing/v1/probe"),
    ],
)
def test_upstream_selects_base_url(
    config_overrides: Callable[..., None],
    respond_with: RespondWith,
    upstream: Upstream,
    quota_url: str,
    expected: str,
) -> None:
    config_overrides(BILLING_QUOTA_API_URL=quota_url)
    requests = respond_with(httpx.Response(200, json={"ok": True}))

    assert _get(upstream).ok is True
    assert str(requests[0].url) == expected


@pytest.mark.parametrize(
    ("configured", "expected"),
    [
        ("http://network-access/v1/", "http://network-access/v1/probe"),
        ("", "http://billing/v1/probe"),
    ],
)
def test_network_access_upstream_falls_back_to_billing_url(
    respond_with: RespondWith, config_overrides: Callable[..., None], configured: str, expected: str
) -> None:
    config_overrides(NETWORK_ACCESS_API_URL=configured)
    requests = respond_with(httpx.Response(200, json={"ok": True}))

    _get(Upstream.NETWORK_ACCESS)

    assert str(requests[0].url) == expected


def test_invalid_body_is_reported_and_kept_raw_while_observed(
    respond_with: RespondWith, caplog: pytest.LogCaptureFixture
) -> None:
    respond_with(
        httpx.Response(
            200,
            json={
                "enabled": True,
                "subscription": {"plan": "enterprise", "interval": "month", "education": "yes"},
                "members": {"size": "3", "limit": 5},
                "vector_space": None,
                "next_credit_reset_date": "1767225600",
            },
        )
    )

    with caplog.at_level(logging.ERROR, logger=transport.__name__):
        info = transport.request(
            Upstream.BILLING,
            "GET",
            "/probe",
            response_model=billing.GetSubscriptionInfoReply,
            errors=billing.ERRORS,
            path_params={},
            params={},
            body=None,
        )

    assert "GET /probe" in caplog.text
    assert caplog.records[0].exc_info is not None
    assert info.subscription is not None
    assert info.subscription.plan == "enterprise"
    assert info.subscription.interval == "month"
    assert info.subscription.education is True
    assert info.subscription.paid_period_end is None
    assert info.members == billing.SubscriptionQuota(size=3, limit=5)
    assert info.vector_space is None
    assert info.next_credit_reset_date == 1767225600
    assert info.apps is None


@pytest.mark.parametrize(
    ("path", "response_model"),
    [
        ("/subscription/info", billing.GetSubscriptionInfoReply),
        ("/subscription/vector-space", billing.VectorSpaceQuota),
        ("/subscription/knowledge-rate-limit", billing.GetKnowledgeRateLimitReply),
        ("/subscription/payment-link", billing.GetSubscriptionPaymentLinkReply),
        ("/subscription/cleanup/whitelist", billing.ListSubscriptionCleanupWhitelistReply),
        ("/model-provider/payment-link", billing.GetModelProviderPaymentLinkReply),
        ("/invoices", billing.GetInvoicesReply),
    ],
)
def test_migrated_reads_reject_missing_required_fields(
    respond_with: RespondWith, path: str, response_model: type[BillingModel]
) -> None:
    respond_with(httpx.Response(200, json={}))

    with pytest.raises(BillingUpstreamInvalidResponseError):
        transport.request(
            Upstream.BILLING,
            "GET",
            path,
            response_model=response_model,
            errors=billing.ERRORS,
            path_params={},
            params={},
            body=None,
        )


@pytest.mark.parametrize(
    ("method", "path", "response_model"),
    [
        ("GET", "/quota/info", billing.QuotaGetInfoReply),
        ("POST", "/quota/reserve", billing.QuotaReserveReply),
        ("POST", "/quota/commit", billing.QuotaCommitReply),
        ("POST", "/quota/release", billing.QuotaReleaseReply),
        ("GET", "/quota/balance", billing.QuotaGetBalanceReply),
        ("POST", "/quota/consume-capped", billing.QuotaConsumeCappedReply),
    ],
)
def test_quota_responses_reject_missing_required_fields(
    respond_with: RespondWith, method: transport.HTTPMethod, path: str, response_model: type[BillingModel]
) -> None:
    respond_with(httpx.Response(200, json={}))

    with pytest.raises(BillingUpstreamInvalidResponseError):
        transport.request(
            Upstream.BILLING_QUOTA,
            method,
            path,
            response_model=response_model,
            errors=billing.ERRORS,
            path_params={},
            params={},
            body=None,
        )


def test_invalid_body_is_an_invalid_response_once_enforced(
    respond_with: RespondWith, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(transport, "ENFORCED_RESPONSE_PATHS", frozenset({"/probe"}))
    respond_with(httpx.Response(200, json={"ok": "maybe"}))

    with pytest.raises(BillingUpstreamInvalidResponseError):
        _get(Upstream.BILLING)


@pytest.mark.parametrize("content", [b"not json", b"[]"])
def test_non_object_body_is_an_invalid_response(respond_with: RespondWith, content: bytes) -> None:
    respond_with(httpx.Response(200, content=content))

    with pytest.raises(BillingUpstreamInvalidResponseError):
        _get(Upstream.BILLING)


def test_pooled_billing_client_carries_bounded_timeout() -> None:
    """Regression for #39874: a stalled billing proxy must fail fast instead of pinning a worker."""
    assert transport._http_client.timeout.read == 30.0
    assert transport._http_client.timeout.connect == 5.0
