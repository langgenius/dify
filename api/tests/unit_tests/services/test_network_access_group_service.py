from collections.abc import Callable
from datetime import UTC, datetime
from typing import NamedTuple
from unittest.mock import MagicMock, create_autospec

import pytest

from machinery.context import RequestContext
from services.entities.network_access_group_entities import (
    NetworkAccessAppConfig,
    NetworkAccessBinding,
    NetworkAccessBindingUpdate,
    NetworkAccessCurrentIPCheck,
    NetworkAccessGroup,
    NetworkAccessGroupList,
)
from services.network_access_group_service import (
    NetworkAccessGroupAccessDeniedError,
    NetworkAccessGroupAppNotFoundError,
    NetworkAccessGroupAppQuery,
    NetworkAccessGroupAppQueryError,
    NetworkAccessGroupAppRecord,
    NetworkAccessGroupControlPlane,
    NetworkAccessGroupEntitlement,
    NetworkAccessGroupInvalidPolicyError,
    NetworkAccessGroupService,
    NetworkAccessGroupUnsupportedAccessPointsError,
    NetworkAccessGroupUnsupportedAppModeError,
    NetworkAccessGroupUpstreamError,
    WorkspaceMembershipRoleQuery,
)

WORKSPACE_ID = "workspace-1"
ACCOUNT_ID = "account-1"
APP_ID = "app-1"
GROUP_ID = "group-1"
NOW = datetime(2026, 9, 1, tzinfo=UTC)


def _group(
    *,
    group_id: str = GROUP_ID,
    app_ids: tuple[str, ...] = (),
    version: int = 1,
    allowed_cidrs: tuple[str, ...] = ("203.0.113.0/24",),
    used_by_count: int | None = None,
    enforcing_count: int = 0,
) -> NetworkAccessGroup:
    return NetworkAccessGroup(
        group_id,
        WORKSPACE_ID,
        "Office",
        "",
        allowed_cidrs,
        version,
        len(app_ids) if used_by_count is None else used_by_count,
        enforcing_count,
        app_ids,
        ACCOUNT_ID,
        NOW,
        NOW,
    )


def _binding(
    *, enabled: bool = False, group_id: str | None = None, access_points: tuple[str, ...] = ()
) -> NetworkAccessBinding:
    return NetworkAccessBinding(
        "binding", WORKSPACE_ID, APP_ID, enabled, group_id, access_points, 1, ACCOUNT_ID, NOW, NOW
    )


def _config(
    binding: NetworkAccessBinding | None = None, *, effective_enabled: bool = False, entitled: bool = True
) -> NetworkAccessAppConfig:
    return NetworkAccessAppConfig(WORKSPACE_ID, APP_ID, entitled, effective_enabled, binding)


def _groups(groups: tuple[NetworkAccessGroup, ...] = (), *, entitled: bool = True) -> NetworkAccessGroupList:
    return NetworkAccessGroupList(WORKSPACE_ID, entitled, groups)


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


def _app(
    *,
    app_id: str = APP_ID,
    mode: str = "workflow",
    name: str = "App",
    bound_agent_id: str | None = None,
) -> NetworkAccessGroupAppRecord:
    return NetworkAccessGroupAppRecord(
        id=app_id,
        mode=mode,
        name=name,
        icon=f"{app_id}.png",
        icon_type="image",
        icon_background="#FFFFFF",
        bound_agent_id=bound_agent_id,
    )


def _harness(*, role: str | None = "owner", paid: bool = True, app_mode: str = "workflow") -> _Harness:
    control_plane = create_autospec(NetworkAccessGroupControlPlane, instance=True, spec_set=True)
    apps = create_autospec(NetworkAccessGroupAppQuery, instance=True, spec_set=True)
    memberships = create_autospec(WorkspaceMembershipRoleQuery, instance=True, spec_set=True)
    entitlement = create_autospec(NetworkAccessGroupEntitlement, instance=True, spec_set=True)
    memberships.get_role_for_account.return_value = role
    entitlement.is_paid_plan.return_value = paid
    apps.get_manageable_app.return_value = _app(mode=app_mode)
    apps.list_apps.return_value = list[NetworkAccessGroupAppRecord]()
    control_plane.list_groups.return_value = _groups()
    for method in (control_plane.get_group, control_plane.create_group, control_plane.update_group):
        method.return_value = _group()
    control_plane.get_app_binding.return_value = _config()
    control_plane.update_app_binding.return_value = NetworkAccessBindingUpdate(_binding(), False)
    control_plane.delete_group.return_value = True
    control_plane.cleanup_app_binding.return_value = True
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


@pytest.mark.parametrize("role", ["normal", "dataset_operator", None])
@pytest.mark.parametrize(
    "read",
    [
        pytest.param(lambda service: service.list_groups(_context()), id="list"),
        pytest.param(lambda service: service.get_group(_context(), group_id=GROUP_ID), id="detail"),
    ],
)
def test_reads_reject_non_privileged_persisted_roles_before_control_plane(
    role: str | None, read: Callable[[NetworkAccessGroupService], object]
) -> None:
    harness = _harness(role=role)

    with pytest.raises(NetworkAccessGroupAccessDeniedError):
        read(harness.service)

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
@pytest.mark.parametrize("role", ["normal", "dataset_operator", None])
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


@pytest.mark.parametrize("role", ["owner", "admin", "editor"])
def test_policy_reads_allow_persisted_owner_admin_and_editor(role: str) -> None:
    harness = _harness(role=role)
    harness.control_plane.list_groups.return_value = _groups()
    harness.control_plane.get_group.return_value = _group()

    harness.service.list_groups(_context())
    harness.service.get_group(_context(), group_id=GROUP_ID)

    harness.control_plane.list_groups.assert_called_once_with(WORKSPACE_ID, ACCOUNT_ID)
    harness.control_plane.get_group.assert_called_once_with(WORKSPACE_ID, GROUP_ID, ACCOUNT_ID)


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
    ],
)
def test_policy_mutations_reject_editor_before_control_plane(mutation: Mutation) -> None:
    harness = _harness(role="editor")

    with pytest.raises(NetworkAccessGroupAccessDeniedError):
        mutation(harness.service, _context())

    assert harness.control_plane.method_calls == []


@pytest.mark.parametrize("role", ["owner", "admin", "editor"])
def test_app_binding_get_and_put_allow_privileged_roles(role: str) -> None:
    harness = _harness(role=role)
    harness.control_plane.get_app_binding.return_value = _config()
    harness.control_plane.update_app_binding.return_value = NetworkAccessBindingUpdate(
        _binding(enabled=True, group_id=GROUP_ID, access_points=("webapp",)), True
    )

    harness.service.get_app_binding(_context(), app_id=APP_ID)
    harness.service.update_app_binding(
        _context(),
        app_id=APP_ID,
        enabled=True,
        group_id=GROUP_ID,
        access_points=["webapp"],
        expected_version=1,
    )

    harness.control_plane.get_app_binding.assert_called_once_with(WORKSPACE_ID, APP_ID, ACCOUNT_ID)
    harness.control_plane.update_app_binding.assert_called_once()


@pytest.mark.parametrize(
    "operation",
    [
        pytest.param(
            lambda service, context: service.get_app_binding(context, app_id=APP_ID),
            id="get",
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
            id="put",
        ),
    ],
)
@pytest.mark.parametrize("role", ["normal", "dataset_operator", None])
def test_app_binding_rejects_disallowed_roles_before_app_lookup(operation: Mutation, role: str | None) -> None:
    harness = _harness(role=role)

    with pytest.raises(NetworkAccessGroupAccessDeniedError):
        operation(harness.service, _context())

    harness.apps.get_manageable_app.assert_not_called()
    assert harness.control_plane.method_calls == []


def test_mutation_does_not_repeat_http_paid_plan_admission() -> None:
    harness = _harness()
    harness.control_plane.create_group.return_value = _group()

    harness.service.create_group(
        _context(),
        name="Office",
        description="Office network",
        allowed_cidrs=["203.0.113.0/24"],
    )

    harness.entitlement.is_paid_plan.assert_not_called()


@pytest.mark.parametrize("role", ["owner", "admin"])
def test_public_use_cases_forward_workspace_actor_and_request_parameters(role: str) -> None:
    harness = _harness(role=role)
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
    harness.control_plane.cleanup_app_binding.return_value = True

    result = harness.service.cleanup_app_binding(workspace_id=WORKSPACE_ID, app_id=APP_ID)

    assert result is True
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
    harness.control_plane.list_groups.return_value = _groups(entitled=upstream_entitled)

    result = harness.service.list_groups(_context())

    assert result.entitled is expected


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
    harness.control_plane.get_app_binding.return_value = _config()

    result = harness.service.get_app_binding(_context(), app_id=APP_ID)

    assert result.available_access_points == tuple(available_access_points)


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
    harness.memberships.get_role_for_account.assert_called_once_with(
        workspace_id=WORKSPACE_ID,
        account_id=ACCOUNT_ID,
    )
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
    harness.memberships.get_role_for_account.assert_called_once_with(
        workspace_id=WORKSPACE_ID,
        account_id=ACCOUNT_ID,
    )
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


def test_disabled_binding_stays_disabled() -> None:
    harness = _harness(app_mode="chat")
    harness.control_plane.get_app_binding.return_value = _config(_binding())

    result = harness.service.get_app_binding(_context(), app_id=APP_ID)

    assert result.binding == _binding()
    assert result.effective_enabled is False


def test_app_binding_filters_stale_and_future_scopes_without_mutating_snapshot() -> None:
    harness = _harness(app_mode="chat")
    saved = _binding(enabled=True, group_id=GROUP_ID, access_points=("webapp", "trigger", "mcp", "future"))
    harness.control_plane.get_app_binding.return_value = _config(saved)

    result = harness.service.get_app_binding(_context(), app_id=APP_ID)

    assert result.binding == _binding(enabled=True, group_id=GROUP_ID, access_points=("webapp", "mcp"))
    assert result.effective_enabled is False
    assert saved.access_points == ("webapp", "trigger", "mcp", "future")


def test_group_payloads_are_enriched_with_tenant_scoped_app_metadata() -> None:
    harness = _harness()
    harness.control_plane.list_groups.return_value = _groups(
        (
            _group(app_ids=("app-2", "missing-app", "app-1")),
            _group(group_id="group-2", app_ids=("app-1",)),
        )
    )
    harness.apps.list_apps.return_value = [
        _app(app_id="app-1", name="One"),
        _app(app_id="app-2", name="Two"),
    ]

    result = harness.service.list_groups(_context())

    groups = result.groups
    assert groups[0].app_ids == ("app-2", "missing-app", "app-1")
    assert groups[0].used_by_count == 3
    assert [app.id for app in groups[0].apps] == ["app-2", "app-1"]
    assert groups[1].used_by_count == 1
    assert groups[1].apps == (_app(app_id="app-1", name="One"),)
    call_kwargs = harness.apps.list_apps.call_args.kwargs
    assert call_kwargs["workspace_id"] == WORKSPACE_ID
    assert set(call_kwargs["app_ids"]) == {"app-1", "app-2", "missing-app"}


def test_app_query_failure_degrades_group_enrichment_to_empty_apps() -> None:
    harness = _harness()
    harness.control_plane.get_group.return_value = _group(app_ids=(APP_ID,))
    harness.apps.list_apps.side_effect = NetworkAccessGroupAppQueryError

    result = harness.service.get_group(_context(), group_id=GROUP_ID)

    assert result.app_ids == (APP_ID,)
    assert result.apps == ()


@pytest.mark.parametrize(("paid", "expected"), [(True, True), (False, False)])
def test_app_effective_enabled_is_bounded_by_final_entitlement(paid: bool, expected: bool) -> None:
    harness = _harness(paid=paid, app_mode="chat")
    saved = _binding(enabled=True, group_id=GROUP_ID, access_points=("webapp", "service_api"))
    harness.control_plane.get_app_binding.return_value = _config(saved, effective_enabled=True)

    result = harness.service.get_app_binding(_context(), app_id=APP_ID)

    assert result.effective_enabled is expected
    assert result.binding is not None
    assert result.binding.enabled is True
    assert harness.control_plane.get_app_binding.return_value.entitled is True


def test_app_effective_enabled_does_not_reenable_an_incomplete_filtered_binding() -> None:
    harness = _harness(app_mode="agent")
    harness.control_plane.update_app_binding.return_value = NetworkAccessBindingUpdate(
        _binding(enabled=True, group_id=GROUP_ID, access_points=("mcp",)), True
    )

    result = harness.service.update_app_binding(
        _context(),
        app_id=APP_ID,
        enabled=False,
        group_id=GROUP_ID,
        access_points=[],
        expected_version=1,
    )

    assert result.binding.enabled is True
    assert result.binding.group_id == GROUP_ID
    assert result.binding.access_points == ()
    assert result.effective_enabled is False


@pytest.mark.parametrize(("paid", "expected"), [(True, 2), (False, 0)])
def test_group_enforcing_count_is_normalized_and_bounded_by_final_entitlement(
    paid: bool,
    expected: int,
) -> None:
    harness = _harness(paid=paid)
    harness.control_plane.list_groups.return_value = _groups((_group(enforcing_count=2, used_by_count=3),))

    result = harness.service.list_groups(_context())

    assert result.groups[0].enforcing_count == expected


def test_group_with_zero_enforcement_retains_zero() -> None:
    harness = _harness()
    harness.control_plane.get_group.return_value = _group()

    result = harness.service.get_group(_context(), group_id=GROUP_ID)

    assert result.enforcing_count == 0


def test_group_enrichment_includes_agent_routing_metadata() -> None:
    harness = _harness()
    harness.control_plane.get_group.return_value = _group(app_ids=(APP_ID,))
    harness.apps.list_apps.return_value = [_app(app_id=APP_ID, mode="agent", name="Agent", bound_agent_id="agent-1")]

    result = harness.service.get_group(_context(), group_id=GROUP_ID)

    assert result.apps == (_app(app_id=APP_ID, mode="agent", name="Agent", bound_agent_id="agent-1"),)


def test_current_ip_check_authorizes_and_loads_tenant_policy_before_reading_ip() -> None:
    harness = _harness(role="editor")
    order: list[str] = []
    harness.memberships.get_role_for_account.side_effect = lambda **_kwargs: order.append("role") or "editor"
    harness.control_plane.get_group.side_effect = lambda *_args: (
        order.append("policy") or _group(version=7, allowed_cidrs=("2001:db8::/32",))
    )

    result = harness.service.check_current_ip(
        _context(),
        group_id=GROUP_ID,
        client_ip_supplier=lambda: order.append("ip") or "2001:db8::42",
    )

    assert order == ["role", "policy", "ip"]
    assert result == NetworkAccessCurrentIPCheck("2001:db8::42", True, 7)


@pytest.mark.parametrize("role", ["owner", "admin", "editor"])
@pytest.mark.parametrize("paid", [True, False], ids=["paid", "lapsed-or-free"])
def test_current_ip_read_needs_no_policy_and_preserves_read_admission(role: str, paid: bool) -> None:
    harness = _harness(role=role, paid=paid)
    order: list[str] = []
    harness.memberships.get_role_for_account.side_effect = lambda **_kwargs: order.append("role") or role

    result = harness.service.get_current_ip(
        _context(),
        client_ip_supplier=lambda: order.append("ip") or "2001:db8::42",
    )

    assert result == "2001:db8::42"
    assert order == ["role", "ip"]
    harness.memberships.get_role_for_account.assert_called_once_with(
        workspace_id=WORKSPACE_ID,
        account_id=ACCOUNT_ID,
    )
    assert harness.control_plane.method_calls == []
    assert harness.apps.method_calls == []
    harness.entitlement.is_paid_plan.assert_not_called()


@pytest.mark.parametrize("role", ["normal", "dataset_operator", "unknown", None])
def test_current_ip_read_rejects_disallowed_persisted_roles_before_reading_ip(role: str | None) -> None:
    harness = _harness(role=role)
    supplier = MagicMock(return_value="203.0.113.7")

    with pytest.raises(NetworkAccessGroupAccessDeniedError):
        harness.service.get_current_ip(_context(), client_ip_supplier=supplier)

    supplier.assert_not_called()
    assert harness.control_plane.method_calls == []
    assert harness.apps.method_calls == []
    harness.entitlement.is_paid_plan.assert_not_called()


@pytest.mark.parametrize("role", ["normal", "dataset_operator", None])
def test_current_ip_check_rejects_role_before_policy_or_ip_lookup(role: str | None) -> None:
    harness = _harness(role=role)
    supplier = MagicMock(return_value="203.0.113.7")

    with pytest.raises(NetworkAccessGroupAccessDeniedError):
        harness.service.check_current_ip(_context(), group_id=GROUP_ID, client_ip_supplier=supplier)

    harness.control_plane.get_group.assert_not_called()
    supplier.assert_not_called()


def test_current_ip_check_does_not_read_ip_when_tenant_scoped_policy_lookup_fails() -> None:
    harness = _harness(role="admin")
    harness.control_plane.get_group.side_effect = NetworkAccessGroupUpstreamError(404)
    supplier = MagicMock(return_value="203.0.113.7")

    with pytest.raises(NetworkAccessGroupUpstreamError):
        harness.service.check_current_ip(_context(), group_id=GROUP_ID, client_ip_supplier=supplier)

    supplier.assert_not_called()


@pytest.mark.parametrize(
    ("allowed_cidrs", "client_ip", "expected"),
    [
        (["203.0.113.0/24"], "::ffff:203.0.113.7", True),
        (["::ffff:203.0.113.0/120"], "203.0.113.7", True),
        (["2001:db8::/32"], "2001:db8:1::1", True),
        (["2001:db8::/48"], "2001:db9::1", False),
    ],
)
def test_current_ip_check_matches_ipv4_ipv6_and_mapped_addresses_consistently(
    allowed_cidrs: list[str],
    client_ip: str,
    expected: bool,
) -> None:
    harness = _harness()
    harness.control_plane.get_group.return_value = _group(allowed_cidrs=tuple(allowed_cidrs))

    result = harness.service.check_current_ip(
        _context(),
        group_id=GROUP_ID,
        client_ip_supplier=lambda: client_ip,
    )

    assert result.allowed is expected


@pytest.mark.parametrize(
    "allowed_cidrs",
    [
        [],
        ["0.0.0.0/0", "not-a-cidr"],
        ["fe80::1%eth0/128"],
        ["::ffff:0:0/80"],
    ],
)
def test_current_ip_check_rejects_malformed_policy_without_short_circuiting(
    allowed_cidrs: list[str],
) -> None:
    harness = _harness()
    harness.control_plane.get_group.return_value = _group(allowed_cidrs=tuple(allowed_cidrs))

    with pytest.raises(NetworkAccessGroupInvalidPolicyError):
        harness.service.check_current_ip(
            _context(),
            group_id=GROUP_ID,
            client_ip_supplier=lambda: "203.0.113.7",
        )
