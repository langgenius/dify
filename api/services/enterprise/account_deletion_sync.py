import json
import logging
import uuid
from collections.abc import Sequence
from datetime import UTC, datetime

from redis import RedisError

from configs import dify_config
from enums import DeploymentEdition
from extensions.ext_redis import redis_client

logger = logging.getLogger(__name__)

ACCOUNT_DELETION_SYNC_QUEUE = "enterprise:member:sync:queue"
ACCOUNT_DELETION_SYNC_TASK_TYPE = "sync_member_deletion_from_workspace"


def _queue_task(workspace_id: str, member_id: str, *, source: str) -> bool:
    """
    Queue an account deletion sync task to Redis.

    Internal helper function. Do not call directly - use the public functions instead.

    Args:
        workspace_id: The workspace/tenant ID to sync
        member_id: The member/account ID that was removed
        source: Source of the sync request (for debugging/tracking)

    Returns:
        bool: True if task was queued successfully, False otherwise
    """
    try:
        task = {
            "task_id": str(uuid.uuid4()),
            "workspace_id": workspace_id,
            "member_id": member_id,
            "retry_count": 0,
            "created_at": datetime.now(UTC).isoformat(),
            "source": source,
            "type": ACCOUNT_DELETION_SYNC_TASK_TYPE,
        }

        # Push to Redis list (queue) - LPUSH adds to the head, worker consumes from tail with RPOP
        redis_client.lpush(ACCOUNT_DELETION_SYNC_QUEUE, json.dumps(task))

        logger.info(
            "Queued account deletion sync task for workspace %s, member %s, task_id: %s, source: %s",
            workspace_id,
            member_id,
            task["task_id"],
            source,
        )
        return True

    except (RedisError, TypeError) as e:
        logger.error(
            "Failed to queue account deletion sync for workspace %s, member %s: %s",
            workspace_id,
            member_id,
            str(e),
            exc_info=True,
        )
        # Don't raise - we don't want to fail member deletion if queueing fails
        return False


def sync_workspace_member_removal(workspace_id: str, member_id: str, *, source: str) -> bool:
    """
    Sync a single workspace member removal (enterprise only).

    Queues a task for the enterprise backend to reassign resources from the removed member.
    Handles enterprise edition check internally. Safe to call in community edition (no-op).

    Args:
        workspace_id: The workspace/tenant ID
        member_id: The member/account ID that was removed
        source: Source of the sync request (e.g., "workspace_member_removed")

    Returns:
        bool: True if task was queued (or skipped outside the Enterprise edition), False if queueing failed
    """
    if dify_config.DEPLOYMENT_EDITION != DeploymentEdition.ENTERPRISE:
        return True

    return _queue_task(workspace_id=workspace_id, member_id=member_id, source=source)


def sync_account_deletion_memberships(account_id: str, workspace_ids: Sequence[str], *, source: str) -> bool:
    """Queue deletion synchronization after membership persistence has been read and closed."""
    if dify_config.DEPLOYMENT_EDITION != DeploymentEdition.ENTERPRISE:
        return True

    success = True
    for workspace_id in workspace_ids:
        if not _queue_task(workspace_id=workspace_id, member_id=account_id, source=source):
            success = False

    return success
