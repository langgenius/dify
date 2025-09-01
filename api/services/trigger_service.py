import json
import logging
import time
import uuid
from typing import Any, Optional

from flask import Request, Response

from core.plugin.entities.plugin import TriggerProviderID
from core.trigger.trigger_manager import TriggerManager
from extensions.ext_redis import redis_client
from services.trigger.trigger_provider_service import TriggerProviderService

logger = logging.getLogger(__name__)


class TriggerService:
    __TEMPORARY_ENDPOINT_EXPIRE_MS__ = 5 * 60 * 1000
    __ENDPOINT_REQUEST_CACHE_COUNT__ = 10
    __ENDPOINT_REQUEST_CACHE_EXPIRE_MS__ = 5 * 60 * 1000
    # Lua script for atomic write with time & count based cleanup
    __LUA_SCRIPT__ = """
        -- KEYS[1] = zset key
        -- ARGV[1] = max_count (maximum number of entries to keep)
        -- ARGV[2] = min_ts_ms (minimum timestamp to keep = now_ms - ttl_ms)
        -- ARGV[3] = now_ms (current timestamp in milliseconds)
        -- ARGV[4] = member (log entry JSON)

        local key      = KEYS[1]
        local maxCount = tonumber(ARGV[1])
        local minTs    = tonumber(ARGV[2])
        local nowMs    = tonumber(ARGV[3])
        local member   = ARGV[4]

        -- 1) Add new entry with timestamp as score
        redis.call('ZADD', key, nowMs, member)

        -- 2) Remove entries older than minTs (time-based cleanup)
        redis.call('ZREMRANGEBYSCORE', key, '-inf', minTs)

        -- 3) Remove oldest entries if count exceeds maxCount (count-based cleanup)
        local n = redis.call('ZCARD', key)
        if n > maxCount then
        redis.call('ZREMRANGEBYRANK', key, 0, n - maxCount - 1)  -- 0 is oldest
        end

        return n
    """

    @classmethod
    def process_endpoint(cls, endpoint_id: str, request: Request) -> Response | None:
        """Extract and process data from incoming endpoint request."""
        subscription = TriggerProviderService.get_subscription_by_endpoint(endpoint_id)
        if not subscription:
            return None
        
        provider_id = TriggerProviderID(subscription.provider_id)
        controller = TriggerManager.get_trigger_provider(subscription.tenant_id, provider_id)
        if not controller:
            return None
        
        dispatch_response = controller.dispatch(
            user_id=subscription.user_id, request=request, subscription=subscription.to_entity()
        )

        # TODO invoke triggers
        # dispatch_response.triggers

        return dispatch_response.response

    @classmethod
    def log_endpoint_request(cls, endpoint_id: str, request: Request) -> int:
        """
        Log the endpoint request to Redis using ZSET for rolling log with time & count based retention.

        Args:
            endpoint_id: The endpoint identifier
            request: The Flask request object

        Returns:
            The current number of logged requests for this endpoint
        """
        try:
            # Prepare timestamp
            now_ms = int(time.time() * 1000)
            min_ts = now_ms - cls.__ENDPOINT_REQUEST_CACHE_EXPIRE_MS__

            # Extract request data
            request_data = {
                "id": str(uuid.uuid4()),
                "timestamp": now_ms,
                "method": request.method,
                "path": request.path,
                "headers": dict(request.headers),
                "query_params": request.args.to_dict(flat=False) if request.args else {},
                "body": None,
                "remote_addr": request.remote_addr,
            }

            # Try to get request body if it exists
            if request.is_json:
                try:
                    request_data["body"] = request.get_json(force=True)
                except Exception:
                    request_data["body"] = request.get_data(as_text=True)
            elif request.data:
                request_data["body"] = request.get_data(as_text=True)

            # Serialize to JSON
            member = json.dumps(request_data, separators=(",", ":"))

            # Execute Lua script atomically
            key = f"trigger:endpoint_requests:{endpoint_id}"
            count = redis_client.eval(
                cls.__LUA_SCRIPT__,
                1,  # number of keys
                key,  # KEYS[1]
                str(cls.__ENDPOINT_REQUEST_CACHE_COUNT__),  # ARGV[1] - max count
                str(min_ts),  # ARGV[2] - minimum timestamp
                str(now_ms),  # ARGV[3] - current timestamp
                member,  # ARGV[4] - log entry
            )

            logger.debug("Logged request for endpoint %s, current count: %s", endpoint_id, count)
            return count

        except Exception as e:
            logger.exception("Failed to log endpoint request for %s", endpoint_id, exc_info=e)
            # Don't fail the main request processing if logging fails
            return 0

    @classmethod
    def get_recent_endpoint_requests(
        cls, endpoint_id: str, limit: int = 100, start_time_ms: Optional[int] = None, end_time_ms: Optional[int] = None
    ) -> list[dict[str, Any]]:
        """
        Retrieve recent logged requests for an endpoint.

        Args:
            endpoint_id: The endpoint identifier
            limit: Maximum number of entries to return
            start_time_ms: Start timestamp in milliseconds (optional)
            end_time_ms: End timestamp in milliseconds (optional, defaults to now)

        Returns:
            List of request log entries, newest first
        """
        try:
            key = f"trigger:endpoint_requests:{endpoint_id}"

            # Set time bounds
            if end_time_ms is None:
                end_time_ms = int(time.time() * 1000)
            if start_time_ms is None:
                start_time_ms = end_time_ms - cls.__ENDPOINT_REQUEST_CACHE_EXPIRE_MS__

            # Get entries in reverse order (newest first)
            entries = redis_client.zrevrangebyscore(key, max=end_time_ms, min=start_time_ms, start=0, num=limit)

            # Parse JSON entries
            requests = []
            for entry in entries:
                try:
                    requests.append(json.loads(entry))
                except json.JSONDecodeError:
                    logger.warning("Failed to parse log entry: %s", entry)

            return requests

        except Exception as e:
            logger.exception("Failed to retrieve endpoint requests for %s", endpoint_id, exc_info=e)
            return []

    @classmethod
    def clear_endpoint_requests(cls, endpoint_id: str) -> bool:
        """
        Clear all logged requests for an endpoint.

        Args:
            endpoint_id: The endpoint identifier

        Returns:
            True if successful, False otherwise
        """
        try:
            key = f"trigger:endpoint_requests:{endpoint_id}"
            redis_client.delete(key)
            logger.info("Cleared request logs for endpoint %s", endpoint_id)
            return True
        except Exception as e:
            logger.exception("Failed to clear endpoint requests for %s", endpoint_id, exc_info=e)
            return False
