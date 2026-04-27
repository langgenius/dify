from collections.abc import Mapping, Sequence
from typing import Any, Literal

from core.plugin.entities.parameters import PluginParameterOption
from core.plugin.entities.plugin_daemon import CredentialType
from core.plugin.impl.dynamic_select import DynamicSelectClient
from core.trigger.entities.api_entities import TriggerProviderSubscriptionApiEntity
from core.trigger.entities.entities import SubscriptionBuilder
from services.trigger.trigger_provider_service import TriggerProviderService
from services.trigger.trigger_subscription_builder_service import TriggerSubscriptionBuilderService
from services.tools.builtin_tools_manage_service import BuiltinToolManageService


class PluginParameterService:
    @staticmethod
    def _load_tool_credentials(
        tenant_id: str,
        provider: str,
        credential_id: str | None,
    ) -> tuple[Mapping[str, Any], str]:
        return BuiltinToolManageService.get_builtin_tool_provider_runtime_credentials(
            tenant_id=tenant_id,
            provider=provider,
            credential_id=credential_id,
        )

    @staticmethod
    def get_dynamic_select_options(
        tenant_id: str,
        user_id: str,
        plugin_id: str,
        provider: str,
        action: str,
        parameter: str,
        credential_id: str | None,
        provider_type: Literal["tool", "trigger"],
    ) -> Sequence[PluginParameterOption]:
        """
        Get dynamic select options for a plugin parameter.

        Args:
            tenant_id: The tenant ID.
            plugin_id: The plugin ID.
            provider: The provider name.
            action: The action name.
            parameter: The parameter name.
        """
        credentials: Mapping[str, Any] = {}
        credential_type: str = CredentialType.UNAUTHORIZED.value
        match provider_type:
            case "tool":
                credentials, credential_type = PluginParameterService._load_tool_credentials(
                    tenant_id=tenant_id,
                    provider=provider,
                    credential_id=credential_id,
                )
            case "trigger":
                subscription: TriggerProviderSubscriptionApiEntity | SubscriptionBuilder | None
                if credential_id:
                    subscription = TriggerSubscriptionBuilderService.get_subscription_builder(credential_id)
                    if not subscription:
                        trigger_subscription = TriggerProviderService.get_subscription_by_id(tenant_id, credential_id)
                        subscription = trigger_subscription.to_api_entity() if trigger_subscription else None
                else:
                    trigger_subscription = TriggerProviderService.get_subscription_by_id(tenant_id)
                    subscription = trigger_subscription.to_api_entity() if trigger_subscription else None

                if subscription is None:
                    raise ValueError(f"Subscription {credential_id} not found")

                credentials = subscription.credentials
                credential_type = subscription.credential_type or CredentialType.UNAUTHORIZED

        return (
            DynamicSelectClient()
            .fetch_dynamic_select_options(
                tenant_id, user_id, plugin_id, provider, action, credentials, credential_type, parameter
            )
            .options
        )

    @staticmethod
    def get_dynamic_tree_select_options(
        tenant_id: str,
        user_id: str,
        plugin_id: str,
        provider: str,
        action: str,
        parameter: str,
        credential_id: str | None,
    ) -> Sequence[PluginParameterOption]:
        """
        Get dynamic tree select options for a plugin parameter.

        This endpoint only supports tool providers.
        """
        credentials, credential_type = PluginParameterService._load_tool_credentials(
            tenant_id=tenant_id,
            provider=provider,
            credential_id=credential_id,
        )

        return (
            DynamicSelectClient()
            .fetch_dynamic_select_options(
                tenant_id, user_id, plugin_id, provider, action, credentials, credential_type, parameter
            )
            .options
        )

    @staticmethod
    def get_dynamic_select_options_with_credentials(
        tenant_id: str,
        user_id: str,
        plugin_id: str,
        provider: str,
        action: str,
        parameter: str,
        credential_id: str,
        credentials: Mapping[str, Any],
    ) -> Sequence[PluginParameterOption]:
        """
        Get dynamic select options using provided credentials directly.
        Used for edit mode when credentials have been modified but not yet saved.

        Security: credential_id is validated against tenant_id to ensure
        users can only access their own credentials.
        """
        from constants import HIDDEN_VALUE

        # Get original subscription to replace hidden values (with tenant_id check for security)
        original_subscription = TriggerProviderService.get_subscription_by_id(tenant_id, credential_id)
        if not original_subscription:
            raise ValueError(f"Subscription {credential_id} not found")

        # Replace [__HIDDEN__] with original values
        resolved_credentials: dict[str, Any] = {
            key: (original_subscription.credentials.get(key) if value == HIDDEN_VALUE else value)
            for key, value in credentials.items()
        }

        return (
            DynamicSelectClient()
            .fetch_dynamic_select_options(
                tenant_id,
                user_id,
                plugin_id,
                provider,
                action,
                resolved_credentials,
                original_subscription.credential_type or CredentialType.UNAUTHORIZED.value,
                parameter,
            )
            .options
        )
