from collections.abc import Callable, Generator
from typing import Protocol, cast, override
from unittest.mock import MagicMock, call, patch

import httpx
import pytest

from enums import CloudPlan
from services.billing_service import _BillingHTTPStatusError
from services.network_access_group_gateway import (
    BillingNetworkAccessGroupEntitlementGateway,
    NetworkAccessGroupGateway,
)
from services.network_access_group_service import (
    NetworkAccessGroupEntitlementUnavailableError,
    NetworkAccessGroupInvalidResponseError,
    NetworkAccessGroupUpstreamError,
)

TENANT_ID = "11111111-1111-4111-8111-111111111111"
ACCOUNT_ID = "22222222-2222-4222-8222-222222222222"
APP_ID = "33333333-3333-4333-8333-333333333333"
GROUP_ID = "44444444-4444-4444-8444-444444444444"
HEADERS = {"Content-Type": "application/json", "Billing-Api-Secret-Key": "test-secret"}


def _group_wire(**overrides: object) -> dict[str, object]:
    return {
        "id": GROUP_ID,
        "tenant_id": TENANT_ID,
        "name": "Office",
        "allowed_cidrs": ["203.0.113.7/32"],
        "version": "1",
        "created_at": "2026-09-01T00:00:00Z",
        "updated_at": "2026-09-01T00:00:00Z",
        **overrides,
    }


def _binding_wire(**overrides: object) -> dict[str, object]:
    return {
        "id": GROUP_ID,
        "tenant_id": TENANT_ID,
        "app_id": APP_ID,
        "version": "1",
        "created_at": "2026-09-01T00:00:00Z",
        "updated_at": "2026-09-01T00:00:00Z",
        **overrides,
    }


class RecordingHTTPClient(httpx.Client):
    """Exercise httpx serialization while keeping all requests inside MockTransport."""

    def __init__(self) -> None:
        self.response: httpx.Response | MagicMock = httpx.Response(200, json={})
        self.request_calls: list[object] = []
        self.wire_requests: list[httpx.Request] = []
        super().__init__(
            transport=httpx.MockTransport(self._respond),
            timeout=httpx.Timeout(30.0, connect=5.0),
            trust_env=False,
        )

    @override
    def request(self, *args: object, **kwargs: object) -> httpx.Response:
        self.request_calls.append(call(*args, **kwargs))
        return cast(Callable[..., httpx.Response], super().request)(*args, **kwargs)

    def _respond(self, request: httpx.Request) -> httpx.Response:
        self.wire_requests.append(request)
        if isinstance(self.response, httpx.Response):
            return httpx.Response(
                self.response.status_code, content=self.response.content, headers=self.response.headers
            )
        return httpx.Response(self.response.status_code, json=self.response.json())


class GatewayFactory(Protocol):
    def __call__(
        self, *, base_url: str = "https://network-access.internal/v1/"
    ) -> tuple[NetworkAccessGroupGateway, RecordingHTTPClient]: ...


@pytest.fixture
def gateway_factory() -> Generator[GatewayFactory]:
    clients: list[RecordingHTTPClient] = []

    def create(
        *, base_url: str = "https://network-access.internal/v1/"
    ) -> tuple[NetworkAccessGroupGateway, RecordingHTTPClient]:
        http_client = RecordingHTTPClient()
        clients.append(http_client)
        return (
            NetworkAccessGroupGateway(
                base_url=base_url,
                fallback_base_url="https://billing.internal/v1",
                secret_key="test-secret",
                http_client=http_client,
            ),
            http_client,
        )

    try:
        yield create
    finally:
        for client in clients:
            client.close()
            assert client.is_closed


def test_network_access_requests_use_independent_api_url_when_configured(gateway_factory: GatewayFactory) -> None:
    gateway, http_client = gateway_factory()
    response = MagicMock(status_code=httpx.codes.OK)
    response.json.return_value = {"tenant_id": TENANT_ID, "entitled": True, "groups": list[object]()}
    http_client.response = response

    gateway.list_groups(TENANT_ID, ACCOUNT_ID)

    assert http_client.request_calls == [
        call(
            "GET",
            f"https://network-access.internal/v1/tenants/{TENANT_ID}/network-access-groups",
            json=None,
            params={"actor_account_id": ACCOUNT_ID},
            headers=HEADERS,
            follow_redirects=True,
        )
    ]


def test_network_access_requests_fall_back_to_billing_api_url(gateway_factory: GatewayFactory) -> None:
    gateway, http_client = gateway_factory(base_url="")
    response = MagicMock(status_code=httpx.codes.OK)
    response.json.return_value = {"tenant_id": TENANT_ID, "entitled": True, "groups": list[object]()}
    http_client.response = response

    gateway.list_groups(TENANT_ID, ACCOUNT_ID)

    assert http_client.request_calls == [
        call(
            "GET",
            f"https://billing.internal/v1/tenants/{TENANT_ID}/network-access-groups",
            json=None,
            params={"actor_account_id": ACCOUNT_ID},
            headers=HEADERS,
            follow_redirects=True,
        )
    ]


def test_injected_http_client_keeps_timeout_and_remains_reusable(gateway_factory: GatewayFactory) -> None:
    gateway, client = gateway_factory()
    client.response = httpx.Response(200, json={"tenant_id": TENANT_ID, "entitled": True, "groups": []})

    gateway.list_groups(TENANT_ID, ACCOUNT_ID)

    first = client.wire_requests[0]
    assert first.method == "GET"
    assert str(first.url) == (
        f"https://network-access.internal/v1/tenants/{TENANT_ID}/network-access-groups?actor_account_id={ACCOUNT_ID}"
    )
    assert first.headers["Billing-Api-Secret-Key"] == "test-secret"
    assert first.headers["Content-Type"] == "application/json"
    assert first.content == b""
    assert first.extensions["timeout"] == {"connect": 5.0, "read": 30.0, "write": 30.0, "pool": 30.0}
    assert not client.is_closed

    client.timeout = httpx.Timeout(8.0, connect=1.5)
    gateway.list_groups(TENANT_ID, ACCOUNT_ID)

    assert len(client.wire_requests) == 2
    assert client.wire_requests[1].extensions["timeout"] == {
        "connect": 1.5,
        "read": 8.0,
        "write": 8.0,
        "pool": 8.0,
    }
    assert not client.is_closed


def test_group_list_and_item_reads_use_authenticated_saas_endpoints(gateway_factory: GatewayFactory) -> None:
    gateway, http_client = gateway_factory(base_url="")
    response = MagicMock(status_code=httpx.codes.OK)
    response.json.side_effect = [
        {"tenant_id": TENANT_ID, "entitled": True, "groups": list[object]()},
        {"group": _group_wire()},
    ]
    http_client.response = response

    list_result = gateway.list_groups(TENANT_ID, ACCOUNT_ID)
    item_result = gateway.get_group(TENANT_ID, GROUP_ID, ACCOUNT_ID)

    assert list_result.groups == ()
    assert item_result.id == GROUP_ID
    assert http_client.request_calls == [
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


def test_group_mutations_inject_actor_and_use_expected_version(gateway_factory: GatewayFactory) -> None:
    gateway, http_client = gateway_factory(base_url="")
    response = MagicMock(status_code=httpx.codes.OK)
    response.json.side_effect = [
        {"group": _group_wire(version="1")},
        {"group": _group_wire(version="2")},
        {"deleted": True},
    ]
    http_client.response = response

    gateway.create_group(
        TENANT_ID,
        name="Office",
        description="Office egress",
        allowed_cidrs=["203.0.113.7/32"],
        actor_account_id=ACCOUNT_ID,
    )
    gateway.update_group(
        TENANT_ID,
        GROUP_ID,
        name="Office",
        description="Updated office egress",
        allowed_cidrs=["203.0.113.0/24"],
        expected_version=1,
        actor_account_id=ACCOUNT_ID,
    )
    gateway.delete_group(
        TENANT_ID,
        GROUP_ID,
        expected_version=2,
        actor_account_id=ACCOUNT_ID,
    )

    assert http_client.request_calls == [
        call(
            "POST",
            f"https://billing.internal/v1/tenants/{TENANT_ID}/network-access-groups",
            json={
                "name": "Office",
                "description": "Office egress",
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


def test_app_config_read_and_atomic_write_use_tenant_and_app_path(gateway_factory: GatewayFactory) -> None:
    gateway, http_client = gateway_factory(base_url="")
    response = MagicMock(status_code=httpx.codes.OK)
    response.json.side_effect = [
        {"tenant_id": TENANT_ID, "app_id": APP_ID, "entitled": True, "binding": None},
        {
            "binding": _binding_wire(
                enabled=True, group_id=GROUP_ID, access_points=["webapp", "service_api"], version="1"
            )
        },
        {
            "binding": _binding_wire(
                enabled=False, group_id=GROUP_ID, access_points=["webapp", "service_api"], version="2"
            )
        },
    ]
    http_client.response = response

    gateway.get_app_binding(TENANT_ID, APP_ID, ACCOUNT_ID)
    gateway.update_app_binding(
        TENANT_ID,
        APP_ID,
        enabled=True,
        group_id=GROUP_ID,
        access_points=["webapp", "service_api"],
        expected_version=0,
        actor_account_id=ACCOUNT_ID,
    )
    gateway.update_app_binding(
        TENANT_ID,
        APP_ID,
        enabled=False,
        group_id=GROUP_ID,
        access_points=["webapp", "service_api"],
        expected_version=1,
        actor_account_id=ACCOUNT_ID,
    )

    endpoint = f"https://billing.internal/v1/tenants/{TENANT_ID}/apps/{APP_ID}/network-access-group"
    assert http_client.request_calls == [
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
            json={
                "enabled": True,
                "group_id": GROUP_ID,
                "access_points": ["webapp", "service_api"],
                "expected_version": 0,
                "actor_account_id": ACCOUNT_ID,
            },
            params=None,
            headers=HEADERS,
            follow_redirects=True,
        ),
        call(
            "PUT",
            endpoint,
            json={
                "enabled": False,
                "group_id": GROUP_ID,
                "access_points": ["webapp", "service_api"],
                "expected_version": 1,
                "actor_account_id": ACCOUNT_ID,
            },
            params=None,
            headers=HEADERS,
            follow_redirects=True,
        ),
    ]


def test_app_lifecycle_cleanup_uses_internal_secret_endpoint(gateway_factory: GatewayFactory) -> None:
    gateway, http_client = gateway_factory(base_url="")
    response = MagicMock(status_code=httpx.codes.OK)
    response.json.return_value = {"deleted": True}
    http_client.response = response

    result = gateway.cleanup_app_binding(TENANT_ID, APP_ID)

    assert result is True
    assert http_client.request_calls == [
        call(
            "DELETE",
            f"https://billing.internal/v1/tenants/{TENANT_ID}/apps/{APP_ID}/network-access-group-binding",
            json=None,
            params=None,
            headers=HEADERS,
            follow_redirects=True,
        )
    ]


@pytest.mark.parametrize("status_code", [400, 403, 404, 409, 500, 503])
def test_network_access_group_request_preserves_upstream_status(
    status_code: int, gateway_factory: GatewayFactory
) -> None:
    gateway, _ = gateway_factory()
    response = MagicMock(status_code=status_code)
    with (
        patch.object(gateway, "_send_http_request", return_value=response),
        pytest.raises(NetworkAccessGroupUpstreamError) as exc_info,
    ):
        gateway._send_request("GET", "/groups")

    assert exc_info.value.status_code == status_code


def test_network_access_group_request_preserves_upstream_reason(gateway_factory: GatewayFactory) -> None:
    gateway, _ = gateway_factory()
    response = MagicMock(status_code=httpx.codes.CONFLICT)
    response.json.return_value = {"code": 409, "reason": "NETWORK_ACCESS_VERSION_CONFLICT", "message": "internal"}
    with (
        patch.object(gateway, "_send_http_request", return_value=response),
        pytest.raises(NetworkAccessGroupUpstreamError) as exc_info,
    ):
        gateway._send_request("DELETE", "/groups/id")

    assert exc_info.value.status_code == httpx.codes.CONFLICT
    assert exc_info.value.reason == "NETWORK_ACCESS_VERSION_CONFLICT"


def test_network_access_group_request_maps_transport_failure_to_service_unavailable(
    gateway_factory: GatewayFactory,
) -> None:
    gateway, _ = gateway_factory()
    request = httpx.Request("GET", "https://network-access.internal/v1/groups")
    with (
        patch.object(
            gateway,
            "_send_http_request",
            side_effect=httpx.ConnectError("unavailable", request=request),
        ),
        pytest.raises(NetworkAccessGroupUpstreamError) as exc_info,
    ):
        gateway._send_request("GET", "/groups")

    assert exc_info.value.status_code == httpx.codes.SERVICE_UNAVAILABLE


def test_network_access_group_request_rejects_non_object_response(gateway_factory: GatewayFactory) -> None:
    gateway, _ = gateway_factory()
    response = MagicMock(status_code=httpx.codes.OK)
    response.json.return_value = list[object]()
    with (
        patch.object(gateway, "_send_http_request", return_value=response),
        pytest.raises(NetworkAccessGroupInvalidResponseError),
    ):
        gateway._send_request("GET", "/groups")


@pytest.mark.parametrize("body", [b"{", b"\xff", b""])
def test_invalid_json_is_rejected_after_transport_receives_raw_response(
    gateway_factory: GatewayFactory, body: bytes
) -> None:
    gateway, client = gateway_factory()
    client.response = httpx.Response(200, content=body, headers={"Content-Type": "application/json"})

    with pytest.raises(NetworkAccessGroupInvalidResponseError) as raised:
        gateway._send_request("GET", "/groups")

    assert isinstance(raised.value.__cause__, ValueError)
    assert len(client.wire_requests) == 1
    assert not client.is_closed


@pytest.mark.parametrize("plan", [CloudPlan.PROFESSIONAL, CloudPlan.TEAM])
def test_billing_entitlement_gateway_accepts_paid_plans(plan: CloudPlan) -> None:
    gateway = BillingNetworkAccessGroupEntitlementGateway()
    with patch(
        "services.network_access_group_gateway.BillingService.get_info",
        return_value={"subscription": {"plan": plan}},
    ) as get_info:
        assert gateway.is_paid_plan(TENANT_ID) is True

    get_info.assert_called_once_with(TENANT_ID, exclude_vector_space=True)


def test_billing_entitlement_gateway_rejects_unpaid_plan() -> None:
    gateway = BillingNetworkAccessGroupEntitlementGateway()
    with patch(
        "services.network_access_group_gateway.BillingService.get_info",
        return_value={"subscription": {"plan": CloudPlan.SANDBOX}},
    ):
        assert gateway.is_paid_plan(TENANT_ID) is False


def test_billing_entitlement_gateway_maps_unavailable_billing_service() -> None:
    gateway = BillingNetworkAccessGroupEntitlementGateway()
    with (
        patch(
            "services.network_access_group_gateway.BillingService.get_info",
            side_effect=httpx.ConnectError("unavailable"),
        ),
        pytest.raises(NetworkAccessGroupEntitlementUnavailableError),
    ):
        gateway.is_paid_plan(TENANT_ID)


def test_billing_entitlement_gateway_maps_billing_http_status_error() -> None:
    gateway = BillingNetworkAccessGroupEntitlementGateway()
    with (
        patch(
            "services.network_access_group_gateway.BillingService.get_info",
            side_effect=_BillingHTTPStatusError("unavailable", 503),
        ),
        pytest.raises(NetworkAccessGroupEntitlementUnavailableError),
    ):
        gateway.is_paid_plan(TENANT_ID)


def test_billing_entitlement_gateway_does_not_mask_unexpected_value_error() -> None:
    gateway = BillingNetworkAccessGroupEntitlementGateway()
    with (
        patch(
            "services.network_access_group_gateway.BillingService.get_info",
            side_effect=ValueError("programming error"),
        ),
        pytest.raises(ValueError, match="programming error"),
    ):
        gateway.is_paid_plan(TENANT_ID)


def test_protojson_defaults_are_materialized_before_service_boundary(gateway_factory: GatewayFactory) -> None:
    gateway, client = gateway_factory()
    response = MagicMock(status_code=200)
    client.response = response
    response.json.return_value = {"tenantId": TENANT_ID}
    groups = gateway.list_groups(TENANT_ID, ACCOUNT_ID)
    assert groups.entitled is False
    assert groups.groups == ()

    for binding in (None, _binding_wire()):
        response.json.return_value = {"tenantId": TENANT_ID, "appId": APP_ID, "binding": binding}
        result = gateway.get_app_binding(TENANT_ID, APP_ID, ACCOUNT_ID)
        assert result.entitled is False
        assert result.effective_enabled is False
        if binding is None:
            assert result.binding is None
        else:
            assert result.binding is not None
            assert result.binding.enabled is False
            assert result.binding.access_points == ()
            assert result.binding.group_id is None

    response.json.return_value = {"tenantId": TENANT_ID, "appId": APP_ID}
    assert gateway.get_app_binding(TENANT_ID, APP_ID, ACCOUNT_ID).binding is None
    response.json.return_value = dict[str, object]()
    assert gateway.cleanup_app_binding(TENANT_ID, APP_ID) is False


def test_policy_protojson_aliases_and_count_defaults_are_decoded_once(gateway_factory: GatewayFactory) -> None:
    gateway, client = gateway_factory()
    wire = {
        "id": GROUP_ID,
        "tenantId": TENANT_ID,
        "name": "Office",
        "allowedCidrs": ["203.0.113.7/32"],
        "version": "9007199254740993",
        "usedByAppIds": [APP_ID],
        "createdAt": "2026-09-01T00:00:00Z",
        "updatedAt": "2026-09-01T00:00:00Z",
    }
    response = MagicMock(status_code=200)
    response.json.return_value = {"group": wire}
    client.response = response
    result = gateway.get_group(TENANT_ID, GROUP_ID, ACCOUNT_ID)
    assert result.version == 9007199254740993
    assert result.used_by_count == 1  # Legacy replies without a count retain the reference fallback.
    assert result.enforcing_count == 0
    assert result.allowed_cidrs == ("203.0.113.7/32",)
    assert result.app_ids == (APP_ID,)
    assert result.description == ""
    assert result.updated_by_account_id is None
    assert "enforcing_count" not in wire


@pytest.mark.parametrize("alias", ["group_id", "groupId", "policy_id", "policyId"])
@pytest.mark.parametrize("group_id", [GROUP_ID, None, ""])
def test_binding_policy_aliases_and_nullable_references(
    alias: str, group_id: str | None, gateway_factory: GatewayFactory
) -> None:
    gateway, client = gateway_factory()
    response = MagicMock(status_code=200)
    response.json.return_value = {"tenantId": TENANT_ID, "appId": APP_ID, "binding": _binding_wire(**{alias: group_id})}
    client.response = response
    binding = gateway.get_app_binding(TENANT_ID, APP_ID, ACCOUNT_ID).binding
    assert binding is not None
    assert binding.group_id == (group_id or None)


def test_unknown_scopes_reach_service_without_aliases_or_mutable_payload(gateway_factory: GatewayFactory) -> None:
    gateway, client = gateway_factory()
    scopes = ["webapp", "future_scope", "trigger"]
    response = MagicMock(status_code=200)
    response.json.return_value = {
        "effectiveEnabled": True,
        "binding": _binding_wire(enabled=True, policyId=GROUP_ID, accessPoints=scopes),
    }
    client.response = response
    result = gateway.update_app_binding(
        TENANT_ID,
        APP_ID,
        enabled=True,
        group_id=GROUP_ID,
        access_points=["webapp"],
        expected_version=1,
        actor_account_id=ACCOUNT_ID,
    )
    assert result.binding.access_points == ("webapp", "future_scope", "trigger")
    assert result.binding.group_id == GROUP_ID
    assert result.effective_enabled is True
    scopes.clear()
    assert result.binding.access_points == ("webapp", "future_scope", "trigger")


@pytest.mark.parametrize("value", [True, False, 1.0, "1.5", "invalid", 0, -1, 2**63, str(2**63)])
def test_invalid_versions_are_rejected_at_gateway(value: object, gateway_factory: GatewayFactory) -> None:
    gateway, client = gateway_factory()
    response = MagicMock(status_code=200)
    response.json.return_value = {"group": _group_wire(version=value)}
    client.response = response
    with pytest.raises(NetworkAccessGroupInvalidResponseError):
        gateway.get_group(TENANT_ID, GROUP_ID, ACCOUNT_ID)


@pytest.mark.parametrize("version", [1, "1", 2**63 - 1, str(2**63 - 1)])
def test_int64_versions_do_not_lose_precision(version: int | str, gateway_factory: GatewayFactory) -> None:
    gateway, client = gateway_factory()
    response = MagicMock(status_code=200)
    response.json.return_value = {"group": _group_wire(version=version)}
    client.response = response
    assert gateway.get_group(TENANT_ID, GROUP_ID, ACCOUNT_ID).version == int(version)


@pytest.mark.parametrize("field", ["entitled", "effective_enabled", "enabled"])
@pytest.mark.parametrize("value", ["false", "true", 0, 1, None])
def test_wire_flags_are_strict_booleans(field: str, value: object, gateway_factory: GatewayFactory) -> None:
    gateway, client = gateway_factory()
    binding = _binding_wire()
    payload: dict[str, object] = {"tenant_id": TENANT_ID, "app_id": APP_ID, "binding": binding}
    (binding if field == "enabled" else payload)[field] = value
    response = MagicMock(status_code=200)
    response.json.return_value = payload
    client.response = response
    with pytest.raises(NetworkAccessGroupInvalidResponseError):
        gateway.get_app_binding(TENANT_ID, APP_ID, ACCOUNT_ID)


@pytest.mark.parametrize("alias", ["groupId", "policy_id", "policyId"])
def test_conflicting_policy_aliases_fail_instead_of_selecting_one(alias: str, gateway_factory: GatewayFactory) -> None:
    gateway, client = gateway_factory()
    response = MagicMock(status_code=200)
    response.json.return_value = {
        "tenant_id": TENANT_ID,
        "app_id": APP_ID,
        "binding": _binding_wire(group_id=GROUP_ID, **{alias: APP_ID}),
    }
    client.response = response
    with pytest.raises(NetworkAccessGroupInvalidResponseError):
        gateway.get_app_binding(TENANT_ID, APP_ID, ACCOUNT_ID)
    response.json.return_value["binding"][alias] = GROUP_ID
    binding = gateway.get_app_binding(TENANT_ID, APP_ID, ACCOUNT_ID).binding
    assert binding is not None
    assert binding.group_id == GROUP_ID


@pytest.mark.parametrize("payload", [{}, {"group": None}, {"group": {"version": "1"}}])
def test_existing_policy_identity_fields_are_never_fabricated(
    payload: dict[str, object], gateway_factory: GatewayFactory
) -> None:
    gateway, client = gateway_factory()
    response = MagicMock(status_code=200)
    response.json.return_value = payload
    client.response = response
    with pytest.raises(NetworkAccessGroupInvalidResponseError):
        gateway.get_group(TENANT_ID, GROUP_ID, ACCOUNT_ID)


@pytest.mark.parametrize("field", ["used_by_count", "enforcing_count"])
@pytest.mark.parametrize("value", [True, 0.0, "0.5", -1])
def test_invalid_policy_counts_are_rejected(field: str, value: object, gateway_factory: GatewayFactory) -> None:
    gateway, client = gateway_factory()
    response = MagicMock(status_code=200)
    response.json.return_value = {"group": _group_wire(**{field: value})}
    client.response = response
    with pytest.raises(NetworkAccessGroupInvalidResponseError):
        gateway.get_group(TENANT_ID, GROUP_ID, ACCOUNT_ID)
