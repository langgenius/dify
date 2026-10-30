import json
from collections.abc import Callable
from datetime import UTC, datetime
from unittest.mock import patch

import httpx
import pytest

from enums import CloudPlan
from services.billing_client import saas, transport
from services.billing_client.transport import BillingModel
from services.errors.billing import BillingUpstreamInvalidResponseError, BillingUpstreamUnavailableError
from services.network_access_group_gateway import (
    BillingNetworkAccessGroupEntitlementGateway,
    NetworkAccessGroupGateway,
)
from services.network_access_group_service import (
    NetworkAccessGroupEntitlementUnavailableError,
    NetworkAccessGroupInvalidResponseError,
    NetworkAccessGroupUpstreamError,
)
from tests.helpers import billing_builders as builders

TENANT_ID = "11111111-1111-4111-8111-111111111111"
ACCOUNT_ID = "22222222-2222-4222-8222-222222222222"
APP_ID = "33333333-3333-4333-8333-333333333333"
GROUP_ID = "44444444-4444-4444-8444-444444444444"
CREATED_AT = datetime(2026, 9, 1, tzinfo=UTC)

type Respond = Callable[[httpx.Response], list[httpx.Request]]


def _group(**overrides: object) -> saas.NetworkAccessGroup:
    values: dict[str, object] = {
        "id": GROUP_ID,
        "tenant_id": TENANT_ID,
        "name": "Office",
        "description": "",
        "mode": "",
        "allowed_cidrs": ["203.0.113.7/32"],
        "version": 1,
        "updated_by_account_id": "",
        "created_at": CREATED_AT,
        "updated_at": CREATED_AT,
        "used_by_count": 0,
        "used_by_app_ids": [],
        "enforcing_count": 0,
    }
    return saas.NetworkAccessGroup.model_validate({**values, **overrides})


def _binding(**overrides: object) -> saas.AppNetworkAccessGroupBinding:
    values: dict[str, object] = {
        "id": GROUP_ID,
        "tenant_id": TENANT_ID,
        "app_id": APP_ID,
        "group_id": None,
        "version": 1,
        "updated_by_account_id": "",
        "created_at": CREATED_AT,
        "updated_at": CREATED_AT,
        "enabled": False,
        "access_points": [],
    }
    return saas.AppNetworkAccessGroupBinding.model_validate({**values, **overrides})


def _app_config(binding: saas.AppNetworkAccessGroupBinding | None = None) -> saas.GetAppNetworkAccessGroupReply:
    return saas.GetAppNetworkAccessGroupReply(
        tenant_id=TENANT_ID, app_id=APP_ID, entitled=True, binding=binding, effective_enabled=False
    )


def _ok(reply: BillingModel | dict[str, object]) -> httpx.Response:
    payload = reply.model_dump(mode="json") if isinstance(reply, BillingModel) else reply
    return httpx.Response(httpx.codes.OK, json=payload)


@pytest.fixture
def respond(monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]) -> Respond:
    """Answer every saas request with the latest `response`; the returned list records every request of the test."""
    config_overrides(
        BILLING_API_URL="https://billing.internal/v1", BILLING_API_SECRET_KEY="test-secret", NETWORK_ACCESS_API_URL=""
    )

    requests: list[httpx.Request] = []

    def install(response: httpx.Response) -> list[httpx.Request]:
        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return response

        monkeypatch.setattr(transport, "_http_client", httpx.Client(transport=httpx.MockTransport(handler)))
        return requests

    return install


@pytest.mark.parametrize(
    ("configured", "expected"),
    [
        ("https://network-access.internal/v1/", "https://network-access.internal/v1"),
        ("  ", "https://billing.internal/v1"),
    ],
)
def test_requests_use_network_access_url_and_fall_back_to_billing_url(
    respond: Respond, config_overrides: Callable[..., None], configured: str, expected: str
) -> None:
    config_overrides(NETWORK_ACCESS_API_URL=configured)
    requests = respond(_ok(saas.ListNetworkAccessGroupsReply(tenant_id=TENANT_ID, entitled=True, groups=[])))

    NetworkAccessGroupGateway().list_groups(TENANT_ID, ACCOUNT_ID)

    assert str(requests[0].url) == f"{expected}/tenants/{TENANT_ID}/network-access-groups?actorAccountId={ACCOUNT_ID}"
    assert requests[0].headers["Billing-Api-Secret-Key"] == "test-secret"


def test_group_operations_send_actor_and_expected_version(respond: Respond) -> None:
    gateway = NetworkAccessGroupGateway()
    requests = respond(_ok(saas.NetworkAccessGroupReply(group=_group())))
    gateway.create_group(
        TENANT_ID,
        name="Office",
        description="Office egress",
        allowed_cidrs=["203.0.113.7/32"],
        actor_account_id=ACCOUNT_ID,
    )
    gateway.get_group(TENANT_ID, GROUP_ID, ACCOUNT_ID)
    gateway.update_group(
        TENANT_ID,
        GROUP_ID,
        name="Office",
        description="Updated",
        allowed_cidrs=["203.0.113.0/24"],
        expected_version=1,
        actor_account_id=ACCOUNT_ID,
    )
    respond(_ok(saas.DeleteNetworkAccessGroupReply(deleted=True)))
    assert gateway.delete_group(TENANT_ID, GROUP_ID, expected_version=2, actor_account_id=ACCOUNT_ID) is True

    group_path = f"/v1/tenants/{TENANT_ID}/network-access-groups/{GROUP_ID}"
    assert [(request.method, request.url.path) for request in requests] == [
        ("POST", f"/v1/tenants/{TENANT_ID}/network-access-groups"),
        ("GET", group_path),
        ("PUT", group_path),
        ("DELETE", group_path),
    ]
    assert json.loads(requests[0].content) == {
        "tenantId": TENANT_ID,
        "name": "Office",
        "description": "Office egress",
        "mode": "",
        "allowedCidrs": ["203.0.113.7/32"],
        "actorAccountId": ACCOUNT_ID,
    }
    assert requests[1].url.params["actorAccountId"] == ACCOUNT_ID
    assert json.loads(requests[2].content)["expectedVersion"] == 1
    assert dict(requests[3].url.params) == {"expectedVersion": "2", "actorAccountId": ACCOUNT_ID}


def test_app_operations_use_tenant_and_app_paths(respond: Respond) -> None:
    gateway = NetworkAccessGroupGateway()
    requests = respond(_ok(_app_config()))
    gateway.get_app_binding(TENANT_ID, APP_ID, ACCOUNT_ID)
    respond(
        _ok(saas.GetAppNetworkAccessGroupStatusReply(entitled=True, configured=True, enabled=True, access_points=[]))
    )
    gateway.get_app_status(TENANT_ID, APP_ID, ACCOUNT_ID)
    respond(_ok(saas.PutAppNetworkAccessGroupReply(binding=_binding(), effective_enabled=True)))
    gateway.update_app_binding(
        TENANT_ID,
        APP_ID,
        enabled=True,
        group_id=GROUP_ID,
        access_points=["webapp", "service_api"],
        expected_version=0,
        actor_account_id=ACCOUNT_ID,
    )
    respond(_ok(saas.CleanupAppNetworkAccessGroupBindingReply(deleted=True)))
    assert gateway.cleanup_app_binding(TENANT_ID, APP_ID) is True

    app_path = f"/v1/tenants/{TENANT_ID}/apps/{APP_ID}/network-access-group"
    assert [(request.method, request.url.path) for request in requests] == [
        ("GET", app_path),
        ("GET", f"{app_path}/status"),
        ("PUT", app_path),
        ("DELETE", f"{app_path}-binding"),
    ]
    assert json.loads(requests[2].content) == {
        "tenantId": TENANT_ID,
        "appId": APP_ID,
        "groupId": GROUP_ID,
        "expectedVersion": 0,
        "actorAccountId": ACCOUNT_ID,
        "enabled": True,
        "accessPoints": ["webapp", "service_api"],
    }
    assert requests[3].url.params == httpx.QueryParams()


def test_replies_map_to_service_records(respond: Respond) -> None:
    gateway = NetworkAccessGroupGateway()
    wire = _group(version="9007199254740993", used_by_count="1", used_by_app_ids=[APP_ID], enforcing_count="1")
    respond(_ok(saas.ListNetworkAccessGroupsReply(tenant_id=TENANT_ID, entitled=True, groups=[wire])))

    groups = gateway.list_groups(TENANT_ID, ACCOUNT_ID)

    assert groups.entitled is True
    (group,) = groups.groups
    assert group.version == 9007199254740993
    assert (group.used_by_count, group.enforcing_count, group.app_ids) == (1, 1, (APP_ID,))
    assert group.allowed_cidrs == ("203.0.113.7/32",)
    assert group.created_at == CREATED_AT


@pytest.mark.parametrize("group_id", [GROUP_ID, None, ""])
def test_binding_group_reference_is_none_when_unset(respond: Respond, group_id: str | None) -> None:
    respond(_ok(_app_config(_binding(group_id=group_id, enabled=True, access_points=["webapp", "future_scope"]))))

    binding = NetworkAccessGroupGateway().get_app_binding(TENANT_ID, APP_ID, ACCOUNT_ID).binding

    assert binding is not None
    assert binding.group_id == (group_id or None)
    assert binding.access_points == ("webapp", "future_scope")


def test_snake_case_proto_names_are_accepted(respond: Respond) -> None:
    respond(_ok({"group": _group(used_by_app_ids=[APP_ID]).model_dump(mode="json", by_alias=False)}))

    assert NetworkAccessGroupGateway().get_group(TENANT_ID, GROUP_ID, ACCOUNT_ID).app_ids == (APP_ID,)


@pytest.mark.parametrize("status_code", [400, 403, 404, 409, 500, 503])
def test_error_status_is_preserved(respond: Respond, status_code: int) -> None:
    respond(httpx.Response(status_code))

    with pytest.raises(NetworkAccessGroupUpstreamError) as exc_info:
        NetworkAccessGroupGateway().get_group(TENANT_ID, GROUP_ID, ACCOUNT_ID)

    assert exc_info.value.status_code == status_code
    assert exc_info.value.reason is None


@pytest.mark.parametrize(
    ("body", "reason"),
    [
        (
            {"code": 409, "reason": "NETWORK_ACCESS_VERSION_CONFLICT", "message": "internal"},
            "NETWORK_ACCESS_VERSION_CONFLICT",
        ),
        ({"code": "not-a-code", "reason": "NETWORK_ACCESS_GROUP_NAME_CONFLICT"}, "NETWORK_ACCESS_GROUP_NAME_CONFLICT"),
        ({"reason": 409}, None),
        (["NETWORK_ACCESS_VERSION_CONFLICT"], None),
    ],
)
def test_error_reason_is_preserved_when_it_is_a_string(respond: Respond, body: object, reason: str | None) -> None:
    respond(httpx.Response(httpx.codes.CONFLICT, json=body))

    with pytest.raises(NetworkAccessGroupUpstreamError) as exc_info:
        NetworkAccessGroupGateway().delete_group(TENANT_ID, GROUP_ID, expected_version=1, actor_account_id=ACCOUNT_ID)

    assert exc_info.value.status_code == httpx.codes.CONFLICT
    assert exc_info.value.reason == reason


def test_unreachable_upstream_maps_to_service_unavailable() -> None:
    with (
        patch.object(
            saas,
            "network_access_policy_list_network_access_groups",
            side_effect=BillingUpstreamUnavailableError("GET failed"),
        ),
        pytest.raises(NetworkAccessGroupUpstreamError) as exc_info,
    ):
        NetworkAccessGroupGateway().list_groups(TENANT_ID, ACCOUNT_ID)

    assert exc_info.value.status_code == httpx.codes.SERVICE_UNAVAILABLE
    assert exc_info.value.reason is None


@pytest.mark.parametrize("body", [b"{", b"\xff", b"", b"[]"])
def test_unparsable_reply_is_invalid(respond: Respond, body: bytes) -> None:
    respond(httpx.Response(httpx.codes.OK, content=body, headers={"Content-Type": "application/json"}))

    with pytest.raises(NetworkAccessGroupInvalidResponseError) as exc_info:
        NetworkAccessGroupGateway().list_groups(TENANT_ID, ACCOUNT_ID)

    assert isinstance(exc_info.value.__cause__, BillingUpstreamInvalidResponseError)


VALID_GROUP = _group().model_dump(mode="json")


@pytest.mark.parametrize(
    "group",
    [
        None,
        {"version": "1"},
        {**VALID_GROUP, "version": "invalid"},
        {**VALID_GROUP, "version": "1.5"},
        {**VALID_GROUP, "name": 1},
        {**VALID_GROUP, "allowedCidrs": "203.0.113.7/32"},
        {**VALID_GROUP, "usedByCount": "0.5"},
        {**VALID_GROUP, "createdAt": "yesterday"},
    ],
)
def test_replies_failing_the_schema_are_invalid(respond: Respond, group: dict[str, object] | None) -> None:
    respond(_ok({"group": group}))

    with pytest.raises(NetworkAccessGroupInvalidResponseError):
        NetworkAccessGroupGateway().get_group(TENANT_ID, GROUP_ID, ACCOUNT_ID)


@pytest.mark.parametrize(
    "overrides",
    [
        {"id": ""},
        {"tenant_id": ""},
        {"allowed_cidrs": []},
        {"allowed_cidrs": ["203.0.113.7/32"] * 101},
        {"version": 0},
        {"version": -1},
        {"version": 2**63},
        {"used_by_count": -1},
        {"enforcing_count": -1},
        {"enforcing_count": 2**63},
        {"used_by_app_ids": [""]},
    ],
)
def test_groups_breaking_service_invariants_are_invalid(respond: Respond, overrides: dict[str, object]) -> None:
    respond(_ok(saas.NetworkAccessGroupReply(group=_group(**overrides))))

    with pytest.raises(NetworkAccessGroupInvalidResponseError):
        NetworkAccessGroupGateway().get_group(TENANT_ID, GROUP_ID, ACCOUNT_ID)


@pytest.mark.parametrize("overrides", [{"id": ""}, {"app_id": ""}, {"version": 0}, {"version": 2**63}])
def test_bindings_breaking_service_invariants_are_invalid(respond: Respond, overrides: dict[str, object]) -> None:
    respond(_ok(_app_config(_binding(**overrides))))

    with pytest.raises(NetworkAccessGroupInvalidResponseError):
        NetworkAccessGroupGateway().get_app_binding(TENANT_ID, APP_ID, ACCOUNT_ID)


def test_binding_update_without_binding_is_invalid(respond: Respond) -> None:
    respond(_ok(saas.PutAppNetworkAccessGroupReply(binding=None, effective_enabled=True)))

    with pytest.raises(NetworkAccessGroupInvalidResponseError):
        NetworkAccessGroupGateway().update_app_binding(
            TENANT_ID,
            APP_ID,
            enabled=True,
            group_id=GROUP_ID,
            access_points=["webapp"],
            expected_version=1,
            actor_account_id=ACCOUNT_ID,
        )


@pytest.mark.parametrize("field", ["entitled", "effectiveEnabled", "enabled"])
@pytest.mark.parametrize("value", ["maybe", 2, None])
def test_non_boolean_flags_are_invalid(respond: Respond, field: str, value: object) -> None:
    payload = _app_config(_binding()).model_dump(mode="json")
    target = payload["binding"] if field == "enabled" else payload
    assert isinstance(target, dict)
    target[field] = value
    respond(_ok(payload))

    with pytest.raises(NetworkAccessGroupInvalidResponseError):
        NetworkAccessGroupGateway().get_app_binding(TENANT_ID, APP_ID, ACCOUNT_ID)


@pytest.mark.parametrize("plan", [CloudPlan.PROFESSIONAL, CloudPlan.TEAM])
def test_billing_entitlement_gateway_accepts_paid_plans(plan: CloudPlan) -> None:
    gateway = BillingNetworkAccessGroupEntitlementGateway()
    with patch(
        "services.network_access_group_gateway.BillingService.get_info",
        return_value=builders.subscription_info(plan),
    ) as get_info:
        assert gateway.is_paid_plan(TENANT_ID) is True

    get_info.assert_called_once_with(TENANT_ID, exclude_vector_space=True)


def test_billing_entitlement_gateway_rejects_unpaid_plan() -> None:
    gateway = BillingNetworkAccessGroupEntitlementGateway()
    with patch(
        "services.network_access_group_gateway.BillingService.get_info",
        return_value=builders.subscription_info("sandbox"),
    ):
        assert gateway.is_paid_plan(TENANT_ID) is False


@pytest.mark.parametrize(
    "error",
    [BillingUpstreamUnavailableError("unavailable"), BillingUpstreamInvalidResponseError("invalid body")],
)
def test_billing_entitlement_gateway_maps_billing_upstream_errors(error: Exception) -> None:
    gateway = BillingNetworkAccessGroupEntitlementGateway()
    with (
        patch("services.network_access_group_gateway.BillingService.get_info", side_effect=error),
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
