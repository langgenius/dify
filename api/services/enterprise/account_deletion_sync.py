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

ACCOUNT_DELETION_SYNC_QUEUE = "{enterprise:member:sync}:queue"
WORKSPACE_MEMBER_REMOVAL_SYNC_TASK_TYPE = "sync_member_deletion_from_workspace"
ACCOUNT_DELETION_FROM_WORKSPACE_SYNC_TASK_TYPE = "sync_account_deletion_from_workspace"
ACCOUNT_DELETION_SYNC_TASK_TYPE = "sync_account_deletion"


def _cleanup_task(
    member_id: str,
    *,
    source: str,
    task_type: str,
    workspace_id: str | None = None,
) -> dict[str, object]:
    task: dict[str, object] = {
        "task_id": str(uuid.uuid4()),
        "member_id": member_id,
        "retry_count": 0,
        "created_at": datetime.now(UTC).isoformat(),
        "source": source,
        "type": task_type,
    }
    if workspace_id is not None:
        task["workspace_id"] = workspace_id
    return task


def _queue_tasks(tasks: Sequence[dict[str, object]], member_id: str, *, source: str) -> bool:
    """Atomically queue cleanup tasks in their processing order."""
    try:
        redis_client.lpush(ACCOUNT_DELETION_SYNC_QUEUE, *(json.dumps(task) for task in tasks))

        logger.info(
            "Queued %s account cleanup task(s) for member %s, source: %s",
            len(tasks),
            member_id,
            source,
        )
        return True

    except (RedisError, TypeError) as e:
        logger.error(
            "Failed to queue account cleanup tasks for member %s: %s",
            member_id,
            str(e),
            exc_info=True,
        )
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

    task = _cleanup_task(
        member_id=member_id,
        source=source,
        task_type=WORKSPACE_MEMBER_REMOVAL_SYNC_TASK_TYPE,
        workspace_id=workspace_id,
    )
    return _queue_tasks([task], member_id, source=source)


def sync_account_deletion(account_id: str, workspace_ids: Sequence[str], *, source: str) -> bool:
    """
    Sync full account deletion across all workspaces (enterprise only).

    Queues the caller's locked workspace-membership snapshot followed by one global finalizer.
    Handles enterprise edition check internally. Safe to call in community edition (no-op).

    Args:
        account_id: The account ID being deleted
        source: Source of the sync request (e.g., "account_deleted")
        workspace_ids: Workspace IDs captured while the account membership lock is held

    Returns:
        bool: True if all tasks were queued (or skipped outside the Enterprise edition), False if queueing failed
    """
    if dify_config.DEPLOYMENT_EDITION != DeploymentEdition.ENTERPRISE:
        return True

    tasks = [
        _cleanup_task(
            account_id,
            source=source,
            task_type=ACCOUNT_DELETION_FROM_WORKSPACE_SYNC_TASK_TYPE,
            workspace_id=workspace_id,
        )
        for workspace_id in workspace_ids
    ]
    tasks.append(_cleanup_task(account_id, source=source, task_type=ACCOUNT_DELETION_SYNC_TASK_TYPE))
    return _queue_tasks(tasks, account_id, source=source)
