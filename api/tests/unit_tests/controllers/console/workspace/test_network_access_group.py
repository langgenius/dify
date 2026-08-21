from datetime import UTC, datetime
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import patch
from uuid import UUID

import pytest
from pydantic import ValidationError
from werkzeug.exceptions import BadGateway, BadRequest, Conflict, Forbidden, HTTPException, NotFound, ServiceUnavailable

from controllers.console.workspace.network_access_group import (
    AppNetworkAccessGroupApi,
    AppNetworkAccessGroupUpdatePayload,
    CurrentWorkspaceNetworkAccessGroupApi,
    CurrentWorkspaceNetworkAccessGroupsApi,
    NetworkAccessGroupCreatePayload,
    NetworkAccessGroupDeleteQuery,
    NetworkAccessGroupUpdatePayload,
    _translate_upstream_error,
)
from services.billing_service import BillingService, NetworkAccessGroupUpstreamError

TENANT_ID = "11111111-1111-4111-8111-111111111111"
ACCOUNT_ID = "22222222-2222-4222-8222-222222222222"
APP_ID = "33333333-3333-4333-8333-333333333333"
GROUP_ID = "44444444-4444-4444-8444-444444444444"
BINDING_ID = "55555555-5555-4555-8555-555555555555"


def _group_payload() -> dict[str, object]:
    return {
        "id": GROUP_ID,
        "tenantId": TENANT_ID,
        "name": "Office network",
        "description": "Reusable office egress addresses",
        "mode": "enforce",
        "allowedCidrs": ["203.0.113.7/32"],
        # ProtoJSON represents int64 values as strings and timestamps as RFC 3339.
        "version": "2",
        "updatedByAccountId": ACCOUNT_ID,
        "createdAt": datetime(2026, 8, 21, tzinfo=UTC).isoformat(),
        "updatedAt": datetime(2026, 8, 21, tzinfo=UTC).isoformat(),
    }


def _binding_payload(*, group_id: str | None = GROUP_ID) -> dict[str, object]:
    return {
        "id": BINDING_ID,
        "tenantId": TENANT_ID,
        "appId": APP_ID,
        "groupId": group_id,
        "version": "3",
        "updatedByAccountId": ACCOUNT_ID,
        "createdAt": datetime(2026, 8, 21, tzinfo=UTC).isoformat(),
        "updatedAt": datetime(2026, 8, 21, tzinfo=UTC).isoformat(),
    }


def test_list_authorizes_and_forwards_tenant_and_actor() -> None:
    api = CurrentWorkspaceNetworkAccessGroupsApi()
    method = unwrap(api.get)
    current_user = SimpleNamespace(id=ACCOUNT_ID)
    upstream_payload = {"tenantId": TENANT_ID, "entitled": True, "groups": [_group_payload()]}

    with (
        patch("controllers.console.workspace.network_access_group.db") as db,
        patch.object(BillingService, "is_tenant_owner_or_admin") as authorize,
        patch.object(BillingService, "list_network_access_groups", return_value=upstream_payload) as list_groups,
    ):
        result = method(api, current_tenant_id=TENANT_ID, current_user=current_user)

    authorize.assert_called_once_with(current_user, session=db.session())
    list_groups.assert_called_once_with(TENANT_ID, ACCOUNT_ID)
    assert result["tenant_id"] == TENANT_ID
    assert result["groups"][0]["name"] == "Office network"
    assert result["groups"][0]["version"] == 2
    assert result["groups"][0]["updated_at"] == "2026-08-21T00:00:00Z"


def test_create_injects_actor_and_returns_created_contract() -> None:
    api = CurrentWorkspaceNetworkAccessGroupsApi()
    method = unwrap(api.post)
    current_user = SimpleNamespace(id=ACCOUNT_ID)
    request_payload = NetworkAccessGroupCreatePayload(
        name="Office network",
        description="Reusable office egress addresses",
        mode="enforce",
        allowed_cidrs=["203.0.113.7/32"],
    )

    with (
        patch("controllers.console.workspace.network_access_group.db"),
        patch.object(BillingService, "is_tenant_owner_or_admin"),
        patch.object(
            BillingService,
            "create_network_access_group",
            return_value={"group": _group_payload()},
        ) as create_group,
    ):
        body, status = method(
            api,
            req_data=request_payload,
            current_tenant_id=TENANT_ID,
            current_user=current_user,
        )

    create_group.assert_called_once_with(
        TENANT_ID,
        name="Office network",
        description="Reusable office egress addresses",
        mode="enforce",
        allowed_cidrs=["203.0.113.7/32"],
        actor_account_id=ACCOUNT_ID,
    )
    assert status == 201
    assert body["group"]["id"] == GROUP_ID


def test_update_group_forwards_path_id_and_expected_version() -> None:
    api = CurrentWorkspaceNetworkAccessGroupApi()
    method = unwrap(api.put)
    current_user = SimpleNamespace(id=ACCOUNT_ID)
    request_payload = NetworkAccessGroupUpdatePayload(
        name="Office network",
        description="Updated",
        mode="shadow",
        allowed_cidrs=["203.0.113.0/24"],
        expected_version=1,
    )

    with (
        patch("controllers.console.workspace.network_access_group.db"),
        patch.object(BillingService, "is_tenant_owner_or_admin"),
        patch.object(
            BillingService,
            "update_network_access_group",
            return_value={"group": _group_payload()},
        ) as update_group,
    ):
        result = method(
            api,
            req_data=request_payload,
            current_tenant_id=TENANT_ID,
            current_user=current_user,
            group_id=UUID(GROUP_ID),
        )

    update_group.assert_called_once_with(
        TENANT_ID,
        GROUP_ID,
        name="Office network",
        description="Updated",
        mode="shadow",
        allowed_cidrs=["203.0.113.0/24"],
        expected_version=1,
        actor_account_id=ACCOUNT_ID,
    )
    assert result["group"]["version"] == 2


def test_delete_group_reads_expected_version_from_query_and_injects_actor() -> None:
    api = CurrentWorkspaceNetworkAccessGroupApi()
    method = unwrap(api.delete)
    current_user = SimpleNamespace(id=ACCOUNT_ID)

    with (
        patch("controllers.console.workspace.network_access_group.db"),
        patch.object(BillingService, "is_tenant_owner_or_admin"),
        patch.object(
            BillingService,
            "delete_network_access_group",
            return_value={"deleted": True},
        ) as delete_group,
    ):
        result = method(
            api,
            req_data=NetworkAccessGroupDeleteQuery(expected_version=2),
            current_tenant_id=TENANT_ID,
            current_user=current_user,
            group_id=UUID(GROUP_ID),
        )

    delete_group.assert_called_once_with(
        TENANT_ID,
        GROUP_ID,
        expected_version=2,
        actor_account_id=ACCOUNT_ID,
    )
    assert result == {"deleted": True}


def test_app_get_forwards_tenant_scoped_app_and_supports_unbound_response() -> None:
    api = AppNetworkAccessGroupApi()
    method = unwrap(api.get)
    current_user = SimpleNamespace(id=ACCOUNT_ID)
    app_model = SimpleNamespace(id=UUID(APP_ID), tenant_id=TENANT_ID)
    upstream_payload = {"tenantId": TENANT_ID, "appId": APP_ID, "entitled": True, "binding": None}

    with (
        patch("controllers.console.workspace.network_access_group.db"),
        patch.object(BillingService, "is_tenant_owner_or_admin"),
        patch.object(
            BillingService,
            "get_app_network_access_group",
            return_value=upstream_payload,
        ) as get_binding,
    ):
        result = method(
            api,
            current_tenant_id=TENANT_ID,
            current_user=current_user,
            app_model=app_model,
        )

    get_binding.assert_called_once_with(TENANT_ID, APP_ID, ACCOUNT_ID)
    assert result["binding"] is None


@pytest.mark.parametrize("group_id", [GROUP_ID, None])
def test_app_put_assigns_or_unassigns_group(group_id: str | None) -> None:
    api = AppNetworkAccessGroupApi()
    method = unwrap(api.put)
    current_user = SimpleNamespace(id=ACCOUNT_ID)
    app_model = SimpleNamespace(id=UUID(APP_ID), tenant_id=TENANT_ID)
    request_payload = AppNetworkAccessGroupUpdatePayload(group_id=group_id, expected_version=2)

    with (
        patch("controllers.console.workspace.network_access_group.db"),
        patch.object(BillingService, "is_tenant_owner_or_admin"),
        patch.object(
            BillingService,
            "update_app_network_access_group",
            return_value={"binding": _binding_payload(group_id=group_id)},
        ) as update_binding,
    ):
        result = method(
            api,
            req_data=request_payload,
            current_tenant_id=TENANT_ID,
            current_user=current_user,
            app_model=app_model,
        )

    update_binding.assert_called_once_with(
        TENANT_ID,
        APP_ID,
        group_id=group_id,
        expected_version=2,
        actor_account_id=ACCOUNT_ID,
    )
    assert result["binding"]["group_id"] == group_id
    assert result["binding"]["version"] == 3


def test_list_rejects_non_privileged_workspace_member_before_upstream_call() -> None:
    api = CurrentWorkspaceNetworkAccessGroupsApi()
    method = unwrap(api.get)
    current_user = SimpleNamespace(id=ACCOUNT_ID)

    with (
        patch("controllers.console.workspace.network_access_group.db"),
        patch.object(BillingService, "is_tenant_owner_or_admin", side_effect=ValueError("not privileged")),
        patch.object(BillingService, "list_network_access_groups") as list_groups,
        pytest.raises(Forbidden),
    ):
        method(api, current_tenant_id=TENANT_ID, current_user=current_user)

    list_groups.assert_not_called()


@pytest.mark.parametrize(
    ("status_code", "expected_exception"),
    [
        (400, BadRequest),
        (401, ServiceUnavailable),
        (403, Forbidden),
        (404, NotFound),
        (409, Conflict),
        (500, ServiceUnavailable),
        (418, BadGateway),
    ],
)
def test_upstream_error_mapping(status_code: int, expected_exception: type[HTTPException]) -> None:
    assert isinstance(_translate_upstream_error(NetworkAccessGroupUpstreamError(status_code)), expected_exception)


@pytest.mark.parametrize(
    ("reason", "expected_message"),
    [
        ("NETWORK_ACCESS_VERSION_CONFLICT", "changed"),
        ("NETWORK_ACCESS_GROUP_NAME_CONFLICT", "already exists"),
        ("NETWORK_ACCESS_GROUP_LIMIT", "reached"),
        ("NETWORK_ACCESS_GROUP_BOUND", "Unassign"),
    ],
)
def test_conflict_error_mapping_preserves_safe_actionable_reason(reason: str, expected_message: str) -> None:
    error = _translate_upstream_error(NetworkAccessGroupUpstreamError(409, reason))
    assert isinstance(error, Conflict)
    assert expected_message in error.description


def test_internal_secret_error_is_not_reported_as_tenant_input_failure() -> None:
    error = _translate_upstream_error(NetworkAccessGroupUpstreamError(400, "INVALID_SECRET_KEY"))
    assert isinstance(error, ServiceUnavailable)


def test_list_maps_invalid_upstream_contract_to_bad_gateway() -> None:
    api = CurrentWorkspaceNetworkAccessGroupsApi()
    method = unwrap(api.get)
    current_user = SimpleNamespace(id=ACCOUNT_ID)

    with (
        patch("controllers.console.workspace.network_access_group.db"),
        patch.object(BillingService, "is_tenant_owner_or_admin"),
        patch.object(
            BillingService,
            "list_network_access_groups",
            return_value={"tenant_id": TENANT_ID, "entitled": True, "groups": [{"mode": "disabled"}]},
        ),
        pytest.raises(BadGateway),
    ):
        method(api, current_tenant_id=TENANT_ID, current_user=current_user)


def test_response_contract_accepts_protojson_omitted_empty_group_fields() -> None:
    api = CurrentWorkspaceNetworkAccessGroupsApi()
    method = unwrap(api.get)
    current_user = SimpleNamespace(id=ACCOUNT_ID)
    group = _group_payload()
    group.pop("description")
    group.pop("allowedCidrs")

    with (
        patch("controllers.console.workspace.network_access_group.db"),
        patch.object(BillingService, "is_tenant_owner_or_admin"),
        patch.object(
            BillingService,
            "list_network_access_groups",
            return_value={"tenantId": TENANT_ID, "entitled": True, "groups": [group]},
        ),
    ):
        result = method(api, current_tenant_id=TENANT_ID, current_user=current_user)

    assert result["groups"][0]["description"] == ""
    assert result["groups"][0]["allowed_cidrs"] == []


def test_binding_response_accepts_protojson_omitted_null_group_id() -> None:
    api = AppNetworkAccessGroupApi()
    method = unwrap(api.put)
    current_user = SimpleNamespace(id=ACCOUNT_ID)
    app_model = SimpleNamespace(id=UUID(APP_ID), tenant_id=TENANT_ID)
    request_payload = AppNetworkAccessGroupUpdatePayload(group_id=None, expected_version=2)
    binding = _binding_payload(group_id=None)
    binding.pop("groupId")

    with (
        patch("controllers.console.workspace.network_access_group.db"),
        patch.object(BillingService, "is_tenant_owner_or_admin"),
        patch.object(
            BillingService,
            "update_app_network_access_group",
            return_value={"binding": binding},
        ),
    ):
        result = method(
            api,
            req_data=request_payload,
            current_tenant_id=TENANT_ID,
            current_user=current_user,
            app_model=app_model,
        )

    assert result["binding"]["group_id"] is None


@pytest.mark.parametrize(
    "payload",
    [
        {"name": "", "description": "", "mode": "disabled", "allowed_cidrs": []},
        {"name": "group", "description": "", "mode": "unknown", "allowed_cidrs": []},
        {"name": "group", "description": "", "mode": "disabled", "allowed_cidrs": ["127.0.0.1"] * 101},
    ],
)
def test_create_payload_contract_rejects_invalid_shapes(payload: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        NetworkAccessGroupCreatePayload.model_validate(payload)


def test_binding_payload_rejects_invalid_group_id_and_version() -> None:
    with pytest.raises(ValidationError):
        AppNetworkAccessGroupUpdatePayload.model_validate({"group_id": "not-a-uuid", "expected_version": -1})
