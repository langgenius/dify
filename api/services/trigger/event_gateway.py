"""Adapt plugin event declarations and invocation without exposing provider controllers."""

from collections.abc import Mapping
from typing import Any

from core.plugin.entities.request import TriggerInvokeEventResponse
from core.plugin.impl.trigger import PluginTriggerClient
from core.plugin.utils.http_parser import deserialize_request
from core.trigger.errors import EventIgnoreError
from models.provider_ids import TriggerProviderID
from services.trigger.event_service import PreparedTriggerEvent, TriggerEventDefinition
from services.trigger.provider_loader import PluginTriggerProviderLoader


class PluginTriggerEventGateway:
    def __init__(self, *, providers: PluginTriggerProviderLoader) -> None:
        self._providers = providers

    def describe(self, *, tenant_id: str, provider_id: TriggerProviderID, event_name: str) -> TriggerEventDefinition:
        provider = self._providers.get_trigger_provider(tenant_id=tenant_id, provider_id=provider_id)
        identity = provider.entity.identity
        return TriggerEventDefinition(
            plugin_unique_identifier=provider.plugin_unique_identifier,
            provider_name=identity.name,
            icon=identity.icon or "",
            icon_dark=identity.icon_dark or "",
            parameters=provider.get_event_parameters(event_name=event_name),
        )

    def invoke(
        self, *, event: PreparedTriggerEvent, user_id: str, parameters: Mapping[str, Any]
    ) -> TriggerInvokeEventResponse:
        runtime = event.subscription
        client = PluginTriggerClient(plugin_unique_identifier=event.definition.plugin_unique_identifier)
        try:
            return client.invoke_trigger_event(
                tenant_id=runtime.tenant_id,
                user_id=user_id,
                provider=runtime.provider_id,
                event_name=event.event_name,
                parameters=parameters,
                credentials=runtime.credentials,
                credential_type=runtime.credential_type,
                subscription=runtime.subscription,
                request=deserialize_request(event.raw_request),
                payload=event.payload,
            )
        except EventIgnoreError:
            return TriggerInvokeEventResponse(variables={}, cancelled=True)
