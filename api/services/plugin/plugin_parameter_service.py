"""Resolve dynamic parameter credentials before invoking the plugin daemon."""

from collections.abc import Mapping, Sequence
from typing import Any, Literal, Protocol

from constants import HIDDEN_VALUE
from core.plugin.entities.parameters import PluginParameterOption
from core.plugin.entities.plugin_daemon import CredentialType
from core.tools.plugin_tool.provider import PluginToolProviderController
from core.tools.utils.encryption import create_tool_provider_encrypter
from core.trigger.provider import PluginTriggerProviderController
from core.trigger.utils.encryption import create_trigger_provider_encrypter
from models.provider_ids import TriggerProviderID
from services.credentials.query import ToolCredentialSnapshot
from services.trigger.subscription_service import TriggerSubscriptionSnapshot
from services.trigger.trigger_subscription_builder_service import TriggerSubscriptionBuilderQuery


class PluginParameterCredentials(Protocol):
    def get_tool(
        self, *, workspace_id: str, provider: str, credential_id: str | None
    ) -> ToolCredentialSnapshot | None: ...


class PluginParameterSubscriptions(Protocol):
    def get_for_provider(
        self, *, tenant_id: str, provider_id: TriggerProviderID, subscription_id: str | None
    ) -> TriggerSubscriptionSnapshot | None: ...


class PluginParameterGateway(Protocol):
    def get_tool_provider(self, *, tenant_id: str, provider: str) -> PluginToolProviderController: ...

    def get_trigger_provider(
        self, *, tenant_id: str, provider_id: TriggerProviderID
    ) -> PluginTriggerProviderController: ...

    def fetch_options(
        self,
        *,
        tenant_id: str,
        user_id: str,
        plugin_id: str,
        provider: str,
        action: str,
        parameter: str,
        credentials: Mapping[str, Any],
        credential_type: str,
        plugin_unique_identifier: str,
    ) -> Sequence[PluginParameterOption]: ...


class PluginParameterService:
    """Keep plugin and credential I/O outside repository-owned read sessions.

    TODO: The shared RSA key provider still owns a scoped database session;
    remove that dependency when its tenant key reads return detached values.
    """

    def __init__(
        self,
        *,
        credentials: PluginParameterCredentials,
        subscriptions: PluginParameterSubscriptions,
        builders: TriggerSubscriptionBuilderQuery,
        plugins: PluginParameterGateway,
    ) -> None:
        self._credentials = credentials
        self._subscriptions = subscriptions
        self._builders = builders
        self._plugins = plugins

    def get_dynamic_select_options(
        self,
        *,
        tenant_id: str,
        user_id: str,
        plugin_id: str,
        provider: str,
        action: str,
        parameter: str,
        credential_id: str | None,
        provider_type: Literal["tool", "trigger"],
    ) -> Sequence[PluginParameterOption]:
        """Use a selected credential, or the provider's existing default lookup.

        A trigger credential ID may also identify a builder owned by this user.
        Only a missing/expired builder falls back to a persisted subscription.
        """
        provider_name = provider if "/" in provider else f"{plugin_id}/{provider}"
        credentials: Mapping[str, Any] = {}
        credential_type = CredentialType.UNAUTHORIZED.value
        if provider_type == "tool":
            tool = self._plugins.get_tool_provider(tenant_id=tenant_id, provider=provider_name)
            plugin_unique_identifier = tool.plugin_unique_identifier
            if tool.need_credentials:
                record = self._credentials.get_tool(
                    workspace_id=tenant_id, provider=tool.entity.identity.name, credential_id=credential_id
                )
                if record is None:
                    raise ValueError(f"Builtin provider {provider} not found when fetching credentials")
                encrypter, _ = create_tool_provider_encrypter(tenant_id=tenant_id, controller=tool)
                credentials = encrypter.decrypt(record.credentials)
                credential_type = record.credential_type
        else:
            provider_id = TriggerProviderID(provider_name)
            builder = (
                self._builders.get_subscription_builder(
                    tenant_id=tenant_id,
                    user_id=user_id,
                    provider_id=provider_id,
                    subscription_builder_id=credential_id,
                )
                if credential_id
                else None
            )
            subscription = (
                None
                if builder is not None
                else self._require_subscription(
                    tenant_id=tenant_id, provider_id=provider_id, subscription_id=credential_id
                )
            )
            trigger = self._plugins.get_trigger_provider(tenant_id=tenant_id, provider_id=provider_id)
            plugin_unique_identifier = trigger.plugin_unique_identifier
            if builder is not None:
                credentials = builder.credentials
                credential_type = builder.credential_type or CredentialType.UNAUTHORIZED.value
            else:
                assert subscription is not None
                encrypter, _ = create_trigger_provider_encrypter(
                    tenant_id=tenant_id,
                    controller=trigger,
                    credential_id=subscription.id,
                    credential_type=subscription.credential_type,
                )
                credentials = encrypter.decrypt(subscription.credentials)
                credential_type = subscription.credential_type or CredentialType.UNAUTHORIZED.value

        return self._plugins.fetch_options(
            tenant_id=tenant_id,
            user_id=user_id,
            plugin_id=plugin_id,
            provider=provider_name,
            action=action,
            credentials=credentials,
            credential_type=credential_type,
            parameter=parameter,
            plugin_unique_identifier=plugin_unique_identifier,
        )

    def get_dynamic_select_options_with_credentials(
        self,
        *,
        tenant_id: str,
        user_id: str,
        plugin_id: str,
        provider: str,
        action: str,
        parameter: str,
        credential_id: str,
        credentials: Mapping[str, Any],
    ) -> Sequence[PluginParameterOption]:
        """Resolve hidden values from the owned subscription without persisting edits."""
        provider_name = provider if "/" in provider else f"{plugin_id}/{provider}"
        provider_id = TriggerProviderID(provider_name)
        subscription = self._require_subscription(
            tenant_id=tenant_id, provider_id=provider_id, subscription_id=credential_id
        )
        trigger = self._plugins.get_trigger_provider(tenant_id=tenant_id, provider_id=provider_id)
        encrypter, _ = create_trigger_provider_encrypter(
            tenant_id=tenant_id,
            controller=trigger,
            credential_id=subscription.id,
            credential_type=subscription.credential_type,
        )
        original_credentials = encrypter.decrypt(subscription.credentials)
        resolved_credentials = {
            key: original_credentials.get(key) if value == HIDDEN_VALUE else value for key, value in credentials.items()
        }
        return self._plugins.fetch_options(
            tenant_id=tenant_id,
            user_id=user_id,
            plugin_id=plugin_id,
            provider=provider_name,
            action=action,
            credentials=resolved_credentials,
            credential_type=subscription.credential_type or CredentialType.UNAUTHORIZED.value,
            parameter=parameter,
            plugin_unique_identifier=trigger.plugin_unique_identifier,
        )

    def _require_subscription(
        self, *, tenant_id: str, provider_id: TriggerProviderID, subscription_id: str | None
    ) -> TriggerSubscriptionSnapshot:
        subscription = self._subscriptions.get_for_provider(
            tenant_id=tenant_id, provider_id=provider_id, subscription_id=subscription_id
        )
        if subscription is None:
            raise ValueError(f"Subscription {subscription_id} not found")
        return subscription
