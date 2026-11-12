"""Workspace permissions and encryption for the External Agent control plane."""

import hmac

from core.helper.encrypter import batch_decrypt_token, encrypt_token
from machinery.context import RequestContext
from repositories.workspace.workspace_repository import WorkspaceRepository
from services.enterprise import rbac_service as enterprise
from services.rbac.members import MemberService


class WorkspaceExternalSecretCodec:
    def encrypt(self, tenant_id: str, plaintext: str) -> str:
        return encrypt_token(tenant_id, plaintext)

    def decrypt(self, tenant_id: str, ciphertext: str) -> str:
        return batch_decrypt_token(tenant_id, [ciphertext])[0]

    def matches(self, tenant_id: str, ciphertext: str, plaintext: str) -> bool:
        return hmac.compare_digest(self.decrypt(tenant_id, ciphertext), plaintext)


class WorkspaceExternalAssetAccess:
    def __init__(self, *, workspaces: WorkspaceRepository, permissions: MemberService, rbac_enabled: bool) -> None:
        self._workspaces = workspaces
        self._permissions = permissions
        self._rbac_enabled = rbac_enabled

    def role(self, context: RequestContext) -> str | None:
        return self._workspaces.get_account_role(account_id=context.account_id, tenant_id=context.active_workspace_id)

    def visible_agent_ids(self, context: RequestContext) -> frozenset[str] | None:
        if not self._rbac_enabled:
            return None
        permissions = self._permissions.permissions(context.active_workspace_id, context.account_id)
        scope = enterprise.RBACService.AgentAccess.whitelist_resources(context.active_workspace_id, context.account_id)
        preview = "agent.acl.preview"
        has_default = (
            preview in permissions.agent.default_permission_keys or preview in permissions.workspace.permission_keys
        )
        permitted = (
            None
            if has_default
            else frozenset(item.resource_id for item in permissions.agent.overrides if preview in item.permission_keys)
        )
        # Preserve the same effective whitelist semantics as the Agent roster.
        return permitted if scope.unrestricted else frozenset(scope.resource_ids)
