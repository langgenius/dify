"""Cross-process Redis session-advance lock.

Acquired in the web process (dispatch) and released in the Celery process
(the copilot advance task). Because acquire and release happen on different
processes/objects, this cannot use ``redis_client.lock()``'s context
manager, which ties acquire+release to a single object. Instead this module
uses an explicit SET-NX-token + Lua compare-del, the same pattern used by
``services.oauth_device_flow`` for its device/user-code state machine.
"""

from __future__ import annotations

from uuid import uuid4

from configs import dify_config
from extensions.ext_redis import redis_client

_KEY_FMT = "workflow_copilot:advance:{session_id}"

# Atomic compare-del: only delete the lock if the caller still holds the
# token it was given on acquire. Prevents a slow/expired holder from
# deleting a lock that another process has since acquired.
_RELEASE_LUA = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end"


def _key(session_id: str) -> str:
    return _KEY_FMT.format(session_id=session_id)


def _max_advance_ms() -> int:
    return dify_config.WORKFLOW_COPILOT_MAX_ADVANCE_SECONDS * 1000


def acquire(session_id: str) -> str | None:
    """Try to acquire the advance lock for ``session_id``.

    Returns a token to be passed to :func:`release` if the lock was
    acquired, or ``None`` if another process already holds it.
    """
    token = str(uuid4())
    ok = redis_client.set(_key(session_id), token, nx=True, px=_max_advance_ms())
    return token if ok else None


def release(session_id: str, token: str) -> None:
    """Release the advance lock for ``session_id`` iff ``token`` matches the
    holder currently recorded in Redis (compare-del). A no-op if the lock
    was already released, expired, or is held by a different token.
    """
    redis_client.eval(_RELEASE_LUA, 1, _key(session_id), token)


def exists(session_id: str) -> bool:
    """Whether the advance lock for ``session_id`` is currently held."""
    return redis_client.get(_key(session_id)) is not None
