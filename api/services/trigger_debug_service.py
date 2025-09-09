"""
Trigger debug service for webhook debugging in draft workflows.

This service provides debugging capabilities for trigger nodes by using
Redis Pub/Sub to enable real-time event forwarding across distributed instances.
"""

import json
import logging
import time
import uuid
from collections.abc import Generator

from core.trigger.entities.entities import TriggerDebugEventData
from extensions.ext_redis import redis_client

logger = logging.getLogger(__name__)


class TriggerDebugService:
    """
    Trigger debug service - supports distributed environments.
    Cleans up resources on disconnect, no reconnection handling.
    """

    SESSION_PREFIX = "trigger_debug_session:"
    SUBSCRIPTION_DEBUG_PREFIX = "trigger_debug_subscription:"
    PUBSUB_CHANNEL_PREFIX = "trigger_debug_channel:"

    @classmethod
    def create_debug_session(
        cls, app_id: str, node_id: str, subscription_id: str, user_id: str, timeout: int = 300
    ) -> str:
        """
        Create a debug session.

        Args:
            app_id: Application ID
            node_id: Node ID being debugged
            subscription_id: Subscription ID to monitor
            user_id: User ID creating the session
            timeout: Session timeout in seconds

        Returns:
            Session ID
        """
        session_id = str(uuid.uuid4())

        session_data = {
            "session_id": session_id,
            "app_id": app_id,
            "node_id": node_id,
            "subscription_id": subscription_id,
            "user_id": user_id,
            "created_at": time.time(),
        }

        # 1. Save session info
        redis_client.setex(f"{cls.SESSION_PREFIX}{session_id}", timeout, json.dumps(session_data))

        # 2. Register to subscription's debug session set
        redis_client.sadd(f"{cls.SUBSCRIPTION_DEBUG_PREFIX}{subscription_id}", session_id)
        redis_client.expire(f"{cls.SUBSCRIPTION_DEBUG_PREFIX}{subscription_id}", timeout)

        logger.info("Created debug session %s for subscription %s", session_id, subscription_id)
        return session_id

    @classmethod
    def listen_for_events(cls, session_id: str, timeout: int = 300) -> Generator:
        """
        Listen for events using Redis Pub/Sub.

        Args:
            session_id: Debug session ID
            timeout: Timeout in seconds

        Yields:
            Event data or heartbeat messages
        """
        pubsub = redis_client.pubsub()
        channel = f"{cls.PUBSUB_CHANNEL_PREFIX}{session_id}"

        try:
            # Subscribe to channel
            pubsub.subscribe(channel)
            logger.info("Listening on channel: %s", channel)

            start_time = time.time()
            last_heartbeat = time.time()

            # Real-time listening
            while time.time() - start_time < timeout:
                # Non-blocking message retrieval with 1 second timeout
                message = pubsub.get_message(timeout=1.0)

                if message and message["type"] == "message":
                    # Received trigger event
                    event_data = json.loads(message["data"])
                    logger.info("Received trigger event for session %s", session_id)
                    yield event_data
                    break  # End listening after receiving event

                # Send periodic heartbeat
                if time.time() - last_heartbeat > 5:
                    yield {"type": "heartbeat", "remaining": int(timeout - (time.time() - start_time))}
                    last_heartbeat = time.time()

            # Timeout
            if time.time() - start_time >= timeout:
                yield {"type": "timeout"}

        except Exception as e:
            logger.exception("Error in listen_for_events", exc_info=e)
            yield {"type": "error", "message": str(e)}

        finally:
            # Clean up resources
            cls.close_session(session_id)
            pubsub.unsubscribe(channel)
            pubsub.close()
            logger.info("Closed listening for session %s", session_id)

    @classmethod
    def close_session(cls, session_id: str):
        """
        Close and clean up debug session.

        Args:
            session_id: Session ID to close
        """
        try:
            # Get session info
            session_data = redis_client.get(f"{cls.SESSION_PREFIX}{session_id}")
            if session_data:
                session = json.loads(session_data)
                subscription_id = session.get("subscription_id")

                # Remove from subscription set
                if subscription_id:
                    redis_client.srem(f"{cls.SUBSCRIPTION_DEBUG_PREFIX}{subscription_id}", session_id)
                    logger.info("Removed session %s from subscription %s", session_id, subscription_id)

            # Delete session info
            redis_client.delete(f"{cls.SESSION_PREFIX}{session_id}")
            logger.info("Cleaned up session %s", session_id)

        except Exception as e:
            logger.exception("Error closing session %s", session_id, exc_info=e)

    @classmethod
    def dispatch_to_debug_sessions(cls, subscription_id: str, event_data: TriggerDebugEventData) -> int:
        """
        Dispatch events to debug sessions using Pub/Sub only.

        Args:
            subscription_id: Subscription ID
            event_data: Event data to dispatch

        Returns:
            Number of active debug sessions
        """
        try:
            # Get all listening debug sessions
            debug_sessions = redis_client.smembers(f"{cls.SUBSCRIPTION_DEBUG_PREFIX}{subscription_id}")

            if not debug_sessions:
                return 0

            active_sessions = 0
            for session_id_bytes in debug_sessions:
                if isinstance(session_id_bytes, bytes):
                    session_id = session_id_bytes.decode("utf-8")
                else:
                    session_id = session_id_bytes

                # Verify session is valid
                if not redis_client.exists(f"{cls.SESSION_PREFIX}{session_id}"):
                    # Clean up invalid session
                    redis_client.srem(f"{cls.SUBSCRIPTION_DEBUG_PREFIX}{subscription_id}", session_id)
                    continue

                # Publish event via Pub/Sub
                channel = f"{cls.PUBSUB_CHANNEL_PREFIX}{session_id}"
                subscriber_count = redis_client.publish(channel, json.dumps(event_data))

                if subscriber_count > 0:
                    active_sessions += 1
                    logger.info("Published event to %d subscribers on channel %s", subscriber_count, channel)
                else:
                    # No subscribers, clean up session
                    logger.info("No subscribers for session %s, cleaning up", session_id)
                    cls.close_session(session_id)

            if active_sessions > 0:
                logger.info("Dispatched event to %d active debug sessions", active_sessions)

            return active_sessions
        except Exception as e:
            logger.exception("Failed to dispatch to debug sessions", exc_info=e)
            return 0