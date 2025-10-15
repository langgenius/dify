from abc import ABC, abstractmethod
from collections.abc import Mapping
from typing import Any

from pydantic import BaseModel, Field


class BaseDebugEvent(ABC, BaseModel):
    """Base class for all debug events."""

    timestamp: int

    @classmethod
    @abstractmethod
    def build_pool_key(cls, **kwargs: Any) -> str:
        """
        Generate the waiting pool key for this event type.

        Each subclass implements its own pool key strategy based on routing parameters.

        Returns:
            Redis key for the waiting pool
        """
        raise NotImplementedError("Subclasses must implement build_pool_key")


class ScheduleDebugEvent(BaseDebugEvent):
    """Debug event for schedule triggers."""

    node_id: str
    inputs: Mapping[str, Any]

    @classmethod
    def build_pool_key(cls, **kwargs: Any) -> str:
        """Generate pool key for schedule events.

        Args:
            tenant_id: Tenant ID
            app_id: App ID
            node_id: Node ID
        """
        tenant_id = kwargs["tenant_id"]
        app_id = kwargs["app_id"]
        node_id = kwargs["node_id"]
        return f"schedule_trigger_debug_waiting_pool:{tenant_id}:{app_id}:{node_id}"


class WebhookDebugEvent(BaseDebugEvent):
    """Debug event for webhook triggers."""

    request_id: str
    node_id: str
    payload: dict[str, Any] = Field(default_factory=dict)

    @classmethod
    def build_pool_key(cls, **kwargs: Any) -> str:
        """Generate pool key for webhook events.

        Args:
            tenant_id: Tenant ID
            app_id: App ID
            node_id: Node ID
        """
        tenant_id = kwargs["tenant_id"]
        app_id = kwargs["app_id"]
        node_id = kwargs["node_id"]
        return f"webhook_trigger_debug_waiting_pool:{tenant_id}:{app_id}:{node_id}"


class PluginTriggerDebugEvent(BaseDebugEvent):
    """Debug event for plugin triggers."""

    name: str
    request_id: str
    subscription_id: str
    provider_id: str

    @classmethod
    def build_pool_key(cls, **kwargs: Any) -> str:
        """Generate pool key for plugin trigger events.

        Args:
            name: Event name
            tenant_id: Tenant ID
            provider_id: Provider ID
            subscription_id: Subscription ID
        """
        tenant_id = kwargs["tenant_id"]
        provider_id = kwargs["provider_id"]
        subscription_id = kwargs["subscription_id"]
        event_name = kwargs["name"]
        return f"plugin_trigger_debug_waiting_pool:{tenant_id}:{str(provider_id)}:{subscription_id}:{event_name}"
