"""Dispatch persisted trigger endpoints without holding a subscription transaction."""

import logging
import secrets
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any, Protocol

from flask import Request, Response

from core.plugin.entities.request import TriggerDispatchResponse
from services.trigger.subscription_service import TriggerSubscriptionSnapshot
from services.workflow.entities import PluginTriggerDispatchData

logger = logging.getLogger(__name__)


class TriggerEndpointLoadError(Exception):
    """A persisted subscription or its provider configuration could not be loaded."""


class TriggerEndpointProviderNotFoundError(Exception):
    """The subscription's plugin provider is no longer available."""


class TriggerEndpointEventNotFoundError(Exception):
    """The plugin dispatched an event absent from its provider declaration."""


class TriggerEndpointQuery(Protocol):
    def get_by_endpoint(self, *, endpoint_id: str) -> TriggerSubscriptionSnapshot | None:
        """Return the capability's detached owner/configuration, or None when absent."""
        ...


@dataclass(frozen=True, slots=True)
class TriggerEndpointDispatch:
    result: TriggerDispatchResponse
    event_names: frozenset[str]


class TriggerEndpointGateway(Protocol):
    def dispatch(self, *, subscription: TriggerSubscriptionSnapshot, request: Request) -> TriggerEndpointDispatch: ...


class TriggerEndpointRequestStore(Protocol):
    def persist_request(self, request_id: str, request: Request) -> None: ...

    def persist_payload(self, request_id: str, payload: Mapping[str, Any]) -> None: ...


class TriggerEndpointService:
    def __init__(
        self,
        *,
        subscriptions: TriggerEndpointQuery,
        provider: TriggerEndpointGateway,
        requests: TriggerEndpointRequestStore,
        publish: Callable[[PluginTriggerDispatchData], None],
    ) -> None:
        self._subscriptions = subscriptions
        self._provider = provider
        self._requests = requests
        self._publish = publish

    def process(self, endpoint_id: str, request: Request) -> Response | None:
        """Return the plugin response, or None so the caller can try a temporary builder."""
        timestamp = int(time.time())
        try:
            subscription = self._subscriptions.get_by_endpoint(endpoint_id=endpoint_id)
        except Exception as error:
            raise TriggerEndpointLoadError(f"Failed to load trigger endpoint {endpoint_id}.") from error
        if subscription is None:
            return None

        dispatched = self._provider.dispatch(subscription=subscription, request=request)
        result = dispatched.result
        if result.events:
            request_id = f"trigger_request_{timestamp}_{secrets.token_hex(6)}"
            self._requests.persist_request(request_id, request)
            self._requests.persist_payload(request_id, result.payload)
            for event_name in result.events:
                if event_name not in dispatched.event_names:
                    logger.error(
                        "Event name %s not found in provider %s for endpoint %s",
                        event_name,
                        subscription.provider_id,
                        endpoint_id,
                    )
                    raise TriggerEndpointEventNotFoundError(
                        f"Event name {event_name} not found in provider {subscription.provider_id}"
                    )
            self._publish(
                PluginTriggerDispatchData(
                    user_id=result.user_id,
                    tenant_id=subscription.tenant_id,
                    endpoint_id=subscription.endpoint_id,
                    provider_id=subscription.provider_id,
                    subscription_id=subscription.id,
                    timestamp=timestamp,
                    events=list(result.events),
                    request_id=request_id,
                )
            )
            logger.info(
                "Queued async dispatching for %d triggers on endpoint %s with request_id %s",
                len(result.events),
                endpoint_id,
                request_id,
            )
        return result.response
