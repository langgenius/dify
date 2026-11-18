"""Durable tool quotas stored inside the owning Redis run record.

A Lua reservation checks run liveness, cancellation, call identity and remaining
quota in one operation. The record's existing expiry is retained, so event and
terminal writes automatically retain the quota for exactly the run lifetime.
No counter key can expire independently and recreate allowance during a run.
The adapter deliberately propagates Redis errors: uncertain admission never
permits external dispatch. It does not refund a reservation after interruption.
"""

from collections.abc import Awaitable
from typing import cast

from redis.asyncio import Redis

from dify_agent.runtime.tool_call_limits import (
    ToolCallLimitRunUnavailable,
    ToolCallReservation,
    ToolCallUsage,
    tool_call_digest,
    validate_tool_call_limit,
)
from dify_agent.storage.redis_keys import run_cancel_intent_key, run_record_key


_LOAD_ACTIVE_RUN = """
local record_json = redis.call("GET", KEYS[1])
if not record_json then
    return {-1, 0, "0"}
end
local record = cjson.decode(record_json)
if record.status ~= "running" or redis.call("EXISTS", KEYS[2]) == 1 then
    return {-1, 0, "0"}
end
local states = record.tool_call_limits
if type(states) ~= "table" then
    states = {}
end
local state = states[ARGV[1]]
"""

_RESERVE_SCRIPT = (
    _LOAD_ACTIVE_RUN
    + """
-- ARGV: tool digest, call digest, initial limit as decimal text, raw operation identity.
-- Return code: -1 unavailable run, 0 quota reached, 1 reserved, 2 duplicate.
if not state then
    state = {tool_identity=ARGV[4], limit=ARGV[3], used=0, call_ids={}}
end
if state.call_ids[ARGV[2]] then
    return {2, state.used, state.limit}
end
if state.used >= tonumber(state.limit) then
    return {0, state.used, state.limit}
end
state.used = state.used + 1
state.call_ids[ARGV[2]] = state.used
states[ARGV[1]] = state
record.tool_call_limits = states
redis.call("SET", KEYS[1], cjson.encode(record), "KEEPTTL")
return {1, state.used, state.limit}
"""
)

_USAGE_SCRIPT = (
    _LOAD_ACTIVE_RUN
    + """
-- ARGV: tool digest, initial limit as decimal text. Reads never refresh TTL.
if state then
    return {1, state.used, state.limit}
end
return {1, 0, ARGV[2]}
"""
)


class RedisToolCallLimitStore:
    """Reserve dispatch permission against an existing live run record."""

    def __init__(self, redis: Redis, *, prefix: str = "dify-agent") -> None:
        """Borrow the run server's Redis connection and matching key prefix."""
        self.redis = redis
        self.prefix = prefix

    async def reserve(self, *, run_id: str, tool_identity: str, tool_call_id: str, limit: int) -> ToolCallReservation:
        """Atomically reserve one slot or return an authoritative denial.

        Only a fresh successful reservation changes the run record, retaining
        its TTL. Missing/terminal/cancelling runs and Redis failures raise before
        the caller can dispatch; a successful reservation is never refunded.
        """
        validate_tool_call_limit(run_id, tool_identity, limit)
        code, used, frozen_limit = await self._execute(
            _RESERVE_SCRIPT,
            run_id,
            tool_call_digest(tool_identity),
            tool_call_digest(tool_call_id),
            str(limit),
            tool_identity,
        )
        if code == 1:
            return ToolCallReservation(used, frozen_limit, True)
        reason = "duplicate_tool_call" if code == 2 else "call_limit_reached"
        return ToolCallReservation(used, frozen_limit, False, reason)

    async def usage(self, *, run_id: str, tool_identity: str, limit: int) -> ToolCallUsage:
        """Read existing usage, preserving both quota state and run retention."""
        validate_tool_call_limit(run_id, tool_identity, limit)
        _code, used, frozen_limit = await self._execute(
            _USAGE_SCRIPT, run_id, tool_call_digest(tool_identity), str(limit)
        )
        return ToolCallUsage(used, frozen_limit)

    async def _execute(self, script: str, run_id: str, *arguments: str) -> tuple[int, int, int]:
        """Decode one atomic script response or fail closed for unavailable runs."""
        raw = await cast(
            Awaitable[object],
            self.redis.eval(
                script,
                2,
                run_record_key(self.prefix, run_id),
                run_cancel_intent_key(self.prefix, run_id),
                *arguments,
            ),
        )
        result = cast(list[int | str | bytes], raw)
        code = int(result[0])
        if code == -1:
            raise ToolCallLimitRunUnavailable("Tool dispatch requires an active run without a cancellation intent.")
        return code, int(result[1]), int(result[2])
