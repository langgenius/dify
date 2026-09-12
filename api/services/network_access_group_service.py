"""Application service for workspace network access groups."""

import ipaddress
import logging
from collections.abc import Callable, Sequence
from typing import Any, Literal, NamedTuple, Protocol

from machinery.context import RequestContext

logger = logging.getLogger(__name__)

NetworkAccessPoint = Literal["webapp", "service_api", "mcp", "trigger"]

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


class NetworkAccessGroupAppQueryError(Exception):
    """The local App read model could not be queried."""


class NetworkAccessGroupAppRecord(NamedTuple):
    id: str
    mode: str
    name: str
    icon: str | None
    icon_type: str | None
    icon_background: str | None
    bound_agent_id: str | None = None


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
    def list_groups(self, workspace_id: str, actor_account_id: str) -> dict[str, Any]: ...

    def create_group(
        self,
        workspace_id: str,
        *,
        name: str,
        description: str,
        allowed_cidrs: list[str],
        actor_account_id: str,
    ) -> dict[str, Any]: ...

    def get_group(self, workspace_id: str, group_id: str, actor_account_id: str) -> dict[str, Any]: ...

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
    ) -> dict[str, Any]: ...

    def delete_group(
        self,
        workspace_id: str,
        group_id: str,
        *,
        expected_version: int,
        actor_account_id: str,
    ) -> dict[str, Any]: ...

    def get_app_binding(self, workspace_id: str, app_id: str, actor_account_id: str) -> dict[str, Any]: ...

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
    ) -> dict[str, Any]: ...

    def cleanup_app_binding(self, workspace_id: str, app_id: str) -> dict[str, Any]: ...


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

    def list_groups(self, context: RequestContext) -> dict[str, Any]:
        self._ensure_workspace_role(context, _POLICY_READ_ROLES)
        payload = self._control_plane.list_groups(context.active_workspace_id, context.account_id)
        payload["entitled"] = self._effective_entitlement(
            context.active_workspace_id,
            payload.get("entitled"),
        )
        return self._enrich_app_references(payload, context.active_workspace_id)

    def create_group(
        self,
        context: RequestContext,
        *,
        name: str,
        description: str,
        allowed_cidrs: list[str],
    ) -> dict[str, Any]:
        self._ensure_workspace_role(context, _POLICY_WRITE_ROLES)
        payload = self._control_plane.create_group(
            context.active_workspace_id,
            name=name,
            description=description,
            allowed_cidrs=allowed_cidrs,
            actor_account_id=context.account_id,
        )
        return self._enrich_app_references(payload, context.active_workspace_id)

    def get_group(self, context: RequestContext, *, group_id: str) -> dict[str, Any]:
        self._ensure_workspace_role(context, _POLICY_READ_ROLES)
        payload = self._control_plane.get_group(
            context.active_workspace_id,
            group_id,
            context.account_id,
        )
        return self._enrich_app_references(payload, context.active_workspace_id)

    def update_group(
        self,
        context: RequestContext,
        *,
        group_id: str,
        name: str,
        description: str,
        allowed_cidrs: list[str],
        expected_version: int,
    ) -> dict[str, Any]:
        self._ensure_workspace_role(context, _POLICY_WRITE_ROLES)
        payload = self._control_plane.update_group(
            context.active_workspace_id,
            group_id,
            name=name,
            description=description,
            allowed_cidrs=allowed_cidrs,
            expected_version=expected_version,
            actor_account_id=context.account_id,
        )
        return self._enrich_app_references(payload, context.active_workspace_id)

    def delete_group(
        self,
        context: RequestContext,
        *,
        group_id: str,
        expected_version: int,
    ) -> dict[str, Any]:
        self._ensure_workspace_role(context, _POLICY_WRITE_ROLES)
        return self._control_plane.delete_group(
            context.active_workspace_id,
            group_id,
            expected_version=expected_version,
            actor_account_id=context.account_id,
        )

    def get_app_binding(self, context: RequestContext, *, app_id: str) -> dict[str, Any]:
        self._ensure_workspace_role(context, _APP_BINDING_ROLES)
        app = self._get_manageable_app(context.active_workspace_id, app_id)
        available_access_points = self._available_access_points(app.mode)
        payload = self._control_plane.get_app_binding(
            context.active_workspace_id,
            app.id,
            context.account_id,
        )
        self._normalize_app_binding_defaults(payload)
        self._limit_binding_access_points(payload, available_access_points)
        payload["entitled"] = self._effective_entitlement(
            context.active_workspace_id,
            payload.get("entitled"),
        )
        payload["available_access_points"] = available_access_points
        self._finalize_effective_enabled(payload, entitled=payload["entitled"])
        return payload

    def update_app_binding(
        self,
        context: RequestContext,
        *,
        app_id: str,
        enabled: bool,
        group_id: str | None,
        access_points: list[NetworkAccessPoint],
        expected_version: int,
    ) -> dict[str, Any]:
        self._ensure_workspace_role(context, _APP_BINDING_ROLES)
        app = self._get_manageable_app(context.active_workspace_id, app_id)
        available_access_points = self._available_access_points(app.mode)
        self._validate_app_access_points(access_points, available_access_points)
        payload = self._control_plane.update_app_binding(
            context.active_workspace_id,
            app.id,
            enabled=enabled,
            group_id=group_id,
            access_points=list(access_points),
            expected_version=expected_version,
            actor_account_id=context.account_id,
        )
        self._normalize_app_binding_defaults(payload)
        self._limit_binding_access_points(payload, available_access_points)
        payload["available_access_points"] = available_access_points
        self._finalize_effective_enabled(payload)
        return payload

    def check_current_ip(
        self,
        context: RequestContext,
        *,
        group_id: str,
        client_ip_supplier: Callable[[], str],
    ) -> dict[str, Any]:
        """Evaluate the request's trusted client IP against one tenant policy.

        The supplier is deliberately lazy: persisted workspace authorization and
        tenant-scoped policy resolution both complete before request IP metadata
        is read or returned.
        """

        self._ensure_workspace_role(context, _POLICY_READ_ROLES)
        payload = self._control_plane.get_group(
            context.active_workspace_id,
            group_id,
            context.account_id,
        )
        group = payload.get("group")
        if not isinstance(group, dict):
            raise NetworkAccessGroupInvalidPolicyError

        raw_cidrs = group.get("allowed_cidrs", group.get("allowedCidrs"))
        raw_version = group.get("version")
        if not isinstance(raw_cidrs, list):
            raise NetworkAccessGroupInvalidPolicyError
        if isinstance(raw_version, bool) or not isinstance(raw_version, (int, str)):
            raise NetworkAccessGroupInvalidPolicyError
        try:
            policy_version = int(raw_version)
        except (TypeError, ValueError) as exc:
            raise NetworkAccessGroupInvalidPolicyError from exc
        if policy_version < 1:
            raise NetworkAccessGroupInvalidPolicyError

        client_ip = client_ip_supplier()
        allowed = self._policy_allows_client_ip(raw_cidrs, client_ip)
        return {
            "client_ip": client_ip,
            "allowed": allowed,
            "policy_version": policy_version,
        }

    def cleanup_app_binding(self, *, workspace_id: str, app_id: str) -> dict[str, Any]:
        return self._control_plane.cleanup_app_binding(workspace_id, app_id)

    def _ensure_workspace_role(self, context: RequestContext, allowed_roles: frozenset[str]) -> None:
        role = self._memberships.get_role_for_account(
            workspace_id=context.active_workspace_id,
            account_id=context.account_id,
        )
        if role not in allowed_roles:
            raise NetworkAccessGroupAccessDeniedError

    def _effective_entitlement(self, workspace_id: str, upstream_entitled: object) -> bool:
        return bool(upstream_entitled) and self._entitlement.is_paid_plan(workspace_id)

    def _get_manageable_app(self, workspace_id: str, app_id: str) -> NetworkAccessGroupAppRecord:
        app = self._apps.get_manageable_app(workspace_id=workspace_id, app_id=app_id)
        if app is None:
            raise NetworkAccessGroupAppNotFoundError
        return app

    @staticmethod
    def _available_access_points(app_mode: str) -> list[NetworkAccessPoint]:
        available = _ACCESS_POINTS_BY_APP_MODE.get(app_mode)
        if available is None:
            raise NetworkAccessGroupUnsupportedAppModeError(app_mode)
        return list(available)

    @staticmethod
    def _validate_app_access_points(
        requested: Sequence[NetworkAccessPoint],
        available: Sequence[NetworkAccessPoint],
    ) -> None:
        unsupported = sorted(set(requested).difference(available))
        if unsupported:
            raise NetworkAccessGroupUnsupportedAccessPointsError(unsupported)

    @staticmethod
    def _normalize_app_binding_defaults(payload: dict[str, Any]) -> None:
        """Materialize ProtoJSON defaults so the Console response stays stable."""

        if "effective_enabled" not in payload:
            payload["effective_enabled"] = payload.pop("effectiveEnabled", False)
        else:
            payload.pop("effectiveEnabled", None)
        payload.setdefault("binding", None)
        binding = payload.get("binding")
        if not isinstance(binding, dict):
            return
        binding.setdefault("enabled", False)
        if "access_points" not in binding and "accessPoints" not in binding:
            binding["access_points"] = []

    @staticmethod
    def _limit_binding_access_points(
        payload: dict[str, Any],
        available: Sequence[NetworkAccessPoint],
    ) -> None:
        """Hide stale scopes which are not real access points for the current App mode."""

        binding = payload.get("binding")
        if not isinstance(binding, dict):
            return
        raw_access_points = binding.get("access_points", binding.get("accessPoints", []))
        if not isinstance(raw_access_points, list):
            return
        binding["access_points"] = [access_point for access_point in raw_access_points if access_point in available]
        binding.pop("accessPoints", None)

    @staticmethod
    def _finalize_effective_enabled(payload: dict[str, Any], *, entitled: object = True) -> None:
        binding = payload.get("binding")
        if not isinstance(binding, dict):
            payload["effective_enabled"] = False
            return
        group_id = binding.get("group_id", binding.get("groupId"))
        access_points = binding.get("access_points", binding.get("accessPoints", []))
        payload["effective_enabled"] = bool(
            payload.get("effective_enabled")
            and entitled
            and binding.get("enabled")
            and group_id
            and isinstance(access_points, list)
            and access_points
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

    def _enrich_app_references(self, payload: dict[str, Any], workspace_id: str) -> dict[str, Any]:
        """Attach tenant-scoped App display metadata to one or more group payloads."""

        raw_groups: list[object] = []
        if isinstance(payload.get("group"), dict):
            raw_groups.append(payload["group"])
        if isinstance(payload.get("groups"), list):
            raw_groups.extend(payload["groups"])

        groups = [group for group in raw_groups if isinstance(group, dict)]
        for group in groups:
            raw_app_ids = (
                group.get("used_by_app_ids")
                or group.get("usedByAppIds")
                or group.get("app_ids")
                or group.get("appIds")
                or []
            )
            group["app_ids"] = list(raw_app_ids) if isinstance(raw_app_ids, list) else raw_app_ids
            raw_count = group.get("used_by_count")
            if raw_count is None:
                raw_count = group.get("usedByCount")
            if raw_count is None:
                raw_count = len(raw_app_ids) if isinstance(raw_app_ids, list) else 0
            group["used_by_count"] = raw_count
            raw_enforcing_count = group.get("enforcing_count")
            if raw_enforcing_count is None:
                raw_enforcing_count = group.get("enforcingCount")
            group["enforcing_count"] = (
                0 if payload.get("entitled") is False or raw_enforcing_count is None else raw_enforcing_count
            )
            group.pop("enforcingCount", None)

        app_ids = {
            str(app_id)
            for group in groups
            if isinstance(group["app_ids"], list)
            for app_id in group["app_ids"]
            if app_id
        }
        if not app_ids:
            for group in groups:
                group["apps"] = []
            return payload

        try:
            app_records = self._apps.list_apps(workspace_id=workspace_id, app_ids=tuple(app_ids))
        except NetworkAccessGroupAppQueryError:
            logger.exception(
                "Failed to enrich network access group App references",
                extra={"workspace_id": workspace_id},
            )
            for group in groups:
                group["apps"] = []
            return payload

        apps_by_id = {
            app.id: {
                "id": app.id,
                "name": app.name,
                "icon": app.icon,
                "icon_type": app.icon_type,
                "icon_background": app.icon_background,
                "mode": app.mode,
                "bound_agent_id": app.bound_agent_id,
            }
            for app in app_records
        }
        for group in groups:
            group_app_ids = group["app_ids"] if isinstance(group["app_ids"], list) else []
            group["apps"] = [apps_by_id[str(app_id)] for app_id in group_app_ids if str(app_id) in apps_by_id]
        return payload
