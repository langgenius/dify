from collections.abc import Mapping
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field


class TriggerDebugPoolKey(StrEnum):
    """Trigger debug pool key."""

    SCHEDULE = "schedule_trigger_debug_waiting_pool"
    WEBHOOK = "webhook_trigger_debug_waiting_pool"
    PLUGIN = "plugin_trigger_debug_waiting_pool"


class BaseDebugEvent(BaseModel):
    """Base class for all debug events."""

    timestamp: int


class ScheduleDebugEvent(BaseDebugEvent):
    """Debug event for schedule triggers."""

    node_id: str
    inputs: Mapping[str, Any]


class WebhookDebugEvent(BaseDebugEvent):
    """Debug event for webhook triggers."""

    request_id: str
    node_id: str
    payload: dict[str, Any] = Field(default_factory=dict)


def build_webhook_pool_key(tenant_id: str, app_id: str, node_id: str) -> str:
    """Generate pool key for webhook events.

    Args:
        tenant_id: Tenant ID
        app_id: App ID
        node_id: Node ID
    """
    return f"{TriggerDebugPoolKey.WEBHOOK}:{tenant_id}:{app_id}:{node_id}"


class PluginTriggerDebugEvent(BaseDebugEvent):
    """Debug event for plugin triggers."""

    name: str
    user_id: str = Field(description="This is end user id, only for trigger the event. no related with account user id")
    request_id: str
    subscription_id: str
    provider_id: str


def build_plugin_pool_key(tenant_id: str, provider_id: str, subscription_id: str, name: str) -> str:
    """Generate pool key for plugin trigger events.

    Args:
        name: Event name
        tenant_id: Tenant ID
        provider_id: Provider ID
        subscription_id: Subscription ID
    """
    return f"{TriggerDebugPoolKey.PLUGIN}:{tenant_id}:{str(provider_id)}:{subscription_id}:{name}"
