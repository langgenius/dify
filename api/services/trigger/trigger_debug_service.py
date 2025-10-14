"""Trigger debug service supporting plugin and webhook debugging in draft workflows."""

import hashlib
import logging
from abc import ABC, abstractmethod
from collections.abc import Mapping
from typing import Any, TypeVar

from pydantic import BaseModel, Field
from redis import RedisError

from extensions.ext_redis import redis_client

logger = logging.getLogger(__name__)

TRIGGER_DEBUG_EVENT_TTL = 300

TEvent = TypeVar("TEvent", bound="BaseDebugEvent")


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


class TriggerDebugService:
    """
    Unified Redis-based trigger debug service with polling support.

    Uses {tenant_id} hash tags for Redis Cluster compatibility.
    Supports multiple event types through a generic dispatch/poll interface.
    """

    # LUA_SELECT: Atomic poll or register for event
    # KEYS[1] = trigger_debug_inbox:{tenant_id}:{address_id}
    # KEYS[2] = trigger_debug_waiting_pool:{tenant_id}:...
    # ARGV[1] = address_id
    LUA_SELECT = (
        "local v=redis.call('GET',KEYS[1]);"
        "if v then redis.call('DEL',KEYS[1]);return v end;"
        "redis.call('SADD',KEYS[2],ARGV[1]);"
        f"redis.call('EXPIRE',KEYS[2],{TRIGGER_DEBUG_EVENT_TTL});"
        "return false"
    )

    # LUA_DISPATCH: Dispatch event to all waiting addresses
    # KEYS[1] = trigger_debug_waiting_pool:{tenant_id}:...
    # ARGV[1] = tenant_id
    # ARGV[2] = event_json
    LUA_DISPATCH = (
        "local a=redis.call('SMEMBERS',KEYS[1]);"
        "if #a==0 then return 0 end;"
        "redis.call('DEL',KEYS[1]);"
        "for i=1,#a do "
        f"redis.call('SET','trigger_debug_inbox:'..ARGV[1]..':'..a[i],ARGV[2],'EX',{TRIGGER_DEBUG_EVENT_TTL});"
        "end;"
        "return #a"
    )

    @classmethod
    def dispatch(
        cls,
        tenant_id: str,
        event: BaseDebugEvent,
        pool_key: str,
    ) -> int:
        """
        Dispatch event to all waiting addresses in the pool.

        Args:
            tenant_id: Tenant ID for hash tag
            event: Event object to dispatch
            pool_key: Pool key (generate using event_class.build_pool_key(...))

        Returns:
            Number of addresses the event was dispatched to
        """
        event_data = event.model_dump_json()
        try:
            result = redis_client.eval(
                cls.LUA_DISPATCH,
                1,
                pool_key,
                tenant_id,
                event_data,
            )
            return int(result)
        except RedisError:
            logger.exception("Failed to dispatch event to pool: %s", pool_key)
            return 0

    @classmethod
    def poll(
        cls,
        event_type: type[TEvent],
        pool_key: str,
        tenant_id: str,
        user_id: str,
        app_id: str,
        node_id: str,
    ) -> TEvent | None:
        """
        Poll for an event or register to the waiting pool.

        If an event is available in the inbox, return it immediately.
        Otherwise, register the address to the waiting pool for future dispatch.

        Args:
            event_class: Event class for deserialization and type safety
            pool_key: Pool key (generate using event_class.build_pool_key(...))
            tenant_id: Tenant ID
            user_id: User ID for address calculation
            app_id: App ID for address calculation
            node_id: Node ID for address calculation

        Returns:
            Event object if available, None otherwise
        """
        address_id: str = hashlib.sha1(f"{user_id}|{app_id}|{node_id}".encode()).hexdigest()
        address: str = f"trigger_debug_inbox:{tenant_id}:{address_id}"

        try:
            event_data = redis_client.eval(
                cls.LUA_SELECT,
                2,
                address,
                pool_key,
                address_id,
            )
            return event_type.model_validate_json(json_data=event_data) if event_data else None
        except RedisError:
            logger.exception("Failed to poll event from pool: %s", pool_key)
            return None
