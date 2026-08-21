from collections.abc import Iterator
from unittest.mock import MagicMock, call, patch

import httpx
import pytest

from services.billing_service import BillingService, NetworkAccessGroupUpstreamError

TENANT_ID = "11111111-1111-4111-8111-111111111111"
ACCOUNT_ID = "22222222-2222-4222-8222-222222222222"
APP_ID = "33333333-3333-4333-8333-333333333333"
GROUP_ID = "44444444-4444-4444-8444-444444444444"
HEADERS = {"Content-Type": "application/json", "Billing-Api-Secret-Key": "test-secret"}


@pytest.fixture
def billing_config() -> Iterator[None]:
    with (
        patch.object(BillingService, "base_url", "https://billing.internal/v1"),
        patch.object(BillingService, "secret_key", "test-secret"),
    ):
        yield


@pytest.mark.usefixtures("billing_config")
def test_group_list_and_item_reads_use_authenticated_saas_endpoints() -> None:
    response = MagicMock(status_code=httpx.codes.OK)
    response.json.side_effect = [
        {"tenant_id": TENANT_ID, "entitled": True, "groups": []},
        {"group": {"id": GROUP_ID}},
    ]

    with patch("services.billing_service._http_client.request", return_value=response) as request:
        list_result = BillingService.list_network_access_groups(TENANT_ID, ACCOUNT_ID)
        item_result = BillingService.get_network_access_group(TENANT_ID, GROUP_ID, ACCOUNT_ID)

    assert list_result["groups"] == []
    assert item_result["group"]["id"] == GROUP_ID
    assert request.call_args_list == [
        call(
            "GET",
            f"https://billing.internal/v1/tenants/{TENANT_ID}/network-access-groups",
            json=None,
            params={"actor_account_id": ACCOUNT_ID},
            headers=HEADERS,
            follow_redirects=True,
        ),
        call(
            "GET",
            f"https://billing.internal/v1/tenants/{TENANT_ID}/network-access-groups/{GROUP_ID}",
            json=None,
            params={"actor_account_id": ACCOUNT_ID},
            headers=HEADERS,
            follow_redirects=True,
        ),
    ]


@pytest.mark.usefixtures("billing_config")
def test_group_mutations_inject_actor_and_use_expected_version() -> None:
    response = MagicMock(status_code=httpx.codes.OK)
    response.json.side_effect = [
        {"group": {"id": GROUP_ID, "version": "1"}},
        {"group": {"id": GROUP_ID, "version": "2"}},
        {"deleted": True},
    ]

    with patch("services.billing_service._http_client.request", return_value=response) as request:
        BillingService.create_network_access_group(
            TENANT_ID,
            name="Office",
            description="Office egress",
            mode="enforce",
            allowed_cidrs=["203.0.113.7/32"],
            actor_account_id=ACCOUNT_ID,
        )
        BillingService.update_network_access_group(
            TENANT_ID,
            GROUP_ID,
            name="Office",
            description="Updated office egress",
            mode="shadow",
            allowed_cidrs=["203.0.113.0/24"],
            expected_version=1,
            actor_account_id=ACCOUNT_ID,
        )
        BillingService.delete_network_access_group(
            TENANT_ID,
            GROUP_ID,
            expected_version=2,
            actor_account_id=ACCOUNT_ID,
        )

    assert request.call_args_list == [
        call(
            "POST",
            f"https://billing.internal/v1/tenants/{TENANT_ID}/network-access-groups",
            json={
                "name": "Office",
                "description": "Office egress",
                "mode": "enforce",
                "allowed_cidrs": ["203.0.113.7/32"],
                "actor_account_id": ACCOUNT_ID,
            },
            params=None,
            headers=HEADERS,
            follow_redirects=True,
        ),
        call(
            "PUT",
            f"https://billing.internal/v1/tenants/{TENANT_ID}/network-access-groups/{GROUP_ID}",
            json={
                "name": "Office",
                "description": "Updated office egress",
                "mode": "shadow",
                "allowed_cidrs": ["203.0.113.0/24"],
                "expected_version": 1,
                "actor_account_id": ACCOUNT_ID,
            },
            params=None,
            headers=HEADERS,
            follow_redirects=True,
        ),
        call(
            "DELETE",
            f"https://billing.internal/v1/tenants/{TENANT_ID}/network-access-groups/{GROUP_ID}",
            json=None,
            params={"expected_version": 2, "actor_account_id": ACCOUNT_ID},
            headers=HEADERS,
            follow_redirects=True,
        ),
    ]


@pytest.mark.usefixtures("billing_config")
def test_app_binding_read_and_write_use_tenant_and_app_path() -> None:
    response = MagicMock(status_code=httpx.codes.OK)
    response.json.side_effect = [
        {"tenant_id": TENANT_ID, "app_id": APP_ID, "entitled": True, "binding": None},
        {"binding": {"app_id": APP_ID, "group_id": GROUP_ID, "version": "1"}},
        {"binding": {"app_id": APP_ID, "group_id": None, "version": "2"}},
    ]

    with patch("services.billing_service._http_client.request", return_value=response) as request:
        BillingService.get_app_network_access_group(TENANT_ID, APP_ID, ACCOUNT_ID)
        BillingService.update_app_network_access_group(
            TENANT_ID,
            APP_ID,
            group_id=GROUP_ID,
            expected_version=0,
            actor_account_id=ACCOUNT_ID,
        )
        BillingService.update_app_network_access_group(
            TENANT_ID,
            APP_ID,
            group_id=None,
            expected_version=1,
            actor_account_id=ACCOUNT_ID,
        )

    endpoint = f"https://billing.internal/v1/tenants/{TENANT_ID}/apps/{APP_ID}/network-access-group"
    assert request.call_args_list == [
        call(
            "GET",
            endpoint,
            json=None,
            params={"actor_account_id": ACCOUNT_ID},
            headers=HEADERS,
            follow_redirects=True,
        ),
        call(
            "PUT",
            endpoint,
            json={"group_id": GROUP_ID, "expected_version": 0, "actor_account_id": ACCOUNT_ID},
            params=None,
            headers=HEADERS,
            follow_redirects=True,
        ),
        call(
            "PUT",
            endpoint,
            json={"group_id": None, "expected_version": 1, "actor_account_id": ACCOUNT_ID},
            params=None,
            headers=HEADERS,
            follow_redirects=True,
        ),
    ]


@pytest.mark.parametrize("status_code", [400, 403, 404, 409, 500])
def test_network_access_group_request_preserves_upstream_status(status_code: int) -> None:
    response = MagicMock(status_code=status_code)
    with (
        patch.object(BillingService, "_send_network_access_group_http_request", return_value=response),
        pytest.raises(NetworkAccessGroupUpstreamError) as exc_info,
    ):
        BillingService._send_network_access_group_request("GET", "/groups")

    assert exc_info.value.status_code == status_code


def test_network_access_group_request_preserves_whitelisted_upstream_reason() -> None:
    response = MagicMock(status_code=httpx.codes.CONFLICT)
    response.json.return_value = {"code": 409, "reason": "NETWORK_ACCESS_GROUP_BOUND", "message": "internal"}
    with (
        patch.object(BillingService, "_send_network_access_group_http_request", return_value=response),
        pytest.raises(NetworkAccessGroupUpstreamError) as exc_info,
    ):
        BillingService._send_network_access_group_request("DELETE", "/groups/id")

    assert exc_info.value.status_code == httpx.codes.CONFLICT
    assert exc_info.value.reason == "NETWORK_ACCESS_GROUP_BOUND"


def test_network_access_group_request_maps_transport_failure_to_service_unavailable() -> None:
    request = httpx.Request("GET", "https://billing.internal/v1/groups")
    with (
        patch.object(
            BillingService,
            "_send_network_access_group_http_request",
            side_effect=httpx.ConnectError("unavailable", request=request),
        ),
        pytest.raises(NetworkAccessGroupUpstreamError) as exc_info,
    ):
        BillingService._send_network_access_group_request("GET", "/groups")

    assert exc_info.value.status_code == httpx.codes.SERVICE_UNAVAILABLE


def test_network_access_group_request_rejects_non_object_response() -> None:
    response = MagicMock(status_code=httpx.codes.OK)
    response.json.return_value = list[object]()
    with (
        patch.object(BillingService, "_send_network_access_group_http_request", return_value=response),
        pytest.raises(NetworkAccessGroupUpstreamError) as exc_info,
    ):
        BillingService._send_network_access_group_request("GET", "/groups")

    assert exc_info.value.status_code == httpx.codes.BAD_GATEWAY
