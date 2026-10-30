import httpx
import pytest

from services.billing_client import billing
from services.errors.billing import BillingUpstreamInvalidResponseError
from tests.unit_tests.services.billing_client.conftest import RespondWith


def test_response_coerces_int64_strings_and_ignores_unknown_fields(respond_with: RespondWith) -> None:
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


def test_request_body_is_serialized_from_the_model(respond_with: RespondWith) -> None:
    requests = respond_with(httpx.Response(200, json={"reservation_id": "r1", "available": "1", "reserved": "1"}))
    body = billing.QuotaReserveReq(
        tenant_id="t1", feature_key="trigger_event", request_id="req", amount=2, meta={}, bucket=""
    )

    billing.quota_reserve(body=body)

    assert requests[0].method == "POST"
    assert str(requests[0].url) == "http://quota/v1/quota/reserve"
    assert body.model_validate_json(requests[0].content) == body


def test_missing_required_field_is_an_invalid_response(respond_with: RespondWith) -> None:
    respond_with(httpx.Response(200, json={"available": "1"}))

    with pytest.raises(BillingUpstreamInvalidResponseError):
        billing.quota_get_balance(tenant_id="t1", feature_key="api_rate_limit", bucket="")


def test_omitted_optional_field_parses_as_none(respond_with: RespondWith) -> None:
    respond_with(httpx.Response(200, json={"size": 1.25, "limit": "50"}))

    quota = billing.subscription_get_subscription_vector_space(tenant_id="t1", bypass_cache=False)

    assert quota.size == 1.25
    assert quota.limit == 50
    assert quota.usage_unknown is None
