import httpx
import pytest
import tenacity

from services.billing_client import transport
from services.billing_client.transport import BillingModel, Upstream
from services.errors.billing import BillingUpstreamInvalidResponseError, BillingUpstreamUnavailableError
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
    return transport.request(upstream, "GET", "/probe", response_model=_Reply, path_params={}, params={}, body=None)


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
    respond_with(httpx.Response(status, json={}))

    with pytest.raises(error):
        _get(Upstream.BILLING)


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
    monkeypatch: pytest.MonkeyPatch, respond_with: RespondWith, upstream: Upstream, quota_url: str, expected: str
) -> None:
    monkeypatch.setenv("BILLING_QUOTA_API_URL", quota_url)
    requests = respond_with(httpx.Response(200, json={"ok": True}))

    assert _get(upstream).ok is True
    assert str(requests[0].url) == expected
