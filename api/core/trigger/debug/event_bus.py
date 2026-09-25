import hashlib
import logging

from redis import RedisError
from redis_lua_py import Key, redis, script

from core.trigger.debug.events import BaseDebugEvent
from extensions.ext_redis import redis_client

logger = logging.getLogger(__name__)

TRIGGER_DEBUG_EVENT_TTL = 300


@script
def _select(inbox: Key, pool: Key, address_id: str) -> bytes | None:
    """Atomically take the address's pending event, or join the waiting pool."""
    event = redis.get(inbox)
    if event is not None:
        redis.delete(inbox)
        return event
    redis.sadd(pool, address_id)
    redis.expire(pool, TRIGGER_DEBUG_EVENT_TTL)
    return None


@script
def _dispatch(pool: Key, tenant_id: str, event: str) -> int:
    """Deliver the event to every address waiting in the pool."""
    addresses = redis.smembers(pool)
    if len(addresses) == 0:
        return 0
    redis.delete(pool)
    for address_id in addresses:
        redis.set(f"trigger_debug_inbox:{{{tenant_id}}}:{address_id}", event, "EX", TRIGGER_DEBUG_EVENT_TTL)
    return len(addresses)


def _unprefixed(name: str) -> bytes:
    # Dispatch builds inbox keys inside the script, where the configured key
    # prefix is not applied, so every key here stays unprefixed. The client
    # wrapper leaves bytes names as they are.
    return name.encode()


class TriggerDebugEventBus:
    """
    Unified Redis-based trigger debug service with polling support.

    Uses {tenant_id} hash tags for Redis Cluster compatibility.
    Supports multiple event types through a generic dispatch/poll interface.
    """

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
            pool_key: Pool key (generate using build_{?}_pool_key(...))

        Returns:
            Number of addresses the event was dispatched to
        """
        event_data = event.model_dump_json()
        try:
            return _dispatch(
                redis_client,
                pool=_unprefixed(pool_key),
                tenant_id=tenant_id,
                event=event_data,
            )
        except RedisError:
            logger.exception("Failed to dispatch event to pool: %s", pool_key)
            return 0

    @classmethod
    def poll[T: BaseDebugEvent](
        cls,
        event_type: type[T],
        pool_key: str,
        tenant_id: str,
        user_id: str,
        app_id: str,
        node_id: str,
    ) -> T | None:
        """
        Poll for an event or register to the waiting pool.

        If an event is available in the inbox, return it immediately.
        Otherwise, register the address to the waiting pool for future dispatch.

        Args:
            event_class: Event class for deserialization and type safety
            pool_key: Pool key (generate using build_{?}_pool_key(...))
            tenant_id: Tenant ID
            user_id: User ID for address calculation
            app_id: App ID for address calculation
            node_id: Node ID for address calculation

        Returns:
            Event object if available, None otherwise
        """
        address_id: str = hashlib.sha256(f"{user_id}|{app_id}|{node_id}".encode()).hexdigest()
        address: str = f"trigger_debug_inbox:{{{tenant_id}}}:{address_id}"

        try:
            event_data = _select(
                redis_client,
                inbox=_unprefixed(address),
                pool=_unprefixed(pool_key),
                address_id=address_id,
            )
            return event_type.model_validate_json(json_data=event_data) if event_data else None
        except RedisError:
            logger.exception("Failed to poll event from pool: %s", pool_key)
            return None
