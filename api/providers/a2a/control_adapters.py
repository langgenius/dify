"""Workspace permissions and encryption for the External Agent control plane."""

import hmac
from collections.abc import Mapping, Sequence

from core.helper.encrypter import batch_decrypt_token, encrypt_token, obfuscated_token
from libs.helper import build_icon_url
from machinery.context import RequestContext
from repositories.workspace.workspace_repository import WorkspaceRepository
from services.enterprise import rbac_service as enterprise
from services.rbac.members import MemberService


class DifyExternalIconURLs:
    """Use Dify's existing signed-image route for already admitted upload IDs."""

    def image_urls(self, file_ids: Sequence[str]) -> Mapping[str, str]:
        """Generate refreshable capabilities without querying or reading file bytes."""
        urls = {identifier: build_icon_url("image", identifier) for identifier in file_ids}
        return {identifier: url for identifier, url in urls.items() if url is not None}


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


class WorkspaceExternalTracingCipher:
    """Encrypt SDK trace secrets with the same workspace keys as legacy Native tracing."""

    def encrypt(self, tenant_id: str, value: str) -> str:
        """Persist one plaintext secret under the admitted workspace key."""
        return encrypt_token(tenant_id, value)

    def decrypt(self, tenant_id: str, tokens: Sequence[str]) -> list[str]:
        """Decrypt the frozen owner-scoped token sequence without changing its order."""
        return batch_decrypt_token(tenant_id, list(tokens))

    def mask(self, value: str) -> str:
        """Use the existing secret-echo mask while all presentations remain write-only."""
        return obfuscated_token(value)
