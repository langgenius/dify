"""Atomic Redis transitions for segment batch-import status hints."""

from typing import Literal, Protocol


class _RedisScript(Protocol):
    def __call__(self, *, keys: list[str], args: list[object]) -> object: ...


class RedisScripts(Protocol):
    def register_script(self, script: str) -> _RedisScript: ...


BATCH_TERMINAL_CAS_LUA = """
local current = redis.call('GET', KEYS[1])
if current ~= 'waiting' then
    return 0
end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
return 1
"""


def batch_status_key(job_id: str) -> str:
    return f"segment_batch_import_{job_id}"


def transition_batch_to_terminal(
    redis: RedisScripts,
    job_id: str,
    status: Literal["completed", "error"],
    *,
    ttl_seconds: int = 600,
) -> bool:
    """Move an existing batch from waiting to one immutable terminal state.

    A missing key is left missing. This prevents a delivery from an expired
    batch generation from recreating the cache hint as if it were current.
    """

    if ttl_seconds <= 0:
        raise ValueError("ttl_seconds must be positive")
    result = redis.register_script(BATCH_TERMINAL_CAS_LUA)(
        keys=[batch_status_key(job_id)],
        args=[status, ttl_seconds],
    )
    if not isinstance(result, (bytes, str, int)):
        raise TypeError(f"Expected Redis integer value, got {type(result).__name__}")
    return bool(int(result))
