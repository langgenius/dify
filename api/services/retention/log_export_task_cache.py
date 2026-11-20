"""Persist temporary export tasks and each requester's latest task in Redis."""

from typing import TYPE_CHECKING

from libs.datetime_utils import utc_now
from services.retention.log_export_task import LogExportStatus, LogExportTask

if TYPE_CHECKING:
    from extensions.ext_redis import RedisClientWrapper

_TRANSITION_LOG_EXPORT_TASK = """
local current = redis.call("GET", KEYS[1])
if not current or cjson.decode(current).status ~= ARGV[1] then
    return 0
end
return redis.call("SET", KEYS[1], ARGV[2], "XX", "KEEPTTL") and 1 or 0
"""


class RedisLogExportTasks[FiltersT]:
    """Scope temporary export tasks to their application family, workspace and app."""

    def __init__(
        self, *, redis: "RedisClientWrapper", task_type: type[LogExportTask[FiltersT]], key_prefix: str
    ) -> None:
        """Bind the Redis client and the model and key prefix for one application family."""
        self._redis = redis
        self._task_type = task_type
        self._key_prefix = key_prefix

    def _key(self, *, tenant_id: str, app_id: str, task_id: str) -> str:
        """Scope a task key to its owning workspace and app."""
        return f"{self._key_prefix}:{tenant_id}:{app_id}:{task_id}"

    def _latest_key(self, *, tenant_id: str, app_id: str, requested_by: str) -> str:
        """Locate the latest task ID for one requester in the app."""
        return f"{self._key_prefix}_latest:{tenant_id}:{app_id}:{requested_by}"

    def save(self, task: LogExportTask[FiltersT]) -> None:
        """Save a task before exposing it as the latest, with the same TTL for both keys."""
        key = self._key(tenant_id=task.tenant_id, app_id=task.app_id, task_id=task.task_id)
        ttl_seconds = max(1, int((task.expires_at - utc_now()).total_seconds()))
        self._redis.setex(key, ttl_seconds, task.model_dump_json())
        latest_key = self._latest_key(tenant_id=task.tenant_id, app_id=task.app_id, requested_by=task.requested_by)
        self._redis.setex(latest_key, ttl_seconds, task.task_id)

    def get(self, *, tenant_id: str, app_id: str, task_id: str) -> LogExportTask[FiltersT] | None:
        """Load the matching live task for the workspace and app."""
        raw = self._redis.get(self._key(tenant_id=tenant_id, app_id=app_id, task_id=task_id))
        if raw is None:
            return None
        task = self._task_type.model_validate_json(raw)
        if (task.tenant_id, task.app_id, task.task_id) != (tenant_id, app_id, task_id) or task.expires_at <= utc_now():
            return None
        return task

    def get_latest(self, *, tenant_id: str, app_id: str, requested_by: str) -> LogExportTask[FiltersT] | None:
        """Follow the latest ID to a live task for the exact requester, app and workspace."""
        raw = self._redis.get(self._latest_key(tenant_id=tenant_id, app_id=app_id, requested_by=requested_by))
        if raw is None:
            return None
        task_id = raw.decode() if isinstance(raw, bytes) else raw
        task = self.get(tenant_id=tenant_id, app_id=app_id, task_id=task_id)
        return task if task is not None and task.requested_by == requested_by else None

    def transition(self, task: LogExportTask[FiltersT], *, from_status: LogExportStatus) -> bool:
        """Update only a task in the expected state, preserving its remaining TTL."""
        key = self._key(tenant_id=task.tenant_id, app_id=task.app_id, task_id=task.task_id)
        transition = self._redis.register_script(_TRANSITION_LOG_EXPORT_TASK)
        return bool(transition(keys=[key], args=[from_status.value, task.model_dump_json()]))
