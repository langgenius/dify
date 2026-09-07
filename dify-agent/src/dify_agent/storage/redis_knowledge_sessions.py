"""Cross-process run leases, aggregate budgets and authenticated evidence receipts.

The standalone Stub and the run server use the same Redis namespace. Admission
and budget reservation are atomic; retries cannot duplicate model work. Session
heartbeats expire after worker death, while HITL budget/receipt state has a hard
two-hour lifetime and is never extended by commands.
"""

from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass
from uuid import uuid4

from redis.asyncio import Redis

from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig
from dify_agent.layers.knowledge_fs.session import KnowledgeFsDelivery, KnowledgeFsSession
from dify_agent.protocol.knowledge_fs import (
    KNOWLEDGE_FS_COMMAND_TIMEOUT,
    KNOWLEDGE_FS_MAX_COMMANDS,
    KNOWLEDGE_FS_MAX_IMAGES,
    KNOWLEDGE_FS_MAX_OUTPUT_BYTES,
    KNOWLEDGE_FS_RUN_BUDGET_TTL,
    KNOWLEDGE_FS_SESSION_TTL,
    KnowledgeFsBinding,
    KnowledgeFsCitation,
    KnowledgeFsError,
)
from dify_agent.storage.redis_keys import run_cancel_intent_key, run_record_key

_RESERVE = """
if redis.call('EXISTS', KEYS[1]) == 0 or redis.call('EXISTS', KEYS[2]) == 0 then return 'expired' end
local record = redis.call('GET', KEYS[3])
if not record or cjson.decode(record).status ~= 'running' or redis.call('EXISTS', KEYS[4]) == 1 then return 'cancelled' end
if redis.call('HEXISTS', KEYS[2], 'command:' .. ARGV[1]) == 1 then return 'replay' end
redis.call('ZREMRANGEBYSCORE', KEYS[5], '-inf', ARGV[2])
if redis.call('ZCARD', KEYS[5]) >= 2 then return 'concurrency' end
if tonumber(redis.call('HGET', KEYS[2], 'commands') or '0') >= tonumber(ARGV[4]) then return 'budget' end
if tonumber(redis.call('HGET', KEYS[2], 'time_ms') or '0') + 60000 > 600000 then return 'budget' end
redis.call('HINCRBY', KEYS[2], 'time_ms', 60000)
redis.call('HSET', KEYS[2], 'command:' .. ARGV[1], ARGV[2])
redis.call('HINCRBY', KEYS[2], 'commands', 1)
redis.call('ZADD', KEYS[5], ARGV[3], ARGV[1])
redis.call('EXPIRE', KEYS[5], 90)
return 'ok'
"""

_DELIVER = """
if redis.call('EXISTS', KEYS[1]) == 0 or redis.call('EXISTS', KEYS[2]) == 0 then return 0 end
local record = redis.call('GET', KEYS[5])
if not record or cjson.decode(record).status ~= 'running' or redis.call('EXISTS', KEYS[6]) == 1 then return 0 end
local bytes = tonumber(redis.call('HGET', KEYS[2], 'bytes') or '0') + tonumber(ARGV[1])
local images = tonumber(redis.call('HGET', KEYS[2], 'images') or '0') + tonumber(ARGV[2])
local imageBytes = tonumber(redis.call('HGET', KEYS[2], 'image_bytes') or '0') + tonumber(ARGV[3])
if bytes > tonumber(ARGV[4]) or images > tonumber(ARGV[5]) or imageBytes > 8388608 then return -1 end
redis.call('HSET', KEYS[2], 'bytes', bytes, 'images', images, 'image_bytes', imageBytes)
local ttl = redis.call('TTL', KEYS[2])
redis.call('RPUSH', KEYS[3], ARGV[6])
redis.call('EXPIRE', KEYS[3], ttl)
local citations = cjson.decode(ARGV[7])
for _, citation in ipairs(citations) do
  redis.call('HSET', KEYS[4], citation.id, cjson.encode(citation))
end
redis.call('EXPIRE', KEYS[4], ttl)
return 1
"""

_RELEASE = """
redis.call('ZREM', KEYS[1], ARGV[1])
local started = tonumber(redis.call('HGET', KEYS[2], 'command:' .. ARGV[1]))
if started then
  local elapsed = math.max(1, math.min(60000, math.ceil((tonumber(ARGV[2]) - started) * 1000)))
  redis.call('HINCRBY', KEYS[2], 'time_ms', elapsed - 60000)
  redis.call('HSET', KEYS[2], 'command:' .. ARGV[1], 'complete')
end
return 1
"""


@dataclass(slots=True)
class RedisKnowledgeSessionStore:
    redis: Redis
    prefix: str = "dify-agent"

    def _key(self, kind: str, identifier: str) -> str:
        return f"{self.prefix}:knowledge:{kind}:{identifier}"

    async def create(
        self,
        *,
        run_id: str,
        execution_context: DifyExecutionContextLayerConfig,
        bindings: list[KnowledgeFsBinding],
        agent_supports_vision: bool,
        resume_budget_id: str | None = None,
    ) -> KnowledgeFsSession:
        identity = execution_context.model_dump(exclude={"trace_id", "node_execution_id", "workflow_run_id"})
        fingerprint = hashlib.sha256(
            json.dumps(
                {
                    "context": identity,
                    "bindings": [item.model_dump() for item in bindings],
                    "vision": agent_supports_vision,
                },
                sort_keys=True,
            ).encode()
        ).hexdigest()
        budget_id = resume_budget_id or uuid4().hex
        budget_key = self._key("budget", budget_id)
        if resume_budget_id:
            actual = await self.redis.execute_command("HGET", budget_key, "identity")
            if isinstance(actual, bytes):
                actual = actual.decode()
            if actual != fingerprint:
                raise KnowledgeFsError(
                    "KNOWLEDGE_RESUME_EXPIRED", "Knowledge session expired or its scope changed; start a new run.", 409
                )
        else:
            async with self.redis.pipeline(transaction=True) as pipe:
                pipe.hset(budget_key, mapping={"identity": fingerprint, "commands": 0, "bytes": 0, "images": 0})
                pipe.expire(budget_key, KNOWLEDGE_FS_RUN_BUDGET_TTL)
                await pipe.execute()
        session = KnowledgeFsSession(
            id=uuid4().hex,
            budget_id=budget_id,
            run_id=run_id,
            execution_context=execution_context,
            bindings=bindings,
            agent_supports_vision=agent_supports_vision,
        )
        await self.redis.set(self._key("session", session.id), session.model_dump_json(), ex=KNOWLEDGE_FS_SESSION_TTL)
        return session

    async def refresh(self, session: KnowledgeFsSession) -> None:
        # XX avoids reviving a session that already expired or was cancelled.
        if not await self.redis.set(
            self._key("session", session.id), session.model_dump_json(), xx=True, ex=KNOWLEDGE_FS_SESSION_TTL
        ):
            raise KnowledgeFsError("KNOWLEDGE_SESSION_EXPIRED", "Knowledge run lease expired.", 409)

    async def close(self, session: KnowledgeFsSession) -> None:
        await self.redis.delete(self._key("session", session.id), self._key("deliveries", session.id))

    async def load(self, session_id: str) -> KnowledgeFsSession:
        if len(session_id) != 32 or any(char not in "0123456789abcdef" for char in session_id):
            raise KnowledgeFsError(
                "KNOWLEDGE_SESSION_EXPIRED", "Start a new shell call in an active knowledge run.", 403
            )
        raw = await self.redis.get(self._key("session", session_id))
        if raw is None:
            raise KnowledgeFsError("KNOWLEDGE_SESSION_EXPIRED", "Knowledge run lease expired.", 403)
        session = KnowledgeFsSession.model_validate_json(raw)
        record = await self.redis.get(run_record_key(self.prefix, session.run_id))
        # Cancellation intent is a stream, not a string, so check it separately.
        cancelled = await self.redis.exists(run_cancel_intent_key(self.prefix, session.run_id))
        if not record or json.loads(record).get("status") != "running" or cancelled:
            raise KnowledgeFsError("KNOWLEDGE_RUN_CANCELLED", "Knowledge run is no longer active.", 409)
        return session

    async def reserve(self, session: KnowledgeFsSession, command_id: str) -> None:
        now = time.time()
        outcome = await self.redis.execute_command(
            "EVAL",
            _RESERVE,
            5,
            self._key("session", session.id),
            self._key("budget", session.budget_id),
            run_record_key(self.prefix, session.run_id),
            run_cancel_intent_key(self.prefix, session.run_id),
            self._key("inflight", session.budget_id),
            command_id,
            now,
            now + KNOWLEDGE_FS_COMMAND_TIMEOUT + 5,
            KNOWLEDGE_FS_MAX_COMMANDS,
        )
        if isinstance(outcome, bytes):
            outcome = outcome.decode()
        if outcome != "ok":
            raise KnowledgeFsError(
                f"KNOWLEDGE_{str(outcome).upper()}",
                {
                    "replay": "Command ID was already executed. Inspect the earlier result; a new ID spends a new command.",
                    "concurrency": "At most two knowledge commands may run concurrently.",
                    "budget": "Knowledge command budget exhausted.",
                }.get(str(outcome), "Knowledge run is no longer active."),
                409 if outcome != "budget" else 429,
            )

    async def release(self, session: KnowledgeFsSession, command_id: str) -> None:
        await self.redis.execute_command(
            "EVAL",
            _RELEASE,
            2,
            self._key("inflight", session.budget_id),
            self._key("budget", session.budget_id),
            command_id,
            time.time(),
        )

    async def deliver(self, session: KnowledgeFsSession, delivery: KnowledgeFsDelivery) -> None:
        await self.load(session.id)
        size = len(delivery.result.model_dump_json().encode())
        image_bytes = len(delivery.image_base64 or "") * 3 // 4
        result = await self.redis.execute_command(
            "EVAL",
            _DELIVER,
            6,
            self._key("session", session.id),
            self._key("budget", session.budget_id),
            self._key("deliveries", session.id),
            self._key("citations", session.budget_id),
            run_record_key(self.prefix, session.run_id),
            run_cancel_intent_key(self.prefix, session.run_id),
            size,
            int(bool(delivery.image_base64)),
            image_bytes,
            KNOWLEDGE_FS_MAX_OUTPUT_BYTES,
            KNOWLEDGE_FS_MAX_IMAGES,
            delivery.model_dump_json(),
            json.dumps([citation.model_dump() for citation in delivery.result.citations]),
        )
        if result != 1:
            raise KnowledgeFsError(
                "KNOWLEDGE_OUTPUT_BUDGET", "Knowledge output/image budget exhausted or run expired.", 429
            )

    async def drain(self, session: KnowledgeFsSession) -> list[KnowledgeFsDelivery]:
        raw = await self.redis.execute_command("LPOP", self._key("deliveries", session.id), 2)
        return [KnowledgeFsDelivery.model_validate_json(item) for item in raw or []]

    async def citation(self, session: KnowledgeFsSession, receipt_id: str) -> KnowledgeFsCitation:
        raw = await self.redis.execute_command("HGET", self._key("citations", session.budget_id), receipt_id)
        if raw is None:
            raise KnowledgeFsError(
                "KNOWLEDGE_RECEIPT_INVALID", "Evidence receipt expired or belongs to another run.", 404
            )
        return KnowledgeFsCitation.model_validate_json(raw)
