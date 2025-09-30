"""Trigger debug service supporting plugin and webhook debugging in draft workflows."""

import hashlib
import logging
from typing import Any, Optional

from pydantic import BaseModel, Field
from redis import RedisError

from extensions.ext_redis import redis_client

logger = logging.getLogger(__name__)

TRIGGER_DEBUG_EVENT_TTL = 300


class TriggerDebugEvent(BaseModel):
    subscription_id: str
    request_id: str
    timestamp: int


class WebhookDebugEvent(BaseModel):
    request_id: str
    timestamp: int
    node_id: str
    payload: dict[str, Any] = Field(default_factory=dict)


def _address(tenant_id: str, user_id: str, app_id: str, node_id: str) -> str:
    address_id = hashlib.sha1(f"{user_id}|{app_id}|{node_id}".encode()).hexdigest()
    return f"trigger_debug_inbox:{{{tenant_id}}}:{address_id}"


class TriggerDebugService:
    """
    Redis-based trigger debug service with polling support.
    Uses {tenant_id} hash tags for Redis Cluster compatibility.
    """

    # LUA_SELECT: Atomic poll or register for event
    # KEYS[1] = trigger_debug_inbox:{tenant_id}:{address_id}
    # KEYS[2] = trigger_debug_waiting_pool:{tenant_id}:{subscription_id}:{trigger}
    # ARGV[1] = address_id
    # compressed lua code, you can use LLM to uncompress it
    LUA_SELECT = (
        "local v=redis.call('GET',KEYS[1]);"
        "if v then redis.call('DEL',KEYS[1]);return v end;"
        "redis.call('SADD',KEYS[2],ARGV[1]);"
        f"redis.call('EXPIRE',KEYS[2],{TRIGGER_DEBUG_EVENT_TTL});"
        "return false"
    )

    # LUA_DISPATCH: Dispatch event to all waiting addresses
    # KEYS[1] = trigger_debug_waiting_pool:{tenant_id}:{subscription_id}:{trigger}
    # ARGV[1] = tenant_id
    # ARGV[2] = event_json
    # compressed lua code, you can use LLM to uncompress it
    LUA_DISPATCH = (
        "local a=redis.call('SMEMBERS',KEYS[1]);"
        "if #a==0 then return 0 end;"
        "redis.call('DEL',KEYS[1]);"
        "for i=1,#a do "
        f"redis.call('SET','trigger_debug_inbox:{{'..ARGV[1]..'}}'..':'..a[i],ARGV[2],'EX',{TRIGGER_DEBUG_EVENT_TTL});"
        "end;"
        "return #a"
    )

    @classmethod
    def waiting_pool(cls, tenant_id: str, subscription_id: str, trigger_name: str) -> str:
        return f"trigger_debug_waiting_pool:{{{tenant_id}}}:{subscription_id}:{trigger_name}"

    @classmethod
    def dispatch_debug_event(
        cls,
        tenant_id: str,
        subscription_id: str,
        events: list[str],
        request_id: str,
        timestamp: int,
    ) -> int:
        event_json = TriggerDebugEvent(
            subscription_id=subscription_id,
            request_id=request_id,
            timestamp=timestamp,
        ).model_dump_json()

        dispatched = 0
        if len(events) > 10:
            logger.warning(
                "Too many events to dispatch at once: %d events tenant: %s subscription: %s",
                len(events),
                tenant_id,
                subscription_id,
            )

        for trigger_name in events:
            try:
                dispatched += redis_client.eval(
                    cls.LUA_DISPATCH,
                    1,
                    cls.waiting_pool(tenant_id, subscription_id, trigger_name),
                    tenant_id,
                    event_json,
                )
            except RedisError:
                logger.exception("Failed to dispatch for trigger: %s", trigger_name)
        return dispatched

    @classmethod
    def poll_event(
        cls,
        tenant_id: str,
        user_id: str,
        app_id: str,
        subscription_id: str,
        node_id: str,
        trigger_name: str,
    ) -> Optional[TriggerDebugEvent]:
        address_id = hashlib.sha1(f"{user_id}|{app_id}|{node_id}".encode()).hexdigest()

        try:
            event = redis_client.eval(
                cls.LUA_SELECT,
                2,
                _address(tenant_id, user_id, app_id, node_id),
                cls.waiting_pool(tenant_id, subscription_id, trigger_name),
                address_id,
            )
            return TriggerDebugEvent.model_validate_json(event) if event else None
        except RedisError:
            logger.exception("Failed to poll debug event")
            return None


class WebhookDebugService:
    """Debug helpers dedicated to webhook triggers."""

    @staticmethod
    def waiting_pool(tenant_id: str, app_id: str, node_id: str) -> str:
        return f"trigger_debug_waiting_pool:{{{tenant_id}}}:{app_id}:{node_id}"

    @classmethod
    def dispatch_event(
        cls,
        tenant_id: str,
        app_id: str,
        node_id: str,
        request_id: str,
        timestamp: int,
        payload: dict[str, Any],
    ) -> int:
        event_json = WebhookDebugEvent(
            request_id=request_id,
            timestamp=timestamp,
            node_id=node_id,
            payload=payload,
        ).model_dump_json()

        try:
            return redis_client.eval(
                TriggerDebugService.LUA_DISPATCH,
                1,
                cls.waiting_pool(tenant_id, app_id, node_id),
                tenant_id,
                event_json,
            )
        except RedisError:
            logger.exception("Failed to dispatch webhook debug event")
            return 0

    @classmethod
    def poll_event(
        cls,
        tenant_id: str,
        user_id: str,
        app_id: str,
        node_id: str,
    ) -> Optional[WebhookDebugEvent]:
        address_id = hashlib.sha1(f"{user_id}|{app_id}|{node_id}".encode()).hexdigest()

        try:
            event = redis_client.eval(
                TriggerDebugService.LUA_SELECT,
                2,
                _address(tenant_id, user_id, app_id, node_id),
                cls.waiting_pool(tenant_id, app_id, node_id),
                address_id,
            )
            return WebhookDebugEvent.model_validate_json(event) if event else None
        except RedisError:
            logger.exception("Failed to poll webhook debug event")
            return None
