from unittest.mock import MagicMock, patch

import httpx
import pytest

from services.billing_service import BillingService, NetworkAccessPolicyUpstreamError


@pytest.fixture
def billing_config():
    with (
        patch.object(BillingService, "base_url", "https://billing.internal/v1"),
        patch.object(BillingService, "secret_key", "test-secret"),
    ):
        yield


@pytest.mark.usefixtures("billing_config")
def test_get_network_access_policies_uses_authenticated_saas_endpoint():
    response = MagicMock(status_code=httpx.codes.OK)
    response.json.return_value = {"tenant_id": "tenant-1", "entitled": True, "policies": []}

    with patch("services.billing_service._http_client.request", return_value=response) as request:
        result = BillingService.get_network_access_policies("tenant-1", "account-1")

    assert result == {"tenant_id": "tenant-1", "entitled": True, "policies": []}
    request.assert_called_once_with(
        "GET",
        "https://billing.internal/v1/tenants/tenant-1/network-access-policies",
        json=None,
        params={"actor_account_id": "account-1"},
        headers={"Content-Type": "application/json", "Billing-Api-Secret-Key": "test-secret"},
        follow_redirects=True,
    )


@pytest.mark.usefixtures("billing_config")
def test_update_network_access_policy_injects_actor_and_scope():
    response = MagicMock(status_code=httpx.codes.OK)
    response.json.return_value = {
        "policy": {
            "scope": "service_api",
            "mode": "enforce",
            "allowed_cidrs": ["203.0.113.7/32"],
            "version": 2,
        }
    }

    with patch("services.billing_service._http_client.request", return_value=response) as request:
        result = BillingService.update_network_access_policy(
            "tenant-1",
            "service_api",
            mode="enforce",
            allowed_cidrs=["203.0.113.7/32"],
            expected_version=1,
            actor_account_id="account-1",
        )

    assert result["policy"]["version"] == 2
    request.assert_called_once_with(
        "PUT",
        "https://billing.internal/v1/tenants/tenant-1/network-access-policies/service_api",
        json={
            "mode": "enforce",
            "allowed_cidrs": ["203.0.113.7/32"],
            "expected_version": 1,
            "actor_account_id": "account-1",
        },
        params=None,
        headers={"Content-Type": "application/json", "Billing-Api-Secret-Key": "test-secret"},
        follow_redirects=True,
    )


@pytest.mark.parametrize("status_code", [400, 403, 404, 409, 500])
def test_network_access_policy_request_preserves_upstream_status(status_code):
    response = MagicMock(status_code=status_code)
    with (
        patch.object(BillingService, "_send_network_access_policy_http_request", return_value=response),
        pytest.raises(NetworkAccessPolicyUpstreamError) as exc_info,
    ):
        BillingService._send_network_access_policy_request("GET", "/policies")

    assert exc_info.value.status_code == status_code


def test_network_access_policy_request_maps_transport_failure_to_service_unavailable():
    request = httpx.Request("GET", "https://billing.internal/v1/policies")
    with (
        patch.object(
            BillingService,
            "_send_network_access_policy_http_request",
            side_effect=httpx.ConnectError("unavailable", request=request),
        ),
        pytest.raises(NetworkAccessPolicyUpstreamError) as exc_info,
    ):
        BillingService._send_network_access_policy_request("GET", "/policies")

    assert exc_info.value.status_code == httpx.codes.SERVICE_UNAVAILABLE


def test_network_access_policy_request_rejects_non_object_response():
    response = MagicMock(status_code=httpx.codes.OK)
    response.json.return_value = []
    with (
        patch.object(BillingService, "_send_network_access_policy_http_request", return_value=response),
        pytest.raises(NetworkAccessPolicyUpstreamError) as exc_info,
    ):
        BillingService._send_network_access_policy_request("GET", "/policies")

    assert exc_info.value.status_code == httpx.codes.BAD_GATEWAY
