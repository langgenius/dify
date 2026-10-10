"""Resolve builtin credentials with no transaction spanning plugin or cryptographic I/O."""

import time
from collections.abc import Mapping
from typing import Any

from configs import dify_config
from core.entities import PluginCredentialType
from core.helper.credential_utils import runtime_check_credential_policy_compliance
from core.helper.provider_cache import NoOpProviderCredentialCache, ToolProviderCredentialsCache
from core.plugin.entities.plugin_daemon import CredentialType
from core.plugin.impl.oauth import OAuthHandler
from core.plugin.plugin_service import PluginService
from core.tools.builtin_tool.provider import BuiltinToolProviderController
from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.plugin_tool.provider import PluginToolProviderController
from core.tools.utils.encryption import create_provider_encrypter
from core.tools.utils.system_encryption import decrypt_system_params
from core.tools.utils.uuid_utils import is_valid_uuid
from models.provider_ids import ToolProviderID
from services.tools.provider_queries import ToolProviders


def resolve_oauth_client(
    *,
    providers: ToolProviders,
    controller: BuiltinToolProviderController,
    tenant_id: str,
    provider_id: str,
) -> Mapping[str, Any] | None:
    provider = ToolProviderID(provider_id)
    config = providers.oauth_client(
        tenant_id=tenant_id,
        plugin_id=provider.plugin_id,
        provider=provider.provider_name,
    )
    if config.tenant_params is not None:
        encrypter, _ = create_provider_encrypter(
            tenant_id=tenant_id,
            config=[field.to_basic_provider_config() for field in controller.get_oauth_client_schema()],
            cache=NoOpProviderCredentialCache(),
        )
        return encrypter.decrypt(config.tenant_params)
    if config.system_params is None:
        return None
    if isinstance(controller, PluginToolProviderController) and not PluginService.is_plugin_verified(
        tenant_id,
        controller.plugin_unique_identifier,
    ):
        return None
    return decrypt_system_params(config.system_params)


def resolve_builtin_credentials(
    *,
    providers: ToolProviders,
    controller: BuiltinToolProviderController,
    tenant_id: str,
    provider_id: str,
    credential_id: str | None,
) -> tuple[dict[str, Any], CredentialType]:
    names = [provider_id]
    if isinstance(controller, PluginToolProviderController):
        provider = ToolProviderID(provider_id)
        names = [str(provider), provider.provider_name]
    selected_id = credential_id if is_valid_uuid(credential_id) else None
    record = providers.builtin_credential(tenant_id=tenant_id, provider_names=names, credential_id=selected_id)
    if record is None:
        if selected_id:
            raise ToolProviderCredentialValidationError(
                f"Tool credential {credential_id} has been deleted. Select or authorize another credential."
            )
        raise ToolProviderCredentialValidationError(
            f"No credential is configured for tool provider {provider_id}. "
            "Authorize the provider or select a credential."
        )
    runtime_check_credential_policy_compliance(
        credential_id=record.id,
        provider=provider_id,
        credential_type=PluginCredentialType.TOOL,
        check_existence=False,
    )
    encrypter, cache = create_provider_encrypter(
        tenant_id=tenant_id,
        config=[
            field.to_basic_provider_config()
            for field in controller.get_credentials_schema_by_type(record.credential_type)
        ],
        cache=ToolProviderCredentialsCache(tenant_id=tenant_id, provider=provider_id, credential_id=record.id),
    )
    credentials = dict(encrypter.decrypt(record.credentials))
    if record.expires_at == -1 or record.expires_at - 60 >= int(time.time()):
        return credentials, record.credential_type

    provider = ToolProviderID(provider_id)
    system = resolve_oauth_client(
        providers=providers, controller=controller, tenant_id=tenant_id, provider_id=provider_id
    )
    try:
        refreshed = OAuthHandler().refresh_credentials(
            tenant_id=tenant_id,
            user_id=record.user_id,
            plugin_id=provider.plugin_id,
            provider=provider.provider_name,
            redirect_uri=f"{dify_config.CONSOLE_API_URL}/console/api/oauth/plugin/{provider_id}/tool/callback",
            system_credentials=system or {},
            credentials=credentials,
        )
    except Exception as exc:
        raise ToolProviderCredentialValidationError(
            f"OAuth credential for tool provider {provider_id} could not be refreshed. "
            "Reauthorize or select another credential."
        ) from exc
    encrypted = encrypter.encrypt(refreshed.credentials)
    saved = providers.refresh_builtin_credential(record=record, credentials=encrypted, expires_at=refreshed.expires_at)
    cache.delete()
    if not saved:
        # Do not invoke with a stale token, or retry a consumed refresh token.
        raise ToolProviderCredentialValidationError("Tool credential changed while refreshing. Retry the invocation.")
    return dict(refreshed.credentials), record.credential_type
