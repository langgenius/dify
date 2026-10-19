"""Resource access use cases shared by apps, datasets and agents."""

from collections.abc import Sequence

from machinery.context import RequestContext
from services.rbac import contracts as dto
from services.rbac.ports import AccessInitializer, RBACMembers, ResourceAccessClients, ResourceMaintainers


class ResourceAccessService:
    def __init__(
        self,
        *,
        clients: ResourceAccessClients,
        members: RBACMembers,
        apps: ResourceMaintainers,
        datasets: ResourceMaintainers,
        initializer: AccessInitializer,
    ) -> None:
        self._clients = clients
        self._members = members
        self._apps = apps
        self._datasets = datasets
        self._initializer = initializer

    def catalog(
        self, context: RequestContext, kind: dto.RBACResourceType, *, language: str | None
    ) -> dto.PermissionCatalogResponse:
        return self._clients.catalog(kind, context.active_workspace_id, context.account_id, language=language)

    def matrix(
        self, context: RequestContext, kind: dto.RBACResourceType, resource_id: str, *, language: str | None
    ) -> dto.AppAccessMatrix | dto.DatasetAccessMatrix | dto.AgentAccessMatrix:
        result = self._clients.resource(kind).matrix(
            context.active_workspace_id, context.account_id, resource_id, language=language
        )
        self._hydrate_accounts(context, [account for item in result.items for account in item.accounts])
        return result

    def whitelist(
        self, context: RequestContext, kind: dto.RBACResourceType, resource_id: str, *, language: str | None
    ) -> dto.ResourceWhitelist:
        return self._clients.resource(kind).whitelist(
            context.active_workspace_id, context.account_id, resource_id, language=language
        )

    def replace_whitelist(
        self,
        context: RequestContext,
        kind: dto.RBACResourceType,
        resource_id: str,
        payload: dto.ReplaceMemberBindings,
        *,
        language: str | None,
    ) -> dto.ResourceWhitelist:
        result = self._clients.resource(kind).replace_whitelist(
            context.active_workspace_id, context.account_id, resource_id, payload, language=language
        )
        if payload.automatic_include_workspace_members:
            self._initializer.initialize(context.active_workspace_id, context.account_id, kind, resource_id)
        return result

    def whitelist_config(
        self, context: RequestContext, kind: dto.RBACResourceType, resource_id: str, *, language: str | None
    ) -> dto.ResourceWhitelistConfig:
        return self._clients.resource(kind).whitelist_config(
            context.active_workspace_id, context.account_id, resource_id, language=language
        )

    def user_access_policies(
        self,
        context: RequestContext,
        kind: dto.RBACResourceType,
        resource_id: str,
        *,
        options: dto.ListOption,
        language: str | None,
    ) -> dto.ResourceUserAccessPoliciesResponse:
        result = self._clients.resource(kind).user_access_policies(
            context.active_workspace_id, context.account_id, resource_id, options=options, language=language
        )
        maintainer_id = None
        if kind == dto.RBACResourceType.APP:
            maintainer_id = self._apps.get_maintainer_id(context.active_workspace_id, resource_id)
        elif kind == dto.RBACResourceType.DATASET:
            maintainer_id = self._datasets.get_maintainer_id(context.active_workspace_id, resource_id)
        if maintainer_id and maintainer_id.strip():
            for index, item in enumerate(result.data):
                if item.account.account_id.strip() == maintainer_id.strip():
                    result.data.insert(0, result.data.pop(index))
                    break
        self._hydrate_accounts(context, [item.account for item in result.data])
        return result

    def replace_user_access_policies(
        self,
        context: RequestContext,
        kind: dto.RBACResourceType,
        resource_id: str,
        target_account_id: str,
        payload: dto.ReplaceUserAccessPolicies,
        *,
        language: str | None,
    ) -> dto.ReplaceUserAccessPoliciesResponse:
        return self._clients.resource(kind).replace_user_access_policies(
            context.active_workspace_id, context.account_id, resource_id, target_account_id, payload, language=language
        )

    def list_role_bindings(
        self,
        context: RequestContext,
        kind: dto.RBACResourceType,
        resource_id: str,
        policy_id: str,
        *,
        language: str | None,
    ) -> dto.RoleBindingsResponse:
        return self._clients.resource(kind).list_role_bindings(
            context.active_workspace_id, context.account_id, resource_id, policy_id, language=language
        )

    def list_member_bindings(
        self,
        context: RequestContext,
        kind: dto.RBACResourceType,
        resource_id: str,
        policy_id: str,
        *,
        language: str | None,
    ) -> dto.MemberBindingsResponse:
        return self._clients.resource(kind).list_member_bindings(
            context.active_workspace_id, context.account_id, resource_id, policy_id, language=language
        )

    def delete_member_bindings(
        self,
        context: RequestContext,
        kind: dto.RBACResourceType,
        resource_id: str,
        policy_id: str,
        payload: dto.DeleteMemberBindings,
        *,
        language: str | None,
    ) -> None:
        self._clients.resource(kind).delete_member_bindings(
            context.active_workspace_id, context.account_id, resource_id, policy_id, payload, language=language
        )

    def workspace_matrix(
        self, context: RequestContext, kind: dto.RBACResourceType, options: dto.ListOption, *, language: str | None
    ) -> dto.WorkspaceAccessMatrix:
        result = self._clients.workspace(kind).matrix(
            context.active_workspace_id, context.account_id, options=options, language=language
        )
        self._hydrate_accounts(context, [account for item in result.items for account in item.accounts])
        return result

    def workspace_role_bindings(
        self, context: RequestContext, kind: dto.RBACResourceType, policy_id: str, *, language: str | None
    ) -> dto.RoleBindingsResponse:
        return self._clients.workspace(kind).list_role_bindings(
            context.active_workspace_id, context.account_id, policy_id, language=language
        )

    def workspace_member_bindings(
        self, context: RequestContext, kind: dto.RBACResourceType, policy_id: str, *, language: str | None
    ) -> dto.MemberBindingsResponse:
        return self._clients.workspace(kind).list_member_bindings(
            context.active_workspace_id, context.account_id, policy_id, language=language
        )

    def replace_workspace_bindings(
        self,
        context: RequestContext,
        kind: dto.RBACResourceType,
        policy_id: str,
        payload: dto.ReplaceBindings,
        *,
        language: str | None,
    ) -> dto.AccessMatrixItem:
        return self._clients.workspace(kind).replace_bindings(
            context.active_workspace_id, context.account_id, policy_id, payload, language=language
        )

    def _hydrate_accounts(
        self, context: RequestContext, accounts: Sequence[dto.AccessPolicyAccount | dto.RBACRoleAccount]
    ) -> None:
        ids = sorted({account.account_id.strip() for account in accounts if account.account_id.strip()})
        if not ids:
            return
        records = {
            member.id: member
            for member in self._members.list_for_workspace(context.active_workspace_id, account_ids=ids)
        }
        for account in accounts:
            if member := records.get(account.account_id.strip()):
                if not account.account_name:
                    account.account_name = member.name
                account.avatar = member.avatar or ""
                account.email = member.email
