import httpx
import pytest

from services.billing_client import billing, transport
from services.errors.billing import BillingUpstreamInvalidResponseError, BillingUpstreamUnavailableError


@pytest.fixture
def respond_with(monkeypatch: pytest.MonkeyPatch):
    requests: list[httpx.Request] = []

    def install(response: httpx.Response) -> list[httpx.Request]:
        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return response

        monkeypatch.setattr(transport, "_http_client", httpx.Client(transport=httpx.MockTransport(handler)))
        return requests

    monkeypatch.setenv("BILLING_API_URL", "http://billing/v1")
    monkeypatch.setenv("BILLING_QUOTA_API_URL", "http://quota/v1")
    monkeypatch.setenv("BILLING_API_SECRET_KEY", "secret")
    return install


def test_response_coerces_int64_strings_and_ignores_unknown_fields(respond_with) -> None:
    requests = respond_with(
        httpx.Response(
            200,
            json={
                "available": "9007199254740993",
                "reserved": 0,
                "quota": "5",
                "usage": 1,
                "exhausted_at": "0",
                "added_later": True,
            },
        )
    )

    balance = billing.quota_get_balance(tenant_id="t1", feature_key="api_rate_limit", bucket="")

    assert balance.available == 9007199254740993
    assert balance.quota == 5
    assert str(requests[0].url) == "http://quota/v1/quota/balance?tenant_id=t1&feature_key=api_rate_limit&bucket="
    assert requests[0].headers["Billing-Api-Secret-Key"] == "secret"


def test_request_body_is_serialized_from_the_model(respond_with) -> None:
    requests = respond_with(httpx.Response(200, json={"reservation_id": "r1", "available": "1", "reserved": "1"}))
    body = billing.QuotaReserveReq(
        tenant_id="t1", feature_key="trigger_event", request_id="req", amount=2, meta={}, bucket=""
    )

    billing.quota_reserve(body=body)

    assert requests[0].method == "POST"
    assert str(requests[0].url) == "http://quota/v1/quota/reserve"
    assert body.model_validate_json(requests[0].content) == body


def test_missing_required_field_is_an_invalid_response(respond_with) -> None:
    respond_with(httpx.Response(200, json={"available": "1"}))

    with pytest.raises(BillingUpstreamInvalidResponseError):
        billing.quota_get_balance(tenant_id="t1", feature_key="api_rate_limit", bucket="")


@pytest.mark.parametrize(
    ("status", "error"),
    [
        (400, BillingUpstreamInvalidResponseError),
        (429, BillingUpstreamUnavailableError),
        (503, BillingUpstreamUnavailableError),
    ],
)
def test_non_ok_status_maps_to_upstream_errors(respond_with, status: int, error: type[Exception]) -> None:
    respond_with(httpx.Response(status, json={}))

    with pytest.raises(error):
        billing.subscription_get_knowledge_rate_limit(tenant_id="t1")
