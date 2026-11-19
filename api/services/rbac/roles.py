"""Workspace role administration and built-in role projection."""

from machinery.context import RequestContext
from services.rbac.builtin import builtin_workspace_roles
from services.rbac.contracts import (
    ListOption,
    MembersInRole,
    Paginated,
    PermissionCatalogResponse,
    RBACRole,
    RoleMutation,
)
from services.rbac.ports import CatalogGateway, RBACSettings, RolesGateway


class RoleService:
    def __init__(self, *, roles: RolesGateway, catalog: CatalogGateway, settings: RBACSettings) -> None:
        self._roles = roles
        self._catalog = catalog
        self._settings = settings

    def catalog(self, context: RequestContext, *, language: str | None) -> PermissionCatalogResponse:
        return self._catalog.workspace(context.active_workspace_id, context.account_id, language=language)

    def list(
        self, context: RequestContext, *, options: ListOption, include_owner: int, language: str | None
    ) -> Paginated[RBACRole]:
        if not self._settings.enabled:
            return builtin_workspace_roles(
                options,
                include_owner=include_owner,
                dataset_operator_enabled=self._settings.dataset_operator_enabled,
            )
        return self._roles.list(
            context.active_workspace_id,
            context.account_id,
            options=options,
            include_owner=include_owner,
            biiling_enabled=self._settings.billing_enabled,
            language=language,
        )

    def get(self, context: RequestContext, role_id: str, *, language: str | None) -> RBACRole:
        return self._roles.get(
            context.active_workspace_id,
            context.account_id,
            role_id,
            billing_enabled=self._settings.billing_enabled,
            language=language,
        )

    def create(self, context: RequestContext, payload: RoleMutation, *, language: str | None) -> RBACRole:
        return self._roles.create(context.active_workspace_id, context.account_id, payload, language=language)

    def update(self, context: RequestContext, role_id: str, payload: RoleMutation, *, language: str | None) -> RBACRole:
        return self._roles.update(context.active_workspace_id, context.account_id, role_id, payload, language=language)

    def delete(self, context: RequestContext, role_id: str, *, language: str | None) -> None:
        return self._roles.delete(context.active_workspace_id, context.account_id, role_id, language=language)

    def copy(self, context: RequestContext, role_id: str, copy_member: bool, *, language: str | None) -> RBACRole:
        return self._roles.copy(
            context.active_workspace_id, context.account_id, role_id, copy_member, language=language
        )

    def list_members_by_role(
        self,
        context: RequestContext,
        role_id: str,
        *,
        options: ListOption,
        language: str | None,
    ) -> Paginated[MembersInRole]:
        return self._roles.list_members_by_role(
            context.active_workspace_id, role_id, options=options, language=language
        )
