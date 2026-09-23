"""Application service for workspace network access groups."""

import ipaddress
import logging
from collections.abc import Callable, Sequence
from dataclasses import replace
from typing import Protocol

from machinery.context import RequestContext
from services.entities.network_access_group_entities import (
    NetworkAccessAppConfig,
    NetworkAccessBinding,
    NetworkAccessBindingUpdate,
    NetworkAccessCurrentIPCheck,
    NetworkAccessGroup,
    NetworkAccessGroupAppRecord,
    NetworkAccessGroupList,
    NetworkAccessPoint,
)

logger = logging.getLogger(__name__)

_POLICY_READ_ROLES = frozenset({"owner", "admin", "editor"})
_POLICY_WRITE_ROLES = frozenset({"owner", "admin"})
_APP_BINDING_ROLES = _POLICY_READ_ROLES

_ACCESS_POINTS_BY_APP_MODE: dict[str, tuple[NetworkAccessPoint, ...]] = {
    "workflow": ("webapp", "service_api", "mcp", "trigger"),
    "advanced-chat": ("webapp", "service_api", "mcp"),
    "chat": ("webapp", "service_api", "mcp"),
    "completion": ("webapp", "service_api", "mcp"),
    "agent-chat": ("webapp", "service_api", "mcp"),
    "agent": ("webapp", "service_api"),
}


class NetworkAccessGroupError(Exception):
    """Expected network access group use-case failure."""


class NetworkAccessGroupUpstreamError(NetworkAccessGroupError):
    """Failure returned by the network-access control plane."""

    def __init__(self, status_code: int, reason: str | None = None) -> None:
        self.status_code = status_code
        self.reason = reason
        super().__init__(f"network access group upstream returned HTTP {status_code}")


class NetworkAccessGroupAccessDeniedError(NetworkAccessGroupError):
    """The actor's persisted workspace role does not allow the operation."""


class NetworkAccessGroupEntitlementUnavailableError(NetworkAccessGroupError):
    """The workspace plan could not be resolved."""


class NetworkAccessGroupAppNotFoundError(NetworkAccessGroupError):
    """The tenant-scoped App does not exist or is not manageable."""


class NetworkAccessGroupUnsupportedAppModeError(NetworkAccessGroupError):
    def __init__(self, app_mode: str) -> None:
        self.app_mode = app_mode
        super().__init__(f"network access control is not supported for app mode {app_mode!r}")


class NetworkAccessGroupUnsupportedAccessPointsError(NetworkAccessGroupError):
    def __init__(self, access_points: Sequence[str]) -> None:
        self.access_points = tuple(access_points)
        super().__init__(f"unsupported app access points: {', '.join(self.access_points)}")


class NetworkAccessGroupInvalidPolicyError(NetworkAccessGroupError):
    """The control plane returned a policy that cannot be evaluated safely."""


class NetworkAccessGroupInvalidResponseError(NetworkAccessGroupError):
    """The control plane returned a malformed wire response, not an unavailable service."""


class NetworkAccessGroupAppQueryError(Exception):
    """The local App read model could not be queried."""


class NetworkAccessGroupAppQuery(Protocol):
    def get_manageable_app(self, *, workspace_id: str, app_id: str) -> NetworkAccessGroupAppRecord | None: ...

    def list_apps(
        self,
        *,
        workspace_id: str,
        app_ids: Sequence[str],
    ) -> Sequence[NetworkAccessGroupAppRecord]: ...


class WorkspaceMembershipRoleQuery(Protocol):
    def get_role_for_account(self, *, workspace_id: str, account_id: str) -> str | None: ...


class NetworkAccessGroupEntitlement(Protocol):
    def is_paid_plan(self, workspace_id: str) -> bool: ...


class NetworkAccessGroupControlPlane(Protocol):
    def list_groups(self, workspace_id: str, actor_account_id: str) -> NetworkAccessGroupList: ...

    def create_group(
        self,
        workspace_id: str,
        *,
        name: str,
        description: str,
        allowed_cidrs: list[str],
        actor_account_id: str,
    ) -> NetworkAccessGroup: ...

    def get_group(self, workspace_id: str, group_id: str, actor_account_id: str) -> NetworkAccessGroup: ...

    def update_group(
        self,
        workspace_id: str,
        group_id: str,
        *,
        name: str,
        description: str,
        allowed_cidrs: list[str],
        expected_version: int,
        actor_account_id: str,
    ) -> NetworkAccessGroup: ...

    def delete_group(
        self,
        workspace_id: str,
        group_id: str,
        *,
        expected_version: int,
        actor_account_id: str,
    ) -> bool: ...

    def get_app_binding(self, workspace_id: str, app_id: str, actor_account_id: str) -> NetworkAccessAppConfig: ...

    def update_app_binding(
        self,
        workspace_id: str,
        app_id: str,
        *,
        enabled: bool,
        group_id: str | None,
        access_points: list[str],
        expected_version: int,
        actor_account_id: str,
    ) -> NetworkAccessBindingUpdate: ...

    def cleanup_app_binding(self, workspace_id: str, app_id: str) -> bool: ...


class NetworkAccessGroupService:
    def __init__(
        self,
        *,
        control_plane: NetworkAccessGroupControlPlane,
        apps: NetworkAccessGroupAppQuery,
        memberships: WorkspaceMembershipRoleQuery,
        entitlement: NetworkAccessGroupEntitlement,
    ) -> None:
        self._control_plane = control_plane
        self._apps = apps
        self._memberships = memberships
        self._entitlement = entitlement

    def list_groups(self, context: RequestContext) -> NetworkAccessGroupList:
        self._ensure_workspace_role(context, _POLICY_READ_ROLES)
        result = self._control_plane.list_groups(context.active_workspace_id, context.account_id)
        entitled = self._effective_entitlement(context.active_workspace_id, result.entitled)
        groups = result.groups if entitled else tuple(replace(group, enforcing_count=0) for group in result.groups)
        return replace(result, entitled=entitled, groups=self._enrich_groups(groups, context.active_workspace_id))

    def create_group(
        self,
        context: RequestContext,
        *,
        name: str,
        description: str,
        allowed_cidrs: list[str],
    ) -> NetworkAccessGroup:
        self._ensure_workspace_role(context, _POLICY_WRITE_ROLES)
        group = self._control_plane.create_group(
            context.active_workspace_id,
            name=name,
            description=description,
            allowed_cidrs=allowed_cidrs,
            actor_account_id=context.account_id,
        )
        return self._enrich_groups((group,), context.active_workspace_id)[0]

    def get_group(self, context: RequestContext, *, group_id: str) -> NetworkAccessGroup:
        self._ensure_workspace_role(context, _POLICY_READ_ROLES)
        group = self._control_plane.get_group(
            context.active_workspace_id,
            group_id,
            context.account_id,
        )
        return self._enrich_groups((group,), context.active_workspace_id)[0]

    def update_group(
        self,
        context: RequestContext,
        *,
        group_id: str,
        name: str,
        description: str,
        allowed_cidrs: list[str],
        expected_version: int,
    ) -> NetworkAccessGroup:
        self._ensure_workspace_role(context, _POLICY_WRITE_ROLES)
        group = self._control_plane.update_group(
            context.active_workspace_id,
            group_id,
            name=name,
            description=description,
            allowed_cidrs=allowed_cidrs,
            expected_version=expected_version,
            actor_account_id=context.account_id,
        )
        return self._enrich_groups((group,), context.active_workspace_id)[0]

    def delete_group(
        self,
        context: RequestContext,
        *,
        group_id: str,
        expected_version: int,
    ) -> bool:
        self._ensure_workspace_role(context, _POLICY_WRITE_ROLES)
        return self._control_plane.delete_group(
            context.active_workspace_id,
            group_id,
            expected_version=expected_version,
            actor_account_id=context.account_id,
        )

    def get_app_binding(self, context: RequestContext, *, app_id: str) -> NetworkAccessAppConfig:
        self._ensure_workspace_role(context, _APP_BINDING_ROLES)
        app = self._get_manageable_app(context.active_workspace_id, app_id)
        available_access_points = self._available_access_points(app.mode)
        result = self._control_plane.get_app_binding(
            context.active_workspace_id,
            app.id,
            context.account_id,
        )
        binding = self._filter_binding(result.binding, available_access_points)
        entitled = self._effective_entitlement(context.active_workspace_id, result.entitled)
        return replace(
            result,
            binding=binding,
            entitled=entitled,
            available_access_points=available_access_points,
            effective_enabled=self._effective_enabled(result.effective_enabled, binding, entitled),
        )

    def update_app_binding(
        self,
        context: RequestContext,
        *,
        app_id: str,
        enabled: bool,
        group_id: str | None,
        access_points: list[NetworkAccessPoint],
        expected_version: int,
    ) -> NetworkAccessBindingUpdate:
        self._ensure_workspace_role(context, _APP_BINDING_ROLES)
        app = self._get_manageable_app(context.active_workspace_id, app_id)
        available_access_points = self._available_access_points(app.mode)
        self._validate_app_access_points(access_points, available_access_points)
        result = self._control_plane.update_app_binding(
            context.active_workspace_id,
            app.id,
            enabled=enabled,
            group_id=group_id,
            access_points=list(access_points),
            expected_version=expected_version,
            actor_account_id=context.account_id,
        )
        binding = replace(
            result.binding,
            access_points=tuple(point for point in result.binding.access_points if point in available_access_points),
        )
        return replace(
            result,
            binding=binding,
            available_access_points=available_access_points,
            effective_enabled=self._effective_enabled(result.effective_enabled, binding),
        )

    def get_current_ip(
        self,
        context: RequestContext,
        *,
        client_ip_supplier: Callable[[], str],
    ) -> str:
        """Return trusted request metadata without requiring a saved policy.

        Like policy reads and the existing IP preflight, this read-only helper
        authorizes the persisted workspace role before resolving the request IP.
        It does not create a policy, enable enforcement, or require a paid plan;
        policy mutations keep their separate paid-plan admission.
        """

        self._ensure_workspace_role(context, _POLICY_READ_ROLES)
        return client_ip_supplier()

    def check_current_ip(
        self,
        context: RequestContext,
        *,
        group_id: str,
        client_ip_supplier: Callable[[], str],
    ) -> NetworkAccessCurrentIPCheck:
        """Evaluate the request's trusted client IP against one tenant policy.

        The supplier is deliberately lazy: persisted workspace authorization and
        tenant-scoped policy resolution both complete before request IP metadata
        is read or returned.
        """

        self._ensure_workspace_role(context, _POLICY_READ_ROLES)
        group = self._control_plane.get_group(
            context.active_workspace_id,
            group_id,
            context.account_id,
        )
        client_ip = client_ip_supplier()
        allowed = self._policy_allows_client_ip(group.allowed_cidrs, client_ip)
        return NetworkAccessCurrentIPCheck(client_ip, allowed, group.version)

    def cleanup_app_binding(self, *, workspace_id: str, app_id: str) -> bool:
        return self._control_plane.cleanup_app_binding(workspace_id, app_id)

    def _ensure_workspace_role(self, context: RequestContext, allowed_roles: frozenset[str]) -> None:
        role = self._memberships.get_role_for_account(
            workspace_id=context.active_workspace_id,
            account_id=context.account_id,
        )
        if role not in allowed_roles:
            raise NetworkAccessGroupAccessDeniedError

    def _effective_entitlement(self, workspace_id: str, upstream_entitled: bool) -> bool:
        return upstream_entitled and self._entitlement.is_paid_plan(workspace_id)

    def _get_manageable_app(self, workspace_id: str, app_id: str) -> NetworkAccessGroupAppRecord:
        app = self._apps.get_manageable_app(workspace_id=workspace_id, app_id=app_id)
        if app is None:
            raise NetworkAccessGroupAppNotFoundError
        return app

    @staticmethod
    def _available_access_points(app_mode: str) -> tuple[NetworkAccessPoint, ...]:
        available = _ACCESS_POINTS_BY_APP_MODE.get(app_mode)
        if available is None:
            raise NetworkAccessGroupUnsupportedAppModeError(app_mode)
        return available

    @staticmethod
    def _validate_app_access_points(
        requested: Sequence[NetworkAccessPoint],
        available: Sequence[NetworkAccessPoint],
    ) -> None:
        unsupported = sorted(set(requested).difference(available))
        if unsupported:
            raise NetworkAccessGroupUnsupportedAccessPointsError(unsupported)

    @staticmethod
    def _filter_binding(
        binding: NetworkAccessBinding | None,
        available: Sequence[NetworkAccessPoint],
    ) -> NetworkAccessBinding | None:
        """Project current capabilities without mutating the saved binding snapshot."""
        if binding is None:
            return None
        return replace(binding, access_points=tuple(point for point in binding.access_points if point in available))

    @staticmethod
    def _effective_enabled(upstream: bool, binding: NetworkAccessBinding | None, entitled: bool = True) -> bool:
        return bool(
            upstream
            and entitled
            and binding is not None
            and binding.enabled
            and binding.group_id
            and binding.access_points
        )

    @staticmethod
    def _policy_allows_client_ip(raw_cidrs: Sequence[object], client_ip: str) -> bool:
        if not raw_cidrs or "%" in client_ip:
            raise NetworkAccessGroupInvalidPolicyError
        try:
            address = NetworkAccessGroupService._normalize_ip_address(ipaddress.ip_address(client_ip))
            networks = [NetworkAccessGroupService._normalize_ip_network(raw_cidr) for raw_cidr in raw_cidrs]
        except (TypeError, ValueError) as exc:
            raise NetworkAccessGroupInvalidPolicyError from exc
        return any(address.version == network.version and address in network for network in networks)

    @staticmethod
    def _normalize_ip_address(
        address: ipaddress.IPv4Address | ipaddress.IPv6Address,
    ) -> ipaddress.IPv4Address | ipaddress.IPv6Address:
        if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped is not None:
            return address.ipv4_mapped
        return address

    @staticmethod
    def _normalize_ip_network(raw_cidr: object) -> ipaddress.IPv4Network | ipaddress.IPv6Network:
        if not isinstance(raw_cidr, str) or "%" in raw_cidr:
            raise TypeError("policy CIDR must be a string")
        address_value, separator, prefix_value = raw_cidr.partition("/")
        if not separator:
            raise ValueError("policy CIDR must include a prefix length")
        original_address = ipaddress.ip_address(address_value)
        network = ipaddress.ip_network(raw_cidr, strict=False)
        if not isinstance(original_address, ipaddress.IPv6Address) or original_address.ipv4_mapped is None:
            return network
        prefix_length = int(prefix_value)
        if prefix_length < 96:
            raise ValueError("IPv4-mapped IPv6 policy prefixes must be at least /96")
        return ipaddress.IPv4Network((original_address.ipv4_mapped, prefix_length - 96), strict=False)

    def _enrich_groups(
        self,
        groups: Sequence[NetworkAccessGroup],
        workspace_id: str,
    ) -> tuple[NetworkAccessGroup, ...]:
        """Attach tenant-scoped App display metadata to immutable policies."""
        app_ids = {app_id for group in groups for app_id in group.app_ids}
        if not app_ids:
            return tuple(replace(group, apps=()) for group in groups)

        try:
            app_records = self._apps.list_apps(workspace_id=workspace_id, app_ids=tuple(app_ids))
        except NetworkAccessGroupAppQueryError:
            logger.exception(
                "Failed to enrich network access group App references",
                extra={"workspace_id": workspace_id},
            )
            return tuple(replace(group, apps=()) for group in groups)

        apps_by_id = {app.id: app for app in app_records}
        return tuple(
            replace(group, apps=tuple(apps_by_id[app_id] for app_id in group.app_ids if app_id in apps_by_id))
            for group in groups
        )
