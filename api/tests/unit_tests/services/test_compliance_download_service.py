from unittest.mock import MagicMock

import pytest

from machinery.context import RequestContext
from machinery.errors import ActiveWorkspaceRequiredError
from services.compliance_download_service import ComplianceDownloadRateLimiter, ComplianceDownloadService
from services.errors.billing import BillingUpstreamUnavailableError, ComplianceRateLimitExceededError


@pytest.fixture
def fetch_link() -> MagicMock:
    return MagicMock()


@pytest.fixture
def rate_limiter() -> MagicMock:
    limiter = MagicMock(spec=ComplianceDownloadRateLimiter)
    limiter.is_rate_limited.return_value = False
    return limiter


@pytest.fixture
def request_context() -> RequestContext:
    return RequestContext(
        request_id="request-1",
        trace_id="trace-1",
        account_id="account-1",
        active_workspace_id="workspace-1",
    )


@pytest.fixture
def service(
    fetch_link: MagicMock,
    rate_limiter: MagicMock,
) -> ComplianceDownloadService:
    return ComplianceDownloadService(
        fetch_link=fetch_link,
        rate_limiter=rate_limiter,
    )


def test_get_link_checks_limit_fetches_and_increments(
    service: ComplianceDownloadService,
    request_context: RequestContext,
    fetch_link: MagicMock,
    rate_limiter: MagicMock,
) -> None:
    events: list[str] = []
    rate_limiter.is_rate_limited.side_effect = lambda _key: events.append("check") or False
    fetch_link.side_effect = lambda *_args: events.append("fetch") or {"url": "https://example.com/report"}
    rate_limiter.increment_rate_limit.side_effect = lambda _key: events.append("increment")

    result = service.get_link(
        request_context=request_context,
        document_name="SOC2_Type_II",
        ip_address="127.0.0.1",
        device_info="test-agent",
    )

    assert result == {"url": "https://example.com/report"}
    assert events == ["check", "fetch", "increment"]
    rate_limiter.is_rate_limited.assert_called_once_with("account-1:workspace-1")
    fetch_link.assert_called_once_with(
        "SOC2_Type_II",
        "account-1",
        "workspace-1",
        "127.0.0.1",
        "test-agent",
    )
    rate_limiter.increment_rate_limit.assert_called_once_with("account-1:workspace-1")


def test_get_link_rejects_rate_limited_request(
    service: ComplianceDownloadService,
    request_context: RequestContext,
    fetch_link: MagicMock,
    rate_limiter: MagicMock,
) -> None:
    rate_limiter.is_rate_limited.return_value = True

    with pytest.raises(ComplianceRateLimitExceededError):
        service.get_link(
            request_context=request_context,
            document_name="SOC2_Type_II",
            ip_address="127.0.0.1",
            device_info="test-agent",
        )

    fetch_link.assert_not_called()
    rate_limiter.increment_rate_limit.assert_not_called()


def test_get_link_does_not_increment_after_fetch_failure(
    service: ComplianceDownloadService,
    request_context: RequestContext,
    fetch_link: MagicMock,
    rate_limiter: MagicMock,
) -> None:
    fetch_link.side_effect = BillingUpstreamUnavailableError

    with pytest.raises(BillingUpstreamUnavailableError):
        service.get_link(
            request_context=request_context,
            document_name="SOC2_Type_II",
            ip_address="127.0.0.1",
            device_info="test-agent",
        )

    rate_limiter.increment_rate_limit.assert_not_called()


def test_get_link_requires_active_workspace(
    service: ComplianceDownloadService,
    fetch_link: MagicMock,
    rate_limiter: MagicMock,
) -> None:
    request_context = RequestContext(
        request_id="request-1",
        trace_id="trace-1",
        account_id="account-1",
        active_workspace_id=None,
    )

    with pytest.raises(ActiveWorkspaceRequiredError):
        service.get_link(
            request_context=request_context,
            document_name="SOC2_Type_II",
            ip_address="127.0.0.1",
            device_info="test-agent",
        )

    rate_limiter.is_rate_limited.assert_not_called()
    fetch_link.assert_not_called()
    rate_limiter.increment_rate_limit.assert_not_called()
