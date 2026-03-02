import json
import logging
import uuid
from datetime import UTC, datetime

from redis import RedisError

from configs import dify_config
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models.account import TenantAccountJoin

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
        bool: True if task was queued (or skipped in community), False if queueing failed
    """
    if not dify_config.ENTERPRISE_ENABLED:
        return True

    return _queue_task(workspace_id=workspace_id, member_id=member_id, source=source)


def sync_account_deletion(account_id: str, *, source: str) -> bool:
    """
    Sync full account deletion across all workspaces (enterprise only).

    Fetches all workspace memberships for the account and queues a sync task for each.
    Handles enterprise edition check internally. Safe to call in community edition (no-op).

    Args:
        account_id: The account ID being deleted
        source: Source of the sync request (e.g., "account_deleted")

    Returns:
        bool: True if all tasks were queued (or skipped in community), False if any queueing failed
    """
    if not dify_config.ENTERPRISE_ENABLED:
        return True

    # Fetch all workspaces the account belongs to
    workspace_joins = db.session.query(TenantAccountJoin).filter_by(account_id=account_id).all()

    # Queue sync task for each workspace
    success = True
    for join in workspace_joins:
        if not _queue_task(workspace_id=join.tenant_id, member_id=account_id, source=source):
            success = False

    return success
