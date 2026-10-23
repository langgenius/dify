from collections.abc import Mapping, Sequence
from typing import Any, Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.plugin.entities.parameters import PluginParameterOption
from core.plugin.entities.plugin_daemon import CredentialType
from core.plugin.impl.dynamic_select import DynamicSelectClient
from core.tools.tool_manager import ToolManager
from core.tools.utils.encryption import create_tool_provider_encrypter
from core.trigger.entities.api_entities import TriggerProviderSubscriptionApiEntity
from core.trigger.entities.entities import SubscriptionBuilder
from core.trigger.trigger_manager import TriggerManager
from extensions.ext_database import db
from models.provider_ids import TriggerProviderID
from models.tools import BuiltinToolProvider
from services.trigger.trigger_provider_service import TriggerProviderService
from services.trigger.trigger_subscription_builder_service import TriggerSubscriptionBuilderService


class PluginParameterService:
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
        provider_name = provider if "/" in provider else f"{plugin_id}/{provider}"
        match provider_type:
            case "tool":
                provider_controller = ToolManager.get_plugin_provider(provider_name, tenant_id)
                plugin_unique_identifier = provider_controller.plugin_unique_identifier
                credential_provider = provider_controller.entity.identity.name
                # init tool configuration
                encrypter, _ = create_tool_provider_encrypter(
                    tenant_id=tenant_id,
                    controller=provider_controller,
                )

                # check if credentials are required
                if not provider_controller.need_credentials:
                    credentials = {}
                else:
                    # fetch credentials from db
                    with Session(db.engine) as session:
                        if credential_id:
                            db_record = session.scalar(
                                select(BuiltinToolProvider)
                                .where(
                                    BuiltinToolProvider.tenant_id == tenant_id,
                                    BuiltinToolProvider.provider == credential_provider,
                                    BuiltinToolProvider.id == credential_id,
                                )
                                .limit(1)
                            )
                        else:
                            db_record = session.scalar(
                                select(BuiltinToolProvider)
                                .where(
                                    BuiltinToolProvider.tenant_id == tenant_id,
                                    BuiltinToolProvider.provider == credential_provider,
                                )
                                .order_by(BuiltinToolProvider.is_default.desc(), BuiltinToolProvider.created_at.asc())
                                .limit(1)
                            )

                    if db_record is None:
                        raise ValueError(f"Builtin provider {provider} not found when fetching credentials")

                    credentials = encrypter.decrypt(db_record.credentials)
                    credential_type = db_record.credential_type
            case "trigger":
                subscription: TriggerProviderSubscriptionApiEntity | SubscriptionBuilder | None
                if credential_id:
                    subscription = TriggerSubscriptionBuilderService.get_subscription_builder(
                        tenant_id=tenant_id,
                        user_id=user_id,
                        provider_id=TriggerProviderID(provider_name),
                        subscription_builder_id=credential_id,
                    )
                    if not subscription:
                        trigger_subscription = TriggerProviderService.get_subscription_by_id(
                            tenant_id, credential_id, provider_id=TriggerProviderID(provider_name)
                        )
                        subscription = trigger_subscription.to_api_entity() if trigger_subscription else None
                else:
                    trigger_subscription = TriggerProviderService.get_subscription_by_id(
                        tenant_id, provider_id=TriggerProviderID(provider_name)
                    )
                    subscription = trigger_subscription.to_api_entity() if trigger_subscription else None

                if subscription is None:
                    raise ValueError(f"Subscription {credential_id} not found")

                trigger_controller = TriggerManager.get_trigger_provider(tenant_id, TriggerProviderID(provider_name))
                plugin_unique_identifier = trigger_controller.plugin_unique_identifier
                credentials = subscription.credentials
                credential_type = subscription.credential_type or CredentialType.UNAUTHORIZED

        return (
            DynamicSelectClient()
            .fetch_dynamic_select_options(
                tenant_id,
                user_id,
                plugin_id,
                provider_name,
                action,
                credentials,
                credential_type,
                parameter,
                plugin_unique_identifier=plugin_unique_identifier,
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

        provider_name = provider if "/" in provider else f"{plugin_id}/{provider}"
        # Get original subscription to replace hidden values (with tenant_id check for security)
        original_subscription = TriggerProviderService.get_subscription_by_id(
            tenant_id, credential_id, provider_id=TriggerProviderID(provider_name)
        )
        if not original_subscription:
            raise ValueError(f"Subscription {credential_id} not found")

        provider_controller = TriggerManager.get_trigger_provider(tenant_id, TriggerProviderID(provider_name))

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
                provider_name,
                action,
                resolved_credentials,
                original_subscription.credential_type or CredentialType.UNAUTHORIZED.value,
                parameter,
                plugin_unique_identifier=provider_controller.plugin_unique_identifier,
            )
            .options
        )
