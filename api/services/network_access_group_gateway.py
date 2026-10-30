"""Saas and Billing adapters used by the network access group service."""

from collections.abc import Generator
from contextlib import contextmanager
from typing import override

import httpx

from enums import CloudPlan
from services.billing_client import saas
from services.billing_service import BillingService
from services.entities.network_access_group_entities import (
    NetworkAccessAppConfig,
    NetworkAccessAppStatusSnapshot,
    NetworkAccessBinding,
    NetworkAccessBindingUpdate,
    NetworkAccessGroup,
    NetworkAccessGroupList,
)
from services.errors.billing import BillingError, BillingUpstreamError, BillingUpstreamUnavailableError
from services.network_access_group_service import (
    NetworkAccessGroupControlPlane,
    NetworkAccessGroupEntitlement,
    NetworkAccessGroupEntitlementUnavailableError,
    NetworkAccessGroupInvalidResponseError,
    NetworkAccessGroupUpstreamError,
)


@contextmanager
def _upstream_errors() -> Generator[None]:
    """Map saas failures to the service's errors, keeping the upstream status and Kratos reason."""
    try:
        yield
    except BillingUpstreamError as exc:
        if exc.status_code is not None:
            reason = exc.body.reason if exc.body is not None else None
            raise NetworkAccessGroupUpstreamError(exc.status_code, reason) from exc
        if isinstance(exc, BillingUpstreamUnavailableError):
            raise NetworkAccessGroupUpstreamError(httpx.codes.SERVICE_UNAVAILABLE) from exc
        raise NetworkAccessGroupInvalidResponseError from exc


_MAX_INT64 = 2**63 - 1


def _require(valid: bool) -> None:
    """Reject replies that match the schema but break invariants the service relies on."""
    if not valid:
        raise NetworkAccessGroupInvalidResponseError


def _group(wire: saas.NetworkAccessGroup | None) -> NetworkAccessGroup:
    if wire is None:
        raise NetworkAccessGroupInvalidResponseError
    _require(
        bool(wire.id and wire.tenant_id)
        and 1 <= len(wire.allowed_cidrs) <= 100
        and 1 <= wire.version <= _MAX_INT64
        and 0 <= wire.used_by_count <= _MAX_INT64
        and 0 <= wire.enforcing_count <= _MAX_INT64
        and all(wire.used_by_app_ids)
    )
    return NetworkAccessGroup(
        id=wire.id,
        tenant_id=wire.tenant_id,
        name=wire.name,
        description=wire.description,
        allowed_cidrs=tuple(wire.allowed_cidrs),
        version=wire.version,
        used_by_count=wire.used_by_count,
        enforcing_count=wire.enforcing_count,
        app_ids=tuple(wire.used_by_app_ids),
        updated_by_account_id=wire.updated_by_account_id,
        created_at=wire.created_at,
        updated_at=wire.updated_at,
    )


def _binding(wire: saas.AppNetworkAccessGroupBinding) -> NetworkAccessBinding:
    _require(bool(wire.id and wire.tenant_id and wire.app_id) and 1 <= wire.version <= _MAX_INT64)
    return NetworkAccessBinding(
        id=wire.id,
        tenant_id=wire.tenant_id,
        app_id=wire.app_id,
        enabled=wire.enabled,
        group_id=wire.group_id or None,
        access_points=tuple(wire.access_points),
        version=wire.version,
        updated_by_account_id=wire.updated_by_account_id,
        created_at=wire.created_at,
        updated_at=wire.updated_at,
    )


class NetworkAccessGroupGateway(NetworkAccessGroupControlPlane):
    @override
    def list_groups(self, workspace_id: str, actor_account_id: str) -> NetworkAccessGroupList:
        with _upstream_errors():
            reply = saas.network_access_policy_list_network_access_groups(
                tenant_id=workspace_id, actor_account_id=actor_account_id
            )
        _require(bool(reply.tenant_id))
        return NetworkAccessGroupList(reply.tenant_id, reply.entitled, tuple(_group(group) for group in reply.groups))

    @override
    def create_group(
        self,
        workspace_id: str,
        *,
        name: str,
        description: str,
        allowed_cidrs: list[str],
        actor_account_id: str,
    ) -> NetworkAccessGroup:
        with _upstream_errors():
            reply = saas.network_access_policy_create_network_access_group(
                tenant_id=workspace_id,
                body=saas.CreateNetworkAccessGroupRequest(
                    tenant_id=workspace_id,
                    name=name,
                    description=description,
                    mode="",
                    allowed_cidrs=allowed_cidrs,
                    actor_account_id=actor_account_id,
                ),
            )
        return _group(reply.group)

    @override
    def get_group(self, workspace_id: str, group_id: str, actor_account_id: str) -> NetworkAccessGroup:
        with _upstream_errors():
            reply = saas.network_access_policy_get_network_access_group(
                tenant_id=workspace_id, group_id=group_id, actor_account_id=actor_account_id
            )
        return _group(reply.group)

    @override
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
    ) -> NetworkAccessGroup:
        with _upstream_errors():
            reply = saas.network_access_policy_update_network_access_group(
                tenant_id=workspace_id,
                group_id=group_id,
                body=saas.UpdateNetworkAccessGroupRequest(
                    tenant_id=workspace_id,
                    group_id=group_id,
                    name=name,
                    description=description,
                    mode="",
                    allowed_cidrs=allowed_cidrs,
                    expected_version=expected_version,
                    actor_account_id=actor_account_id,
                ),
            )
        return _group(reply.group)

    @override
    def delete_group(
        self,
        workspace_id: str,
        group_id: str,
        *,
        expected_version: int,
        actor_account_id: str,
    ) -> bool:
        with _upstream_errors():
            reply = saas.network_access_policy_delete_network_access_group(
                tenant_id=workspace_id,
                group_id=group_id,
                expected_version=str(expected_version),
                actor_account_id=actor_account_id,
            )
        return reply.deleted

    @override
    def get_app_binding(self, workspace_id: str, app_id: str, actor_account_id: str) -> NetworkAccessAppConfig:
        with _upstream_errors():
            reply = saas.network_access_policy_get_app_network_access_group(
                tenant_id=workspace_id, app_id=app_id, actor_account_id=actor_account_id
            )
        _require(bool(reply.tenant_id and reply.app_id))
        return NetworkAccessAppConfig(
            reply.tenant_id,
            reply.app_id,
            reply.entitled,
            reply.effective_enabled,
            _binding(reply.binding) if reply.binding is not None else None,
        )

    @override
    def get_app_status(self, workspace_id: str, app_id: str, actor_account_id: str) -> NetworkAccessAppStatusSnapshot:
        with _upstream_errors():
            reply = saas.network_access_policy_get_app_network_access_group_status(
                tenant_id=workspace_id, app_id=app_id, actor_account_id=actor_account_id
            )
        return NetworkAccessAppStatusSnapshot(
            reply.entitled, reply.configured, reply.enabled, tuple(reply.access_points)
        )

    @override
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
    ) -> NetworkAccessBindingUpdate:
        with _upstream_errors():
            reply = saas.network_access_policy_put_app_network_access_group(
                tenant_id=workspace_id,
                app_id=app_id,
                body=saas.PutAppNetworkAccessGroupRequest(
                    tenant_id=workspace_id,
                    app_id=app_id,
                    group_id=group_id,
                    expected_version=expected_version,
                    actor_account_id=actor_account_id,
                    enabled=enabled,
                    access_points=access_points,
                ),
            )
        if reply.binding is None:
            raise NetworkAccessGroupInvalidResponseError
        return NetworkAccessBindingUpdate(_binding(reply.binding), reply.effective_enabled)

    @override
    def cleanup_app_binding(self, workspace_id: str, app_id: str) -> bool:
        with _upstream_errors():
            reply = saas.network_access_policy_cleanup_app_network_access_group_binding(
                tenant_id=workspace_id, app_id=app_id
            )
        return reply.deleted


class BillingNetworkAccessGroupEntitlementGateway(NetworkAccessGroupEntitlement):
    @override
    def is_paid_plan(self, workspace_id: str) -> bool:
        try:
            subscription = BillingService.get_info(workspace_id, exclude_vector_space=True).subscription
        except BillingError as exc:
            raise NetworkAccessGroupEntitlementUnavailableError from exc
        return subscription.plan in (CloudPlan.PROFESSIONAL, CloudPlan.TEAM)
