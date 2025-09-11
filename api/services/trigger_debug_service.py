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
from dataclasses import dataclass
from typing import Any

from flask import request
from werkzeug.exceptions import NotFound

from core.app.entities.task_entities import (
    ErrorStreamResponse,
    PingStreamResponse,
    TriggerDebugListeningStartedResponse,
    TriggerDebugReceivedResponse,
    TriggerDebugTimeoutResponse,
)
from core.trigger.entities.entities import TriggerDebugEventData
from extensions.ext_redis import redis_client
from models.model import App
from services.trigger.trigger_provider_service import TriggerProviderService
from services.workflow_service import WorkflowService

logger = logging.getLogger(__name__)


@dataclass
class TriggerDebuggingContext:
    """Context for trigger debugging session."""

    session_id: str
    subscription_id: str
    webhook_url: str
    node_id: str
    app_id: str
    user_id: str
    timeout: int


class TriggerDebugService:
    """
    Trigger debug service - supports distributed environments.
    Cleans up resources on disconnect, no reconnection handling.
    """

    SESSION_PREFIX = "trigger_debug_session:"
    SUBSCRIPTION_DEBUG_PREFIX = "trigger_debug_subscription:"
    PUBSUB_CHANNEL_PREFIX = "trigger_debug_channel:"

    __DEFAULT_LISTEN_TIMEOUT__ = 300

    @classmethod
    def build_debugging_context(
        cls,
        app_model: App,
        node_id: str,
        user_id: str,
        timeout: int = __DEFAULT_LISTEN_TIMEOUT__,
    ) -> TriggerDebuggingContext:
        """
        Build debugging context for trigger node.

        Args:
            app_model: Application model
            node_id: Node ID to debug
            user_id: User ID creating the session
            timeout: Session timeout in seconds

        Returns:
            TriggerDebuggingContext with all debugging information

        Raises:
            NotFound: If workflow or node not found
            ValueError: If node is not a trigger plugin or has no subscription
        """
        # Get and validate workflow
        workflow_service = WorkflowService()
        draft_workflow = workflow_service.get_draft_workflow(app_model)
        if not draft_workflow:
            raise NotFound("Workflow not found")

        # Get and validate node
        node_config = draft_workflow.get_node_config_by_id(node_id)
        if not node_config:
            raise NotFound(f"Node {node_id} not found")

        if node_config.get("data", {}).get("type") != "plugin":
            raise ValueError("Node is not a trigger plugin node")

        subscription_id = node_config.get("data", {}).get("subscription_id")
        if not subscription_id:
            raise ValueError("No subscription configured for this trigger node")

        # Create debug session
        app_id = str(app_model.id)
        session_id = cls.create_debug_session(
            app_id=app_id,
            node_id=node_id,
            subscription_id=subscription_id,
            user_id=user_id,
            timeout=timeout,
        )

        # Get webhook URL
        subscription = TriggerProviderService.get_subscription_by_id(
            tenant_id=app_model.tenant_id, subscription_id=subscription_id
        )
        webhook_url = (
            f"{request.host_url.rstrip('/')}/trigger/plugin/{subscription.endpoint}" if subscription else "Unknown"
        )

        return TriggerDebuggingContext(
            session_id=session_id,
            subscription_id=subscription_id,
            webhook_url=webhook_url,
            node_id=node_id,
            app_id=app_id,
            user_id=user_id,
            timeout=timeout,
        )

    @classmethod
    def waiting_for_triggered(
        cls,
        app_model: App,
        node_id: str,
        user_id: str,
        timeout: int = __DEFAULT_LISTEN_TIMEOUT__,
    ) -> Generator[dict[str, Any], None, None]:
        """
        Listen for trigger events only.

        This method sets up a debug session and listens for incoming trigger events.
        It yields events as they occur and returns when a trigger is received or timeout occurs.

        Args:
            app_model: Application model
            node_id: Node ID to debug
            user_id: User ID creating the session
            timeout: Timeout in seconds

        Yields:
            Event dictionaries including:
            - listening_started: Initial event with webhook URL
            - ping: Periodic heartbeat events
            - trigger_debug_received: When trigger is received
            - timeout: When timeout occurs
            - error: On any errors
        """
        # Build debugging context
        context = cls.build_debugging_context(app_model, node_id, user_id, timeout)

        # Listen for events and pass them through
        for event in cls.listen_for_events(
            session_id=context.session_id, webhook_url=context.webhook_url, timeout=context.timeout
        ):
            yield event

            # If we received a trigger, listening is complete
            if isinstance(event, dict) and event.get("event") == "trigger_debug_received":
                break

    @classmethod
    def create_debug_session(
        cls, app_id: str, node_id: str, subscription_id: str, user_id: str, timeout: int = __DEFAULT_LISTEN_TIMEOUT__
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
    def listen_for_events(
        cls, session_id: str, webhook_url: str, timeout: int = __DEFAULT_LISTEN_TIMEOUT__
    ) -> Generator[dict[str, Any], None, None]:
        """
        Listen for events using Redis Pub/Sub and generate structured events.

        Args:
            session_id: Debug session ID
            webhook_url: Webhook URL for the trigger
            timeout: Timeout in seconds

        Yields:
            Structured AppQueueEvent objects
        """
        # Send initial listening started event
        yield TriggerDebugListeningStartedResponse(
            task_id="",  # Will be set by the caller if needed
            session_id=session_id,
            webhook_url=webhook_url,
            timeout=timeout,
        ).to_dict()
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
                    # Received trigger event - parse and create structured event
                    try:
                        event_data = json.loads(message["data"])
                        logger.info("Received trigger event for session %s", session_id)

                        # Create structured trigger received event
                        trigger_data = TriggerDebugEventData(
                            subscription_id=event_data["subscription_id"],
                            triggers=event_data["triggers"],
                            request_id=event_data["request_id"],
                            timestamp=event_data.get("timestamp", time.time()),
                        )
                        yield TriggerDebugReceivedResponse(
                            task_id="",
                            subscription_id=trigger_data.subscription_id,
                            triggers=trigger_data.triggers,
                            request_id=trigger_data.request_id,
                            timestamp=trigger_data.timestamp,
                        ).to_dict()
                        break  # End listening after receiving event
                    except (json.JSONDecodeError, KeyError) as e:
                        logger.exception("Failed to parse trigger event")
                        yield ErrorStreamResponse(
                            task_id="", err=Exception(f"Failed to parse trigger event: {str(e)}")
                        ).to_dict()
                        break

                # Send periodic heartbeat
                if time.time() - last_heartbeat > 5:
                    yield PingStreamResponse(task_id="").to_dict()
                    last_heartbeat = time.time()

            # Timeout
            if time.time() - start_time >= timeout:
                yield TriggerDebugTimeoutResponse(task_id="").to_dict()

        except Exception as e:
            logger.exception("Error in listen_for_events", exc_info=e)
            yield ErrorStreamResponse(task_id="", err=e).to_dict()

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
                subscriber_count = redis_client.publish(channel, json.dumps(event_data.model_dump()))

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
