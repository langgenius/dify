"""Provider policy, encryption and OAuth adapters for runtime tool credentials."""

import json
import logging
from collections.abc import Mapping

from core.entities import PluginCredentialType
from core.helper.credential_utils import runtime_check_credential_policy_compliance
from core.helper.provider_cache import NoOpProviderCredentialCache, ToolProviderCredentialsCache
from core.plugin.entities.plugin_daemon import CredentialType
from core.plugin.impl.oauth import OAuthHandler
from core.tools.builtin_tool.provider import BuiltinToolProviderController
from core.tools.plugin_tool.provider import PluginToolProviderController
from core.tools.utils.encryption import ProviderConfigEncrypter, create_provider_encrypter
from models.provider_ids import ToolProviderID
from services.credentials.tool_runtime import RefreshedToolCredential, ToolCredentialRefreshError, ToolRuntimeCredential
from services.tools.builtin_tools_manage_service import BuiltinToolManageService

logger = logging.getLogger(__name__)


class ProviderToolCredentialRuntime:
    def __init__(self, *, controller: BuiltinToolProviderController, provider_id: str, console_api_url: str) -> None:
        self._controller = controller
        self._provider_id = provider_id
        self._console_api_url = console_api_url

    def check_policy(self, record: ToolRuntimeCredential) -> None:
        runtime_check_credential_policy_compliance(
            credential_id=record.id,
            provider=self._provider_id,
            credential_type=PluginCredentialType.TOOL,
            check_existence=False,
        )

    def _cache(self, record: ToolRuntimeCredential) -> ToolProviderCredentialsCache:
        return ToolProviderCredentialsCache(
            tenant_id=record.workspace_id, provider=self._provider_id, credential_id=record.id
        )

    def _encrypter(self, record: ToolRuntimeCredential) -> ProviderConfigEncrypter:
        encrypter, _ = create_provider_encrypter(
            tenant_id=record.workspace_id,
            config=[
                item.to_basic_provider_config()
                for item in self._controller.get_credentials_schema_by_type(CredentialType(record.credential_type))
            ],
            # OAuth reads must not populate or reuse a cache from an older database snapshot.
            cache=NoOpProviderCredentialCache() if record.credential_type == "oauth2" else self._cache(record),
        )
        return encrypter

    def decrypt(self, record: ToolRuntimeCredential) -> dict[str, object]:
        return dict(self._encrypter(record).decrypt(json.loads(record.encrypted_credentials or "{}")))

    def encrypt(self, record: ToolRuntimeCredential, credentials: Mapping[str, object]) -> str:
        return json.dumps(self._encrypter(record).encrypt(credentials))

    def invalidate(self, record: ToolRuntimeCredential) -> None:
        self._cache(record).delete()

    def refresh(self, record: ToolRuntimeCredential, credentials: Mapping[str, object]) -> RefreshedToolCredential:
        provider = ToolProviderID(self._provider_id)
        controller = self._controller if isinstance(self._controller, PluginToolProviderController) else None
        client = BuiltinToolManageService.get_oauth_client(
            record.workspace_id, self._provider_id, provider_controller=controller
        )
        identifier = (
            client.plugin_unique_identifier if client else (controller.plugin_unique_identifier if controller else None)
        )
        try:
            refreshed = OAuthHandler().refresh_credentials(
                tenant_id=record.workspace_id,
                user_id=record.owner_id,
                plugin_id=provider.plugin_id,
                provider=provider.provider_name,
                redirect_uri=f"{self._console_api_url}/console/api/oauth/plugin/{self._provider_id}/tool/callback",
                system_credentials=dict(client.credentials) if client is not None else {},
                plugin_unique_identifier=identifier,
                credentials=credentials,
            )
        except Exception as exc:
            logger.warning("Failed to refresh OAuth credentials for tool provider %s", self._provider_id, exc_info=True)
            raise ToolCredentialRefreshError(
                f"OAuth credential for tool provider {self._provider_id} could not be refreshed. "
                "Reauthorize or select another credential."
            ) from exc
        return RefreshedToolCredential(refreshed.credentials, refreshed.expires_at)
