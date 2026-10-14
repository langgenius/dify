"""Recover the full observed progress of the worker that still owns a session.

Snapshots are short-lived Redis state, separate from durable conversation rows.
Each activated lease has its own tenant/session key, so an expired worker can
never overwrite its replacement's progress. Reads check the lease again after
loading; a command that settled or changed owners cannot restore stale work.
"""

import json
from dataclasses import asdict, dataclass

from pydantic import TypeAdapter

from core.dify_builder.contract import ExecutionProgress
from extensions.ext_redis import redis_client
from extensions.redis_names import serialize_redis_name
from services.dify_builder import session_lock


@dataclass(frozen=True)
class ProgressSnapshot:
    session_id: str
    operation_id: str
    at_version: int
    revision: int
    reply_language: str
    execution: ExecutionProgress


_ADAPTER = TypeAdapter(ProgressSnapshot)
_SAVE_LUA = """
local prior = redis.call('get', KEYS[1])
if prior then
    local previous = cjson.decode(prior)
    if previous.at_version > tonumber(ARGV[1]) then
        return 0
    end
    if previous.at_version == tonumber(ARGV[1]) and previous.operation_id == ARGV[2]
        and previous.revision >= tonumber(ARGV[3]) then
        return 0
    end
end
redis.call('set', KEYS[1], ARGV[4], 'EX', ARGV[5])
return 1
"""


def _key(tenant_id: str, session_id: str, owner: str) -> str:
    return f"dify_builder:progress:{tenant_id}:{session_id}:{owner}"


def save(snapshot: ProgressSnapshot, *, tenant_id: str, owner: str) -> None:
    """Save a cumulative snapshot without regressing its operation/version.

    ``owner`` is the activated lease returned to this worker, never a queued
    dispatch token or a client value. Single-key Lua also works on Redis Cluster.
    The TTL covers the worker hard limit and bounds abandoned snapshot storage.
    """
    redis_client.eval(
        _SAVE_LUA,
        1,
        serialize_redis_name(_key(tenant_id, snapshot.session_id, owner)),
        snapshot.at_version,
        snapshot.operation_id,
        snapshot.revision,
        json.dumps(asdict(snapshot)),
        session_lock.active_advance_time_limit(),
    )


def read(*, tenant_id: str, session_id: str) -> ProgressSnapshot | None:
    """Read after session authorization; None means no current worker snapshot."""
    owner = session_lock.current_owner(session_id)
    if owner is None:
        return None
    raw = redis_client.get(_key(tenant_id, session_id, owner))
    if raw is None or session_lock.current_owner(session_id) != owner:
        return None
    return _ADAPTER.validate_json(raw)
