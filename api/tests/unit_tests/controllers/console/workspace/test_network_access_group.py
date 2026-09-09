from collections.abc import Iterator
from datetime import UTC, datetime
from inspect import unwrap
from types import SimpleNamespace
from typing import cast
from unittest.mock import MagicMock, patch
from uuid import UUID

import pytest
from pydantic import ValidationError
from sqlalchemy.exc import SQLAlchemyError
from werkzeug.exceptions import BadGateway, BadRequest, Conflict, Forbidden, HTTPException, NotFound, ServiceUnavailable

from controllers.console.workspace.network_access_group import (
    AppNetworkAccessGroupApi,
    AppNetworkAccessGroupUpdatePayload,
    CurrentWorkspaceNetworkAccessGroupApi,
    CurrentWorkspaceNetworkAccessGroupsApi,
    NetworkAccessGroupCreatePayload,
    NetworkAccessGroupDeleteQuery,
    NetworkAccessGroupUpdatePayload,
    _available_access_points,
    _effective_entitlement,
    _translate_upstream_error,
)
from models import App, AppMode, TenantAccountRole
from services.billing_service import BillingService, NetworkAccessGroupUpstreamError
from services.network_access_group_service import NetworkAccessGroupService

TENANT_ID = "11111111-1111-4111-8111-111111111111"
ACCOUNT_ID = "22222222-2222-4222-8222-222222222222"
APP_ID = "33333333-3333-4333-8333-333333333333"
GROUP_ID = "44444444-4444-4444-8444-444444444444"
BINDING_ID = "55555555-5555-4555-8555-555555555555"


def _current_user(role: TenantAccountRole = TenantAccountRole.OWNER) -> SimpleNamespace:
    return SimpleNamespace(id=ACCOUNT_ID, current_role=role)


@pytest.fixture(autouse=True)
def paid_entitlement() -> Iterator[None]:
    with patch(
        "controllers.console.workspace.network_access_group._effective_entitlement",
        side_effect=lambda _tenant_id, upstream: bool(upstream),
    ):
        yield


def _group_payload(*, app_ids: list[str] | None = None) -> dict[str, object]:
    app_ids = app_ids or []
    return {
        "id": GROUP_ID,
        "tenantId": TENANT_ID,
        "name": "Office network",
        "description": "Reusable office egress addresses",
        "allowedCidrs": ["203.0.113.7/32"],
        "usedByCount": len(app_ids),
        "usedByAppIds": app_ids,
        # ProtoJSON represents int64 values as strings and timestamps as RFC 3339.
        "version": "2",
        "updatedByAccountId": ACCOUNT_ID,
        "createdAt": datetime(2026, 8, 21, tzinfo=UTC).isoformat(),
        "updatedAt": datetime(2026, 8, 21, tzinfo=UTC).isoformat(),
    }


def _binding_payload(
    *,
    enabled: bool = True,
    group_id: str | None = GROUP_ID,
    access_points: list[str] | None = None,
) -> dict[str, object]:
    return {
        "id": BINDING_ID,
        "tenantId": TENANT_ID,
        "appId": APP_ID,
        "enabled": enabled,
        "groupId": group_id,
        "accessPoints": ["webapp", "service_api"] if access_points is None else access_points,
        "version": "3",
        "updatedByAccountId": ACCOUNT_ID,
        "createdAt": datetime(2026, 8, 21, tzinfo=UTC).isoformat(),
        "updatedAt": datetime(2026, 8, 21, tzinfo=UTC).isoformat(),
    }


def test_list_authorizes_and_forwards_tenant_and_actor() -> None:
    api = CurrentWorkspaceNetworkAccessGroupsApi()
    method = unwrap(api.get)
    current_user = _current_user()
    upstream_payload = {"tenantId": TENANT_ID, "entitled": True, "groups": [_group_payload()]}

    with (
        patch.object(BillingService, "list_network_access_groups", return_value=upstream_payload) as list_groups,
    ):
        result = method(api, current_tenant_id=TENANT_ID, current_user=current_user)

    list_groups.assert_called_once_with(TENANT_ID, ACCOUNT_ID)
    assert result["tenant_id"] == TENANT_ID
    assert result["groups"][0]["name"] == "Office network"
    assert result["groups"][0]["version"] == 2
    assert result["groups"][0]["used_by_count"] == 0
    assert result["groups"][0]["app_ids"] == []
    assert result["groups"][0]["apps"] == []
    assert result["groups"][0]["updated_at"] == "2026-08-21T00:00:00Z"


def test_create_injects_actor_and_returns_created_contract() -> None:
    api = CurrentWorkspaceNetworkAccessGroupsApi()
    method = unwrap(api.post)
    current_user = _current_user()
    request_payload = NetworkAccessGroupCreatePayload(
        name="Office network",
        description="Reusable office egress addresses",
        allowed_cidrs=["203.0.113.7/32"],
    )

    with (
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
        allowed_cidrs=["203.0.113.7/32"],
        actor_account_id=ACCOUNT_ID,
    )
    assert status == 201
    assert body["group"]["id"] == GROUP_ID


def test_update_group_forwards_path_id_and_expected_version() -> None:
    api = CurrentWorkspaceNetworkAccessGroupApi()
    method = unwrap(api.put)
    current_user = _current_user()
    request_payload = NetworkAccessGroupUpdatePayload(
        name="Office network",
        description="Updated",
        allowed_cidrs=["203.0.113.0/24"],
        expected_version=1,
    )

    with (
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
        allowed_cidrs=["203.0.113.0/24"],
        expected_version=1,
        actor_account_id=ACCOUNT_ID,
    )
    assert result["group"]["version"] == 2


def test_delete_group_reads_expected_version_from_query_and_injects_actor() -> None:
    api = CurrentWorkspaceNetworkAccessGroupApi()
    method = unwrap(api.delete)
    current_user = _current_user()

    with (
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
    current_user = _current_user()
    app_model = SimpleNamespace(id=UUID(APP_ID), tenant_id=TENANT_ID, mode=AppMode.CHAT)
    upstream_payload = {"tenantId": TENANT_ID, "appId": APP_ID, "entitled": True}

    with (
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
    assert result["available_access_points"] == ["webapp", "service_api", "mcp"]


@pytest.mark.parametrize("enabled", [True, False])
def test_app_put_atomically_saves_enabled_group_and_access_points(enabled: bool) -> None:
    api = AppNetworkAccessGroupApi()
    method = unwrap(api.put)
    current_user = _current_user()
    app_model = SimpleNamespace(id=UUID(APP_ID), tenant_id=TENANT_ID, mode=AppMode.CHAT)
    request_payload = AppNetworkAccessGroupUpdatePayload(
        enabled=enabled,
        group_id=GROUP_ID,
        access_points=["webapp", "service_api"],
        expected_version=2,
    )

    with (
        patch.object(
            BillingService,
            "update_app_network_access_group",
            return_value={"binding": _binding_payload(enabled=enabled)},
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
        enabled=enabled,
        group_id=GROUP_ID,
        access_points=["webapp", "service_api"],
        expected_version=2,
        actor_account_id=ACCOUNT_ID,
    )
    assert result["binding"]["enabled"] is enabled
    assert result["binding"]["group_id"] == GROUP_ID
    assert result["binding"]["access_points"] == ["webapp", "service_api"]
    assert result["binding"]["version"] == 3
    assert result["available_access_points"] == ["webapp", "service_api", "mcp"]


def test_list_rejects_non_privileged_workspace_member_before_upstream_call() -> None:
    api = CurrentWorkspaceNetworkAccessGroupsApi()
    method = unwrap(api.get)
    current_user = _current_user(TenantAccountRole.NORMAL)

    with (
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
    ],
)
def test_conflict_error_mapping_preserves_safe_actionable_reason(reason: str, expected_message: str) -> None:
    error = _translate_upstream_error(NetworkAccessGroupUpstreamError(409, reason))
    assert isinstance(error, Conflict)
    assert error.description is not None
    assert expected_message in error.description


def test_internal_secret_error_is_not_reported_as_tenant_input_failure() -> None:
    error = _translate_upstream_error(NetworkAccessGroupUpstreamError(400, "INVALID_SECRET_KEY"))
    assert isinstance(error, ServiceUnavailable)


def test_list_maps_invalid_upstream_contract_to_bad_gateway() -> None:
    api = CurrentWorkspaceNetworkAccessGroupsApi()
    method = unwrap(api.get)
    current_user = _current_user()

    with (
        patch.object(
            BillingService,
            "list_network_access_groups",
            return_value={"tenant_id": TENANT_ID, "entitled": True, "groups": [{"allowed_cidrs": []}]},
        ),
        pytest.raises(BadGateway),
    ):
        method(api, current_tenant_id=TENANT_ID, current_user=current_user)


def test_response_contract_accepts_protojson_omitted_optional_group_fields() -> None:
    api = CurrentWorkspaceNetworkAccessGroupsApi()
    method = unwrap(api.get)
    current_user = _current_user()
    group = _group_payload()
    group.pop("description")
    group.pop("usedByAppIds")
    group.pop("usedByCount")

    with (
        patch.object(
            BillingService,
            "list_network_access_groups",
            return_value={"tenantId": TENANT_ID, "entitled": True, "groups": [group]},
        ),
    ):
        result = method(api, current_tenant_id=TENANT_ID, current_user=current_user)

    assert result["groups"][0]["description"] == ""
    assert result["groups"][0]["allowed_cidrs"] == ["203.0.113.7/32"]
    assert result["groups"][0]["app_ids"] == []
    assert result["groups"][0]["used_by_count"] == 0


def test_binding_response_materializes_protojson_omitted_disabled_defaults() -> None:
    api = AppNetworkAccessGroupApi()
    method = unwrap(api.put)
    current_user = _current_user()
    app_model = SimpleNamespace(id=UUID(APP_ID), tenant_id=TENANT_ID, mode=AppMode.CHAT)
    request_payload = AppNetworkAccessGroupUpdatePayload(
        enabled=False,
        group_id=None,
        access_points=[],
        expected_version=2,
    )
    binding = _binding_payload(enabled=False, group_id=None, access_points=[])
    binding.pop("groupId")
    binding.pop("enabled")
    binding.pop("accessPoints")

    with (
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
    assert result["binding"]["enabled"] is False
    assert result["binding"]["access_points"] == []


def test_binding_response_accepts_policy_id_alias() -> None:
    api = AppNetworkAccessGroupApi()
    method = unwrap(api.put)
    app_model = SimpleNamespace(id=UUID(APP_ID), tenant_id=TENANT_ID, mode=AppMode.CHAT)
    request_payload = AppNetworkAccessGroupUpdatePayload(
        enabled=True,
        group_id=GROUP_ID,
        access_points=["webapp"],
        expected_version=2,
    )
    binding = _binding_payload(access_points=["webapp"])
    binding["policyId"] = binding.pop("groupId")

    with patch.object(BillingService, "update_app_network_access_group", return_value={"binding": binding}):
        result = method(
            api,
            req_data=request_payload,
            current_tenant_id=TENANT_ID,
            current_user=_current_user(),
            app_model=app_model,
        )

    assert result["binding"]["group_id"] == GROUP_ID


@pytest.mark.parametrize(
    "payload",
    [
        {"name": "", "description": "", "allowed_cidrs": []},
        {"name": "group", "description": "", "allowed_cidrs": []},
        {"name": "group", "description": "", "allowed_cidrs": ["127.0.0.1"] * 101},
    ],
)
def test_create_payload_contract_rejects_invalid_shapes(payload: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        NetworkAccessGroupCreatePayload.model_validate(payload)


def test_binding_payload_rejects_invalid_group_id_and_version() -> None:
    with pytest.raises(ValidationError):
        AppNetworkAccessGroupUpdatePayload.model_validate(
            {
                "enabled": True,
                "group_id": "not-a-uuid",
                "access_points": ["webapp"],
                "expected_version": -1,
            }
        )


@pytest.mark.parametrize(
    ("app_mode", "expected"),
    [
        (AppMode.WORKFLOW, ["webapp", "service_api", "mcp", "trigger"]),
        (AppMode.ADVANCED_CHAT, ["webapp", "service_api", "mcp"]),
        (AppMode.CHAT, ["webapp", "service_api", "mcp"]),
        (AppMode.COMPLETION, ["webapp", "service_api", "mcp"]),
        (AppMode.AGENT_CHAT, ["webapp", "service_api", "mcp"]),
        (AppMode.AGENT, ["webapp", "service_api"]),
    ],
)
def test_available_access_points_are_derived_from_app_mode(app_mode: AppMode, expected: list[str]) -> None:
    app_model = SimpleNamespace(mode=app_mode)

    assert _available_access_points(cast(App, app_model)) == expected


@pytest.mark.parametrize("app_mode", [AppMode.CHANNEL, AppMode.RAG_PIPELINE])
def test_unsupported_app_modes_are_rejected(app_mode: AppMode) -> None:
    with pytest.raises(BadRequest, match="not supported"):
        _available_access_points(cast(App, SimpleNamespace(mode=app_mode)))


def test_app_put_rejects_access_point_not_available_for_mode_before_upstream_call() -> None:
    api = AppNetworkAccessGroupApi()
    method = unwrap(api.put)
    app_model = SimpleNamespace(id=UUID(APP_ID), tenant_id=TENANT_ID, mode=AppMode.AGENT)
    request_payload = AppNetworkAccessGroupUpdatePayload(
        enabled=True,
        group_id=GROUP_ID,
        access_points=["webapp", "mcp"],
        expected_version=1,
    )

    with (
        patch.object(BillingService, "update_app_network_access_group") as update_binding,
        pytest.raises(BadRequest, match="mcp"),
    ):
        method(
            api,
            req_data=request_payload,
            current_tenant_id=TENANT_ID,
            current_user=_current_user(),
            app_model=app_model,
        )

    update_binding.assert_not_called()


@pytest.mark.parametrize(
    "payload",
    [
        {"enabled": True, "group_id": None, "access_points": ["webapp"], "expected_version": 0},
        {"enabled": True, "group_id": GROUP_ID, "access_points": [], "expected_version": 0},
        {
            "enabled": True,
            "group_id": GROUP_ID,
            "access_points": ["webapp", "webapp"],
            "expected_version": 0,
        },
        {"enabled": True, "group_id": GROUP_ID, "access_points": ["unknown"], "expected_version": 0},
    ],
)
def test_enabled_app_config_rejects_incomplete_or_invalid_access_points(payload: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        AppNetworkAccessGroupUpdatePayload.model_validate(payload)


def test_app_config_accepts_policy_id_alias_and_disabled_draft() -> None:
    payload = AppNetworkAccessGroupUpdatePayload.model_validate(
        {
            "enabled": False,
            "policy_id": GROUP_ID,
            "accessPoints": ["webapp", "service_api"],
            "expected_version": 3,
        }
    )

    assert str(payload.group_id) == GROUP_ID
    assert payload.access_points == ["webapp", "service_api"]


def test_group_responses_are_enriched_with_tenant_scoped_app_metadata() -> None:
    app_id_2 = "66666666-6666-4666-8666-666666666666"
    payload = {
        "group": _group_payload(app_ids=[APP_ID, app_id_2]),
    }
    payload["group"].pop("usedByCount")
    app = SimpleNamespace(
        id=APP_ID,
        name="Customer support",
        icon="robot",
        icon_type=SimpleNamespace(value="emoji"),
        icon_background="#FFFFFF",
    )
    db_mock = MagicMock()
    db_mock.session.scalars.return_value.all.return_value = [app]

    with patch("services.network_access_group_service.db", db_mock):
        result = NetworkAccessGroupService.enrich_app_references(payload, TENANT_ID)

    assert result["group"]["apps"] == [
        {
            "id": APP_ID,
            "name": "Customer support",
            "icon": "robot",
            "icon_type": "emoji",
            "icon_background": "#FFFFFF",
        }
    ]
    assert result["group"]["app_ids"] == [APP_ID, app_id_2]
    assert result["group"]["used_by_count"] == 2
    db_mock.session.scalars.assert_called_once()


def test_group_app_enrichment_degrades_to_ids_when_core_database_is_unavailable() -> None:
    payload = {"group": _group_payload(app_ids=[APP_ID])}
    db_mock = MagicMock()
    db_mock.session.scalars.side_effect = SQLAlchemyError("database unavailable")

    with patch("services.network_access_group_service.db", db_mock):
        result = NetworkAccessGroupService.enrich_app_references(payload, TENANT_ID)

    assert result["group"]["app_ids"] == [APP_ID]
    assert result["group"]["used_by_count"] == 1
    assert result["group"]["apps"] == []


def test_sandbox_read_returns_not_entitled_for_upgrade_state() -> None:
    api = CurrentWorkspaceNetworkAccessGroupsApi()
    method = unwrap(api.get)
    upstream_payload: dict[str, object] = {
        "tenantId": TENANT_ID,
        "entitled": True,
        "groups": list[object](),
    }

    with (
        patch.object(BillingService, "list_network_access_groups", return_value=upstream_payload),
        patch("controllers.console.workspace.network_access_group._effective_entitlement", return_value=False),
    ):
        result = method(api, current_tenant_id=TENANT_ID, current_user=_current_user())

    assert result["entitled"] is False


@pytest.mark.parametrize(
    ("upstream_entitled", "paid_plan", "expected"),
    [(True, True, True), (False, True, False), (True, False, False)],
)
def test_effective_entitlement_requires_rollout_and_paid_plan(
    upstream_entitled: bool,
    paid_plan: bool,
    expected: bool,
) -> None:
    with patch(
        "controllers.console.workspace.network_access_group.is_cloud_edition_billing_paid_plan",
        return_value=paid_plan,
    ):
        assert _effective_entitlement(TENANT_ID, upstream_entitled) is expected
