"""Publish plugin subscription bindings and expose detached subscribers to workers."""

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Protocol


@dataclass(frozen=True, slots=True)
class TriggerSubscriptionBinding:
    node_id: str
    provider_id: str
    event_name: str
    subscription_id: str


@dataclass(frozen=True, slots=True)
class TriggerSubscriber:
    id: str
    tenant_id: str
    app_id: str
    node_id: str


class TriggerSubscriptionBindingQuery(Protocol):
    def get_subscriber_triggers(
        self, *, tenant_id: str, subscription_id: str, event_name: str
    ) -> tuple[TriggerSubscriber, ...]: ...


class TriggerSubscriptionBindingWriter(Protocol):
    def __call__(self, *, tenant_id: str, app_id: str, bindings: Sequence[TriggerSubscriptionBinding]) -> None: ...


class TriggerSubscriptionBindingService:
    MAX_PLUGIN_TRIGGER_NODES_PER_WORKFLOW = 5

    def __init__(self, *, sync_bindings: TriggerSubscriptionBindingWriter) -> None:
        self._sync_bindings = sync_bindings

    def sync(self, *, tenant_id: str, app_id: str, nodes: Iterable[tuple[str, Mapping[str, Any]]]) -> None:
        """Sync subscribed plugin nodes using the publisher's transaction-bound writer."""
        bindings = [
            TriggerSubscriptionBinding(
                node_id=node_id,
                provider_id=node.get("provider_id", ""),
                event_name=node.get("event_name", ""),
                subscription_id=subscription_id,
            )
            for node_id, node in nodes
            if (subscription_id := node.get("subscription_id", ""))
        ]
        if len(bindings) > self.MAX_PLUGIN_TRIGGER_NODES_PER_WORKFLOW:
            raise ValueError(
                "Workflow exceeds maximum plugin trigger node limit. "
                f"Found {len(bindings)} plugin trigger nodes, "
                f"maximum allowed is {self.MAX_PLUGIN_TRIGGER_NODES_PER_WORKFLOW}"
            )
        self._sync_bindings(tenant_id=tenant_id, app_id=app_id, bindings=bindings)
