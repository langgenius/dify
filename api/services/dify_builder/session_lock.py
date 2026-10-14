"""Cross-process Redis session-advance lock.

Acquired in the web process (dispatch) and released in the Celery process
(the dify_builder advance task). Because acquire and release happen on different
processes/objects, this cannot use ``redis_client.lock()``'s context
manager, which ties acquire+release to a single object. Instead this module
uses an explicit SET-NX-token + Lua compare-del, the same pattern used by
``services.oauth_device_flow`` for its device/user-code state machine.
"""

from __future__ import annotations

from typing import cast
from uuid import uuid4

from configs import dify_config
from extensions.ext_redis import redis_client
from extensions.redis_names import serialize_redis_name

_KEY_FMT = "dify_builder:advance:{session_id}"

# The dispatch lease covers queue delay. Once a worker starts, its lease must
# outlive the task's hard limit so it cannot expire while that worker can still
# mutate the session or draft.
_HARD_LIMIT_GRACE_SECONDS = 30
_ACTIVE_LEASE_GRACE_SECONDS = 60

# Atomic compare-del: only delete the lock if the caller still holds the
# token it was given on acquire. Prevents a slow/expired holder from
# deleting a lock that another process has since acquired.
_RELEASE_LUA = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end"
# Atomic compare-and-swap: the first worker presenting the dispatch token
# replaces it with its own owner value and extends the lease. A second delivery
# of the same token then no longer matches, and the bare dispatch token can no
# longer release (delete) the active worker's lease.
_ACTIVATE_LUA = """
if redis.call('get', KEYS[1]) == ARGV[1] then
    redis.call('set', KEYS[1], ARGV[2], 'PX', ARGV[3])
    return 1
else
    return 0
end
"""


def _key(session_id: str) -> str:
    return _KEY_FMT.format(session_id=session_id)


def _max_advance_ms() -> int:
    return dify_config.DIFY_BUILDER_MAX_ADVANCE_SECONDS * 1000


def active_advance_time_limit() -> int:
    """Hard task limit; shorter than the worker's active lock lease."""
    return dify_config.DIFY_BUILDER_MAX_ADVANCE_SECONDS + _HARD_LIMIT_GRACE_SECONDS


def acquire(session_id: str) -> str | None:
    """Try to acquire the advance lock for ``session_id``.

    Returns a token to be passed to :func:`release` if the lock was
    acquired, or ``None`` if another process already holds it.
    """
    token = str(uuid4())
    ok = redis_client.set(_key(session_id), token, nx=True, px=_max_advance_ms())
    return token if ok else None


def activate(session_id: str, token: str) -> str | None:
    """Claim an enqueued command at worker start; return the owner value, or ``None``.

    Exactly one worker can activate a dispatch token: the atomic swap replaces
    it with a fresh owner value and extends the lease, so a duplicate delivery
    of the same command, a command that sat in the queue past its dispatch
    lease, or an expired worker gets ``None`` and must not run or release.
    Only the returned owner value releases an activated lease.
    """
    active_ms = (dify_config.DIFY_BUILDER_MAX_ADVANCE_SECONDS + _ACTIVE_LEASE_GRACE_SECONDS) * 1000
    owner = f"{token}:{uuid4()}"
    activated = redis_client.eval(_ACTIVATE_LUA, 1, serialize_redis_name(_key(session_id)), token, owner, active_ms)
    return owner if activated else None


def release(session_id: str, token: str) -> None:
    """Release the advance lock for ``session_id`` iff ``token`` matches the
    holder currently recorded in Redis (compare-del). A no-op if the lock
    was already released, expired, or is held by a different value.

    Before activation the holder is the dispatch token (web-process refusal or
    enqueue failure); after activation only the worker's owner value matches.
    """
    # RedisClientWrapper prefixes .set/.get, but .eval is delegated to the raw client — serialize
    # the key ourselves so it matches acquire()'s written key.
    redis_client.eval(_RELEASE_LUA, 1, serialize_redis_name(_key(session_id)), token)


def exists(session_id: str) -> bool:
    """Whether the advance lock for ``session_id`` is currently held."""
    return redis_client.get(_key(session_id)) is not None


def current_owner(session_id: str) -> str | None:
    """Current dispatch/worker lease value, or None once the command is released."""
    value = cast(str | bytes | None, redis_client.get(_key(session_id)))
    return value.decode() if isinstance(value, bytes) else value
