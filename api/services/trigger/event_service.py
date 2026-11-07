"""Prepare and invoke plugin events for debug and published workflow execution."""

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, Protocol

from flask import Request

from core.plugin.entities.request import TriggerInvokeEventResponse
from core.trigger.debug.events import PluginTriggerDebugEvent
from core.trigger.entities.entities import EventParameter
from core.workflow.nodes.trigger_plugin.entities import TriggerEventNodeData
from graphon.entities.graph_config import NodeConfigDict
from models.provider_ids import TriggerProviderID
from services.trigger.subscription_query_service import TriggerSubscriptionRuntime, TriggerSubscriptionRuntimeReader


@dataclass(frozen=True, slots=True)
class TriggerEventDefinition:
    """Provider declaration; a missing package identifier retains legacy plugin-ID dispatch."""

    plugin_unique_identifier: str | None
    provider_name: str
    icon: str
    icon_dark: str
    parameters: Mapping[str, EventParameter]


@dataclass(frozen=True, slots=True)
class PreparedTriggerEvent:
    """Request and provider data shared by the subscribing nodes of one event."""

    subscription: TriggerSubscriptionRuntime = field(repr=False)
    event_name: str
    definition: TriggerEventDefinition
    request: Request = field(repr=False)
    payload: Mapping[str, Any] = field(repr=False)


class TriggerEventGateway(Protocol):
    def describe(
        self, *, tenant_id: str, provider_id: TriggerProviderID, event_name: str
    ) -> TriggerEventDefinition: ...

    def invoke(
        self, *, event: PreparedTriggerEvent, user_id: str, parameters: Mapping[str, Any]
    ) -> TriggerInvokeEventResponse: ...


class TriggerEventRequestReader(Protocol):
    def get_request(self, request_id: str) -> Request: ...

    def get_payload(self, request_id: str) -> Mapping[str, Any]: ...


class TriggerEventService:
    def __init__(
        self,
        *,
        subscriptions: TriggerSubscriptionRuntimeReader,
        plugins: TriggerEventGateway,
        requests: TriggerEventRequestReader,
    ) -> None:
        self._subscriptions = subscriptions
        self._plugins = plugins
        self._requests = requests

    def prepare(
        self, *, subscription: TriggerSubscriptionRuntime, event_name: str, request_id: str
    ) -> PreparedTriggerEvent:
        """Load external data once, before the caller's per-node invocation/dispatch loop."""
        request = self._requests.get_request(request_id)
        payload = self._requests.get_payload(request_id)
        definition = self._plugins.describe(
            tenant_id=subscription.tenant_id,
            provider_id=TriggerProviderID(subscription.provider_id),
            event_name=event_name,
        )
        return PreparedTriggerEvent(
            subscription=subscription, event_name=event_name, definition=definition, request=request, payload=payload
        )

    def invoke(
        self, *, event: PreparedTriggerEvent, user_id: str, node_data: TriggerEventNodeData
    ) -> TriggerInvokeEventResponse:
        parameters = node_data.resolve_parameters(parameter_schemas=event.definition.parameters)
        return self._plugins.invoke(event=event, user_id=user_id, parameters=parameters)

    def invoke_debug(
        self, *, tenant_id: str, user_id: str, node_config: NodeConfigDict, event: PluginTriggerDebugEvent
    ) -> TriggerInvokeEventResponse:
        subscription = self._subscriptions.get_for_execution(tenant_id=tenant_id, subscription_id=event.subscription_id)
        if subscription is None:
            raise ValueError("Subscription not found")
        # Debug events must not redirect a subscription's credentials to a different provider.
        if event.provider_id != subscription.provider_id:
            raise ValueError("Subscription provider does not match trigger event")
        node_data = TriggerEventNodeData.model_validate(node_config["data"], from_attributes=True)
        prepared = self.prepare(subscription=subscription, event_name=event.name, request_id=event.request_id)
        return self.invoke(event=prepared, user_id=user_id, node_data=node_data)
