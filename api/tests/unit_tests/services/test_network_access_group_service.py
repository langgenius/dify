from collections.abc import Callable
from typing import NamedTuple
from unittest.mock import MagicMock, create_autospec

import pytest

from machinery.context import RequestContext
from services.network_access_group_service import (
    NetworkAccessGroupAccessDeniedError,
    NetworkAccessGroupAppNotFoundError,
    NetworkAccessGroupAppQuery,
    NetworkAccessGroupAppQueryError,
    NetworkAccessGroupAppRecord,
    NetworkAccessGroupControlPlane,
    NetworkAccessGroupEntitlement,
    NetworkAccessGroupService,
    NetworkAccessGroupUnsupportedAccessPointsError,
    NetworkAccessGroupUnsupportedAppModeError,
    WorkspaceMembershipRoleQuery,
)

WORKSPACE_ID = "workspace-1"
ACCOUNT_ID = "account-1"
APP_ID = "app-1"
GROUP_ID = "group-1"


class _Harness(NamedTuple):
    service: NetworkAccessGroupService
    control_plane: MagicMock
    apps: MagicMock
    memberships: MagicMock
    entitlement: MagicMock


def _context() -> RequestContext:
    return RequestContext(
        request_id="request-1",
        trace_id=None,
        account_id=ACCOUNT_ID,
        active_workspace_id=WORKSPACE_ID,
    )


def _app(*, app_id: str = APP_ID, mode: str = "workflow", name: str = "App") -> NetworkAccessGroupAppRecord:
    return NetworkAccessGroupAppRecord(
        id=app_id,
        mode=mode,
        name=name,
        icon=f"{app_id}.png",
        icon_type="image",
        icon_background="#FFFFFF",
    )


def _harness(*, role: str | None = "owner", paid: bool = True, app_mode: str = "workflow") -> _Harness:
    control_plane = create_autospec(NetworkAccessGroupControlPlane, instance=True, spec_set=True)
    apps = create_autospec(NetworkAccessGroupAppQuery, instance=True, spec_set=True)
    memberships = create_autospec(WorkspaceMembershipRoleQuery, instance=True, spec_set=True)
    entitlement = create_autospec(NetworkAccessGroupEntitlement, instance=True, spec_set=True)
    memberships.get_role_for_account.return_value = role
    entitlement.is_paid_plan.return_value = paid
    apps.get_manageable_app.return_value = _app(mode=app_mode)
    return _Harness(
        service=NetworkAccessGroupService(
            control_plane=control_plane,
            apps=apps,
            memberships=memberships,
            entitlement=entitlement,
        ),
        control_plane=control_plane,
        apps=apps,
        memberships=memberships,
        entitlement=entitlement,
    )


@pytest.mark.parametrize("role", ["normal", None])
def test_reads_reject_non_privileged_persisted_roles_before_control_plane(role: str | None) -> None:
    harness = _harness(role=role)

    with pytest.raises(NetworkAccessGroupAccessDeniedError):
        harness.service.list_groups(_context())

    harness.memberships.get_role_for_account.assert_called_once_with(
        workspace_id=WORKSPACE_ID,
        account_id=ACCOUNT_ID,
    )
    assert harness.control_plane.method_calls == []


Mutation = Callable[[NetworkAccessGroupService, RequestContext], object]


@pytest.mark.parametrize(
    "mutation",
    [
        pytest.param(
            lambda service, context: service.create_group(
                context,
                name="Office",
                description="Office network",
                allowed_cidrs=["203.0.113.0/24"],
            ),
            id="create-group",
        ),
        pytest.param(
            lambda service, context: service.update_group(
                context,
                group_id=GROUP_ID,
                name="Office",
                description="Office network",
                allowed_cidrs=["203.0.113.0/24"],
                expected_version=1,
            ),
            id="update-group",
        ),
        pytest.param(
            lambda service, context: service.delete_group(
                context,
                group_id=GROUP_ID,
                expected_version=1,
            ),
            id="delete-group",
        ),
        pytest.param(
            lambda service, context: service.update_app_binding(
                context,
                app_id=APP_ID,
                enabled=True,
                group_id=GROUP_ID,
                access_points=["webapp"],
                expected_version=1,
            ),
            id="update-app-binding",
        ),
    ],
)
@pytest.mark.parametrize("role", ["normal", None])
def test_mutations_reject_non_privileged_persisted_roles_before_control_plane(
    role: str | None,
    mutation: Mutation,
) -> None:
    harness = _harness(role=role)

    with pytest.raises(NetworkAccessGroupAccessDeniedError):
        mutation(harness.service, _context())

    harness.memberships.get_role_for_account.assert_called_once_with(
        workspace_id=WORKSPACE_ID,
        account_id=ACCOUNT_ID,
    )
    assert harness.control_plane.method_calls == []


@pytest.mark.parametrize("role", ["owner", "admin"])
def test_reads_allow_persisted_owner_and_admin(role: str) -> None:
    harness = _harness(role=role)
    harness.control_plane.list_groups.return_value = {"entitled": True, "groups": list[object]()}

    harness.service.list_groups(_context())

    harness.control_plane.list_groups.assert_called_once_with(WORKSPACE_ID, ACCOUNT_ID)


def test_mutation_does_not_repeat_http_paid_plan_admission() -> None:
    harness = _harness()
    harness.control_plane.create_group.return_value = {"group": {"id": GROUP_ID}}

    harness.service.create_group(
        _context(),
        name="Office",
        description="Office network",
        allowed_cidrs=["203.0.113.0/24"],
    )

    harness.entitlement.is_paid_plan.assert_not_called()


def test_public_use_cases_forward_workspace_actor_and_request_parameters() -> None:
    harness = _harness()
    harness.control_plane.list_groups.return_value = {"entitled": True, "groups": list[object]()}
    harness.control_plane.create_group.return_value = {"group": {"id": GROUP_ID}}
    harness.control_plane.get_group.return_value = {"group": {"id": GROUP_ID}}
    harness.control_plane.update_group.return_value = {"group": {"id": GROUP_ID}}
    harness.control_plane.delete_group.return_value = {"deleted": True}
    harness.control_plane.get_app_binding.return_value = {"entitled": True, "binding": None}
    harness.control_plane.update_app_binding.return_value = dict[str, object](binding=None)
    context = _context()

    harness.service.list_groups(context)
    harness.service.create_group(
        context,
        name="Office",
        description="Office network",
        allowed_cidrs=["203.0.113.0/24"],
    )
    harness.service.get_group(context, group_id=GROUP_ID)
    harness.service.update_group(
        context,
        group_id=GROUP_ID,
        name="Office v2",
        description="Updated network",
        allowed_cidrs=["203.0.113.7/32"],
        expected_version=2,
    )
    harness.service.delete_group(context, group_id=GROUP_ID, expected_version=3)
    harness.service.get_app_binding(context, app_id=APP_ID)
    harness.service.update_app_binding(
        context,
        app_id=APP_ID,
        enabled=True,
        group_id=GROUP_ID,
        access_points=["webapp", "service_api"],
        expected_version=4,
    )

    harness.control_plane.list_groups.assert_called_once_with(WORKSPACE_ID, ACCOUNT_ID)
    harness.control_plane.create_group.assert_called_once_with(
        WORKSPACE_ID,
        name="Office",
        description="Office network",
        allowed_cidrs=["203.0.113.0/24"],
        actor_account_id=ACCOUNT_ID,
    )
    harness.control_plane.get_group.assert_called_once_with(WORKSPACE_ID, GROUP_ID, ACCOUNT_ID)
    harness.control_plane.update_group.assert_called_once_with(
        WORKSPACE_ID,
        GROUP_ID,
        name="Office v2",
        description="Updated network",
        allowed_cidrs=["203.0.113.7/32"],
        expected_version=2,
        actor_account_id=ACCOUNT_ID,
    )
    harness.control_plane.delete_group.assert_called_once_with(
        WORKSPACE_ID,
        GROUP_ID,
        expected_version=3,
        actor_account_id=ACCOUNT_ID,
    )
    harness.control_plane.get_app_binding.assert_called_once_with(WORKSPACE_ID, APP_ID, ACCOUNT_ID)
    harness.control_plane.update_app_binding.assert_called_once_with(
        WORKSPACE_ID,
        APP_ID,
        enabled=True,
        group_id=GROUP_ID,
        access_points=["webapp", "service_api"],
        expected_version=4,
        actor_account_id=ACCOUNT_ID,
    )


def test_cleanup_app_binding_forwards_without_console_admission() -> None:
    harness = _harness()
    harness.control_plane.cleanup_app_binding.return_value = {"deleted": True}

    result = harness.service.cleanup_app_binding(workspace_id=WORKSPACE_ID, app_id=APP_ID)

    assert result == {"deleted": True}
    harness.control_plane.cleanup_app_binding.assert_called_once_with(WORKSPACE_ID, APP_ID)
    harness.memberships.get_role_for_account.assert_not_called()
    harness.entitlement.is_paid_plan.assert_not_called()


@pytest.mark.parametrize(
    ("upstream_entitled", "paid", "expected"),
    [
        (False, False, False),
        (False, True, False),
        (True, False, False),
        (True, True, True),
    ],
)
def test_list_effective_entitlement_requires_both_sources(
    upstream_entitled: bool,
    paid: bool,
    expected: bool,
) -> None:
    harness = _harness(paid=paid)
    harness.control_plane.list_groups.return_value = {
        "entitled": upstream_entitled,
        "groups": list[object](),
    }

    result = harness.service.list_groups(_context())

    assert result["entitled"] is expected


@pytest.mark.parametrize(
    ("mode", "available_access_points"),
    [
        ("workflow", ["webapp", "service_api", "mcp", "trigger"]),
        ("advanced-chat", ["webapp", "service_api", "mcp"]),
        ("chat", ["webapp", "service_api", "mcp"]),
        ("completion", ["webapp", "service_api", "mcp"]),
        ("agent-chat", ["webapp", "service_api", "mcp"]),
        ("agent", ["webapp", "service_api"]),
    ],
)
def test_app_binding_reports_access_points_for_each_supported_mode(
    mode: str,
    available_access_points: list[str],
) -> None:
    harness = _harness(app_mode=mode)
    harness.control_plane.get_app_binding.return_value = {"entitled": True, "binding": None}

    result = harness.service.get_app_binding(_context(), app_id=APP_ID)

    assert result["available_access_points"] == available_access_points


def test_app_binding_rejects_unsupported_app_mode_before_control_plane() -> None:
    harness = _harness(app_mode="site")

    with pytest.raises(NetworkAccessGroupUnsupportedAppModeError, match="'site'"):
        harness.service.get_app_binding(_context(), app_id=APP_ID)

    harness.control_plane.get_app_binding.assert_not_called()


def test_app_binding_rejects_missing_or_inaccessible_app_before_control_plane() -> None:
    harness = _harness()
    harness.apps.get_manageable_app.return_value = None

    with pytest.raises(NetworkAccessGroupAppNotFoundError):
        harness.service.get_app_binding(_context(), app_id=APP_ID)

    harness.apps.get_manageable_app.assert_called_once_with(workspace_id=WORKSPACE_ID, app_id=APP_ID)
    harness.memberships.get_role_for_account.assert_not_called()
    harness.control_plane.get_app_binding.assert_not_called()


def test_update_app_binding_rejects_missing_or_inaccessible_app_before_control_plane() -> None:
    harness = _harness()
    harness.apps.get_manageable_app.return_value = None

    with pytest.raises(NetworkAccessGroupAppNotFoundError):
        harness.service.update_app_binding(
            _context(),
            app_id=APP_ID,
            enabled=True,
            group_id=GROUP_ID,
            access_points=["webapp"],
            expected_version=1,
        )

    harness.apps.get_manageable_app.assert_called_once_with(workspace_id=WORKSPACE_ID, app_id=APP_ID)
    harness.memberships.get_role_for_account.assert_not_called()
    harness.control_plane.update_app_binding.assert_not_called()


def test_update_app_binding_rejects_access_points_not_supported_by_mode() -> None:
    harness = _harness(app_mode="agent")

    with pytest.raises(NetworkAccessGroupUnsupportedAccessPointsError) as exc_info:
        harness.service.update_app_binding(
            _context(),
            app_id=APP_ID,
            enabled=True,
            group_id=GROUP_ID,
            access_points=["trigger", "mcp"],
            expected_version=1,
        )

    assert exc_info.value.access_points == ("mcp", "trigger")
    harness.control_plane.update_app_binding.assert_not_called()


def test_app_binding_materializes_protojson_defaults() -> None:
    harness = _harness(app_mode="chat")
    harness.control_plane.get_app_binding.return_value = {
        "entitled": True,
        "binding": dict[str, object](),
    }

    result = harness.service.get_app_binding(_context(), app_id=APP_ID)

    assert result["binding"] == {"enabled": False, "access_points": []}


def test_app_binding_normalizes_camel_case_and_filters_stale_access_points() -> None:
    harness = _harness(app_mode="chat")
    harness.control_plane.get_app_binding.return_value = {
        "entitled": True,
        "binding": {"enabled": True, "accessPoints": ["webapp", "trigger", "mcp"]},
    }

    result = harness.service.get_app_binding(_context(), app_id=APP_ID)

    assert result["binding"] == {"enabled": True, "access_points": ["webapp", "mcp"]}


def test_group_payloads_are_enriched_with_tenant_scoped_app_metadata() -> None:
    harness = _harness()
    harness.control_plane.list_groups.return_value = {
        "entitled": True,
        "groups": [
            {
                "id": "group-1",
                "usedByAppIds": ["app-2", "missing-app", "app-1"],
                "usedByCount": "3",
            },
            {"id": "group-2", "app_ids": ["app-1"]},
        ],
    }
    harness.apps.list_apps.return_value = [
        _app(app_id="app-1", name="One"),
        _app(app_id="app-2", name="Two"),
    ]

    result = harness.service.list_groups(_context())

    groups = result["groups"]
    assert groups[0]["app_ids"] == ["app-2", "missing-app", "app-1"]
    assert groups[0]["used_by_count"] == "3"
    assert [app["id"] for app in groups[0]["apps"]] == ["app-2", "app-1"]
    assert groups[1]["used_by_count"] == 1
    assert groups[1]["apps"] == [
        {
            "id": "app-1",
            "name": "One",
            "icon": "app-1.png",
            "icon_type": "image",
            "icon_background": "#FFFFFF",
        }
    ]
    call_kwargs = harness.apps.list_apps.call_args.kwargs
    assert call_kwargs["workspace_id"] == WORKSPACE_ID
    assert set(call_kwargs["app_ids"]) == {"app-1", "app-2", "missing-app"}


def test_app_query_failure_degrades_group_enrichment_to_empty_apps() -> None:
    harness = _harness()
    harness.control_plane.get_group.return_value = {
        "group": {"id": GROUP_ID, "used_by_app_ids": [APP_ID], "used_by_count": 1}
    }
    harness.apps.list_apps.side_effect = NetworkAccessGroupAppQueryError

    result = harness.service.get_group(_context(), group_id=GROUP_ID)

    assert result["group"]["app_ids"] == [APP_ID]
    assert result["group"]["apps"] == []
