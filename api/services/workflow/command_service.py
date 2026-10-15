"""Dify stop-command behavior over the public Graphon command channel."""

import logging

from extensions.ext_redis import RedisClientWrapper
from graphon.engine.command import AbortCommand, RedisChannel

logger = logging.getLogger(__name__)


def send_workflow_stop_command(*, task_id: str, redis: RedisClientWrapper) -> None:
    """Keep stop requests best-effort after the durable legacy stop flag is set."""
    if not task_id:
        return
    try:
        RedisChannel(redis, f"workflow:{task_id}:commands").send_command(AbortCommand(reason="User requested stop"))
    except Exception:
        logger.exception("Failed to send stop command for workflow task %s", task_id)
