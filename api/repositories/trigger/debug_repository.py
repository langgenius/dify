import hashlib
import logging

from redis import RedisError

from extensions.ext_redis import RedisClientWrapper
from services.trigger.debug_events import BaseDebugEvent
from services.trigger.debug_store import ScheduleDebugRuntime

logger = logging.getLogger(__name__)

TRIGGER_DEBUG_EVENT_TTL = 300


class RedisTriggerDebugRepository:
    """
    Redis-backed trigger debug storage with polling support.

    Uses {tenant_id} hash tags for Redis Cluster compatibility.
    Supports multiple event types through a generic dispatch/poll interface.
    """

    # LUA_SELECT: Atomic poll or register for event
    # KEYS[1] = trigger_debug_inbox:{<tenant_id>}:<address_id>
    # KEYS[2] = trigger_debug_waiting_pool:{<tenant_id>}:...
    # ARGV[1] = address_id
    LUA_SELECT = (
        "local v=redis.call('GET',KEYS[1]);"
        "if v then redis.call('DEL',KEYS[1]);return v end;"
        "redis.call('SADD',KEYS[2],ARGV[1]);"
        f"redis.call('EXPIRE',KEYS[2],{TRIGGER_DEBUG_EVENT_TTL});"
        "return false"
    )

    # LUA_DISPATCH: Dispatch event to all waiting addresses
    # KEYS[1] = trigger_debug_waiting_pool:{<tenant_id>}:...
    # ARGV[1] = tenant_id
    # ARGV[2] = event_json
    LUA_DISPATCH = (
        "local a=redis.call('SMEMBERS',KEYS[1]);"
        "if #a==0 then return 0 end;"
        "redis.call('DEL',KEYS[1]);"
        "for i=1,#a do "
        f"redis.call('SET','trigger_debug_inbox:{{'..ARGV[1]..'}}'..':'..a[i],ARGV[2],'EX',{TRIGGER_DEBUG_EVENT_TTL});"
        "end;"
        "return #a"
    )

    def __init__(self, *, redis: RedisClientWrapper) -> None:
        self._redis = redis

    def dispatch(
        self,
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
            result = self._redis.eval(
                self.LUA_DISPATCH,
                1,
                pool_key,
                tenant_id,
                event_data,
            )
            return int(result)
        except RedisError:
            logger.exception("Failed to dispatch event to pool: %s", pool_key)
            return 0

    def poll[T: BaseDebugEvent](
        self,
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
            event_type: Event class for deserialization and type safety
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
            event_data = self._redis.eval(
                self.LUA_SELECT,
                2,
                address,
                pool_key,
                address_id,
            )
            return event_type.model_validate_json(json_data=event_data) if event_data else None
        except RedisError:
            logger.exception("Failed to poll event from pool: %s", pool_key)
            return None

    def get_runtime(self, cache_key: str) -> ScheduleDebugRuntime | None:
        """Read a schedule runtime and refresh its TTL, or return None when absent."""
        data = self._redis.get(cache_key)
        if data is None:
            return None
        self._redis.expire(cache_key, TRIGGER_DEBUG_EVENT_TTL)
        return ScheduleDebugRuntime.model_validate_json(data)

    def save_runtime(self, runtime: ScheduleDebugRuntime) -> None:
        """Store the runtime under its key with a bounded TTL."""
        self._redis.setex(runtime.cache_key, TRIGGER_DEBUG_EVENT_TTL, runtime.model_dump_json())

    def delete_runtime(self, cache_key: str) -> None:
        """Remove the runtime if present; deleting an absent key has no effect."""
        self._redis.delete(cache_key)
