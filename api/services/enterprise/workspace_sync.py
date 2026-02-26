import json
import logging
import uuid
from datetime import UTC, datetime

from redis import RedisError

from extensions.ext_redis import redis_client

logger = logging.getLogger(__name__)

WORKSPACE_SYNC_QUEUE = "enterprise:workspace:sync:queue"
WORKSPACE_SYNC_PROCESSING = "enterprise:workspace:sync:processing"


class WorkspaceSyncService:
    """Service to publish workspace sync tasks to Redis queue for enterprise backend consumption"""

    @staticmethod
    def queue_credential_sync(workspace_id: str, *, source: str) -> bool:
        """
        Queue a credential sync task for a newly created workspace.

        This publishes a task to Redis that will be consumed by the enterprise backend
        worker to sync credentials with the plugin-manager.

        Args:
            workspace_id: The workspace/tenant ID to sync credentials for
            source: Source of the sync request (for debugging/tracking)

        Returns:
            bool: True if task was queued successfully, False otherwise
        """
        try:
            task = {
                "task_id": str(uuid.uuid4()),
                "workspace_id": workspace_id,
                "retry_count": 0,
                "created_at": datetime.now(UTC).isoformat(),
                "source": source,
            }

            # Push to Redis list (queue) - LPUSH adds to the head, worker consumes from tail with RPOP
            redis_client.lpush(WORKSPACE_SYNC_QUEUE, json.dumps(task))

            logger.info(
                "Queued credential sync task for workspace %s, task_id: %s, source: %s",
                workspace_id,
                task["task_id"],
                source,
            )
            return True

        except (RedisError, TypeError) as e:
            logger.error("Failed to queue credential sync for workspace %s: %s", workspace_id, str(e), exc_info=True)
            # Don't raise - we don't want to fail workspace creation if queueing fails
            # The scheduled task will catch it later
            return False
