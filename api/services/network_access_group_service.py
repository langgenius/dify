"""Application service for workspace network access groups."""

import logging
from collections.abc import Sequence
from typing import Any, Literal, NamedTuple, Protocol

from machinery.context import RequestContext

logger = logging.getLogger(__name__)

NetworkAccessPoint = Literal["webapp", "service_api", "mcp", "trigger"]

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
    """The actor is not a persisted owner or administrator of the workspace."""


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


class NetworkAccessGroupAppQueryError(Exception):
    """The local App read model could not be queried."""


class NetworkAccessGroupAppRecord(NamedTuple):
    id: str
    mode: str
    name: str
    icon: str | None
    icon_type: str | None
    icon_background: str | None


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
        self._ensure_workspace_admin_or_owner(context)
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
        self._ensure_workspace_admin_or_owner(context)
        payload = self._control_plane.create_group(
            context.active_workspace_id,
            name=name,
            description=description,
            allowed_cidrs=allowed_cidrs,
            actor_account_id=context.account_id,
        )
        return self._enrich_app_references(payload, context.active_workspace_id)

    def get_group(self, context: RequestContext, *, group_id: str) -> dict[str, Any]:
        self._ensure_workspace_admin_or_owner(context)
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
        self._ensure_workspace_admin_or_owner(context)
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
        self._ensure_workspace_admin_or_owner(context)
        return self._control_plane.delete_group(
            context.active_workspace_id,
            group_id,
            expected_version=expected_version,
            actor_account_id=context.account_id,
        )

    def get_app_binding(self, context: RequestContext, *, app_id: str) -> dict[str, Any]:
        app = self._get_manageable_app(context.active_workspace_id, app_id)
        self._ensure_workspace_admin_or_owner(context)
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
        app = self._get_manageable_app(context.active_workspace_id, app_id)
        self._ensure_workspace_admin_or_owner(context)
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
        return payload

    def cleanup_app_binding(self, *, workspace_id: str, app_id: str) -> dict[str, Any]:
        return self._control_plane.cleanup_app_binding(workspace_id, app_id)

    def _ensure_workspace_admin_or_owner(self, context: RequestContext) -> None:
        role = self._memberships.get_role_for_account(
            workspace_id=context.active_workspace_id,
            account_id=context.account_id,
        )
        if role not in {"owner", "admin"}:
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
            }
            for app in app_records
        }
        for group in groups:
            group_app_ids = group["app_ids"] if isinstance(group["app_ids"], list) else []
            group["apps"] = [apps_by_id[str(app_id)] for app_id in group_app_ids if str(app_id) in apps_by_id]
        return payload
