"""Track opt-in and one delivery attempt for a completed CSV export."""

import logging
from datetime import datetime
from enum import StrEnum
from typing import TYPE_CHECKING, Protocol
from uuid import uuid4

from services.retention.log_export_task import LogExportKind, LogExportTaskNotFoundError

if TYPE_CHECKING:
    from extensions.ext_redis import RedisClientWrapper

logger = logging.getLogger(__name__)


class LogExportEmailState(StrEnum):
    """The public opt-in state for a task with a live download."""

    OFF = "off"
    WAITING = "waiting"
    QUEUED = "queued"


class DispatchLogExportEmail(Protocol):
    def __call__(
        self,
        *,
        tenant_id: str,
        app_id: str,
        task_id: str,
        export_kind: LogExportKind,
        requested_by: str,
        expires_at: datetime,
    ) -> None: ...


_CHANGE_EMAIL_STATE = """
local raw = redis.call("GET", KEYS[1])
if not raw then
    return {}
end
local task = cjson.decode(raw)
local operation = ARGV[1]
if operation ~= "get" and task.requested_by ~= ARGV[2] then
    return {}
end
if task.status == "failed" or task.status == "canceled" then
    return {"off"}
end
local state = redis.call("GET", KEYS[2]) or "off"
local reservation = "queued:" .. ARGV[3]
if state == reservation and (operation == "enable" or operation == "queue") then
    -- Redis may replay the command after it reserved the enqueue but lost the reply.
    return {"queued", task.expires_at}
end
if state ~= "off" and state ~= "waiting" then
    return {"queued"}
end
if operation == "get" then
    return {state}
end
if operation == "disable" then
    redis.call("DEL", KEYS[2])
    return {"off"}
end
if operation == "queue" and state == "off" then
    return {"off"}
end
local ttl = redis.call("PTTL", KEYS[1])
if task.status == "ready" then
    if ttl <= 0 then
        return {}
    end
    redis.call("SET", KEYS[2], reservation, "PX", ttl)
    return {"queued", task.expires_at}
end
if ttl == -1 then
    redis.call("SET", KEYS[2], "waiting")
elseif ttl > 0 then
    redis.call("SET", KEYS[2], "waiting", "PX", ttl)
else
    return {}
end
return {"waiting"}
"""

_RESTORE_EMAIL_REQUEST = """
if redis.call("GET", KEYS[1]) == "queued:" .. ARGV[1] then
    redis.call("SET", KEYS[1], "waiting", "KEEPTTL")
end
return 1
"""

_CLAIM_EMAIL_DELIVERY = """
local raw = redis.call("GET", KEYS[1])
if not raw then
    return 0
end
local task = cjson.decode(raw)
if task.status ~= "ready" or task.requested_by ~= ARGV[1] then
    return 0
end
local state = redis.call("GET", KEYS[2]) or ""
local claim = "claimed:" .. ARGV[2]
if state == claim then
    return 1
end
if string.sub(state, 1, 7) ~= "queued:" then
    return 0
end
redis.call("SET", KEYS[2], claim, "KEEPTTL")
return 1
"""


class LogExportEmailNotifications:
    """Keep preferences separate from the export worker's persisted task snapshots."""

    def __init__(self, *, redis: "RedisClientWrapper", dispatch: DispatchLogExportEmail) -> None:
        """Bind the task's Redis store and the mail queue publisher."""
        self._redis = redis
        self._dispatch = dispatch

    @staticmethod
    def _keys(tenant_id: str, app_id: str, task_id: str, export_kind: LogExportKind) -> tuple[str, str]:
        task_key = f"{export_kind.value}_log_export:{{{tenant_id}}}:{app_id}:{task_id}"
        return task_key, f"{task_key}:email"

    def get_state(
        self, *, tenant_id: str, app_id: str, task_id: str, export_kind: LogExportKind
    ) -> LogExportEmailState:
        """Read the email preference for an already admitted task, or OFF if unavailable."""
        change = self._redis.register_script(_CHANGE_EMAIL_STATE)
        result = change(keys=self._keys(tenant_id, app_id, task_id, export_kind), args=["get", "", ""])
        return LogExportEmailState(_text(result[0])) if result else LogExportEmailState.OFF

    def set_enabled(
        self,
        *,
        tenant_id: str,
        app_id: str,
        task_id: str,
        export_kind: LogExportKind,
        requested_by: str,
        enabled: bool,
    ) -> LogExportEmailState:
        """Set the requester's preference, publishing it if the CSV is already ready."""
        return self._change_and_dispatch(
            tenant_id=tenant_id,
            app_id=app_id,
            task_id=task_id,
            export_kind=export_kind,
            requested_by=requested_by,
            operation="enable" if enabled else "disable",
        )

    def queue_if_requested(
        self, *, tenant_id: str, app_id: str, task_id: str, export_kind: LogExportKind, requested_by: str
    ) -> LogExportEmailState:
        """Publish an existing opt-in after the export worker persisted the ready CSV."""
        return self._change_and_dispatch(
            tenant_id=tenant_id,
            app_id=app_id,
            task_id=task_id,
            export_kind=export_kind,
            requested_by=requested_by,
            operation="queue",
        )

    def _change_and_dispatch(
        self,
        *,
        tenant_id: str,
        app_id: str,
        task_id: str,
        export_kind: LogExportKind,
        requested_by: str,
        operation: str,
    ) -> LogExportEmailState:
        """Reserve one enqueue and restore it on publication failure if it is still unclaimed."""
        keys = self._keys(tenant_id, app_id, task_id, export_kind)
        token = uuid4().hex
        change = self._redis.register_script(_CHANGE_EMAIL_STATE)
        result = change(keys=keys, args=[operation, requested_by, token])
        if not result:
            if operation == "queue":
                return LogExportEmailState.OFF
            raise LogExportTaskNotFoundError()
        state = LogExportEmailState(_text(result[0]))
        if len(result) == 2:
            try:
                self._dispatch(
                    tenant_id=tenant_id,
                    app_id=app_id,
                    task_id=task_id,
                    export_kind=export_kind,
                    requested_by=requested_by,
                    expires_at=datetime.fromisoformat(_text(result[1])),
                )
            except Exception:
                # A worker may have accepted the message even if the producer did not get a response.
                try:
                    restore = self._redis.register_script(_RESTORE_EMAIL_REQUEST)
                    restore(keys=[keys[1]], args=[token])
                except Exception:
                    logger.exception("Could not restore the log export email preference for task %s", task_id)
                raise
        return state

    def claim_delivery(
        self, *, tenant_id: str, app_id: str, task_id: str, export_kind: LogExportKind, requested_by: str
    ) -> bool:
        """Give one mail worker the right to attempt delivery for a live ready export."""
        claim = self._redis.register_script(_CLAIM_EMAIL_DELIVERY)
        return bool(
            claim(
                keys=self._keys(tenant_id, app_id, task_id, export_kind),
                args=[requested_by, uuid4().hex],
            )
        )


def _text(value: str | bytes) -> str:
    return value.decode() if isinstance(value, bytes) else value
