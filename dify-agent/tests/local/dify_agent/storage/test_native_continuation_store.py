"""Redis Lua cases run only against normal CI's provisioned Redis.

Set DIFY_AGENT_NATIVE_TEST_REDIS_URL to an isolated CI Redis database. Tests use
unique key prefixes, never FLUSHDB. Local fake replies test transport only, not
Lua atomicity or durability. Restart below means application/store restart.
"""

import asyncio
import os
import sys
from uuid import uuid4

import pytest
from redis.asyncio import Redis

from dify_agent.protocol.schemas import CancelRunRequest
from dify_agent.runtime.native_continuation import AgentCheckpoint, NativeContinuationConflict
from dify_agent.storage.redis_run_store import RedisRunStore, RedisAgentResultStore


def checkpoint(run_id="run-1", generation=0):
    return AgentCheckpoint.model_validate(
        {
            "run_id": run_id,
            "generation": generation,
            "ref": {
                "policy_version": "builder-native-test-v1",
                "request_id": "request-1",
                "invocation_id": "invocation-1",
                "context_digest": "a" * 64,
            },
            "stage": "tool",
            "pending_calls": [
                {
                    "call_id": "call-1",
                    "tool_name": "write",
                    "stage": "tool",
                    "pending_operation_id": "pending-1",
                    "wait_reason": "configuration",
                    "intent": {
                        "key": {"invocation_id": "invocation-1", "occurrence_path": ["tool", "call-1"], "cursor": 0},
                        "kind": "tool",
                        "resource_ref": "tool-1",
                        "implementation_revision": "revision-1",
                        "account_ref": None,
                        "target": {"table": "t"},
                        "parameters": {"values": [True, 1]},
                        "input_digest": "b" * 64,
                        "capability_digest": "c" * 64,
                    },
                }
            ],
            "history": [
                {
                    "kind": "response",
                    "parts": [
                        {
                            "part_kind": "tool-call",
                            "tool_name": "write",
                            "args": {"values": [True, 1]},
                            "tool_call_id": "call-1",
                        }
                    ],
                }
            ],
            "operation_cursor": 1,
            "result_refs": {"previous": "result-1"},
            "job_refs": ["job-1"],
            "config_digest": "d" * 64,
            "config_ref": "config-1",
            "session_snapshot": {"schema_version": 2, "layers": {}},
        }
    )


def test_persistence_failure_cannot_publish_waiting():
    class OfflineRedis:
        async def eval(self, *args):
            raise ConnectionError("offline")

    async def exercise():
        store = RedisRunStore(OfflineRedis())
        cp = checkpoint()
        with pytest.raises(ConnectionError):
            await store.persist_waiting(run_id="run-1", checkpoint=cp, event=cp.waiting_event())

    asyncio.run(exercise())


def test_mismatched_waiting_event_rejected_before_redis():
    async def exercise():
        store = RedisRunStore(None)
        cp = checkpoint()
        with pytest.raises(NativeContinuationConflict):
            await store.persist_waiting(run_id="another-run", checkpoint=cp, event=cp.waiting_event())

    asyncio.run(exercise())


@pytest.mark.integration
@pytest.mark.skipif(not os.environ.get("DIFY_AGENT_NATIVE_TEST_REDIS_URL"), reason="normal CI Redis only")
def test_real_redis_atomic_claim_restart_stale_generation_and_cancellation():
    async def exercise():
        redis = Redis.from_url(os.environ["DIFY_AGENT_NATIVE_TEST_REDIS_URL"])
        prefix = "native-ci-" + uuid4().hex
        store = RedisRunStore(redis, prefix=prefix)
        try:
            record = await store.create_run()
            cp = checkpoint(record.run_id)
            await store.persist_waiting(run_id=record.run_id, checkpoint=cp, event=cp.waiting_event())
            restarted = RedisRunStore(redis, prefix=prefix)
            restored = await restarted.get_checkpoint(record.run_id)
            assert restored == cp
            # A fresh application process must recover protected state solely
            # from real Redis; this is not merely a reconstructed test double.
            child = await asyncio.create_subprocess_exec(
                sys.executable,
                "-c",
                """
import asyncio, os, sys
from redis.asyncio import Redis
from dify_agent.storage.redis_run_store import RedisRunStore
async def verify():
    redis = Redis.from_url(os.environ["DIFY_AGENT_NATIVE_TEST_REDIS_URL"])
    try:
        store = RedisRunStore(redis, prefix=sys.argv[1])
        cp = await store.get_checkpoint(sys.argv[2])
        assert cp.pending_calls[0].call_id == "call-1"
        assert cp.pending_calls[0].wait_reason == "configuration"
        assert cp.history[-1].parts[0].tool_call_id == "call-1"
        assert cp.result_refs == {"previous": "result-1"}
        assert cp.job_refs == ("job-1",)
        assert cp.config_ref == "config-1"
        assert (await store.get_run(sys.argv[2])).status == "waiting"
    finally:
        await redis.aclose()
asyncio.run(verify())
""",
                prefix,
                record.run_id,
            )
            assert await child.wait() == 0
            assert (await restarted.get_run(record.run_id)).status == "waiting"
            claims = await asyncio.gather(
                *(
                    restarted.claim_continuation(
                        run_id=record.run_id, expected_generation=0, idempotency_key="continue-1"
                    )
                    for _ in range(12)
                )
            )
            assert len({c.claim_id for c in claims}) == 1
            with pytest.raises(NativeContinuationConflict):
                await restarted.claim_continuation(run_id=record.run_id, expected_generation=1, idempotency_key="stale")
            with pytest.raises(NativeContinuationConflict):
                await restarted.claim_continuation(
                    run_id=record.run_id, expected_generation=0, idempotency_key="different"
                )
            # Lost enqueue acknowledgement is recoverable with the same claim.
            restarted = RedisRunStore(redis, prefix=prefix)
            assert (
                await restarted.claim_continuation(
                    run_id=record.run_id, expected_generation=0, idempotency_key="continue-1"
                )
                == claims[0]
            )
            starts = await asyncio.gather(*(restarted.start_continuation(claims[0]) for _ in range(12)))
            assert sum(starts) == 1
            page = await restarted.get_events(record.run_id)
            assert [e.type for e in page.events] == ["run_waiting", "run_resumed"]
            assert page.events[0].data.pending_actions[0].wait_reason == "configuration"
            # A second wait advances generation; cancellation wins before start.
            cp2 = cp.model_copy(update={"generation": 1})
            await restarted.persist_waiting(run_id=record.run_id, checkpoint=cp2, event=cp2.waiting_event())
            claim2 = await restarted.claim_continuation(
                run_id=record.run_id, expected_generation=1, idempotency_key="continue-2"
            )
            await restarted.request_cancellation(record.run_id, CancelRunRequest())
            with pytest.raises(NativeContinuationConflict):
                await restarted.start_continuation(claim2)
            intent = await restarted.get_cancellation_intent(record.run_id)
            await restarted.finalize_cancellation(record.run_id, intent)
            with pytest.raises(NativeContinuationConflict):
                await restarted.claim_continuation(
                    run_id=record.run_id, expected_generation=1, idempotency_key="continue-2"
                )
            assert (await restarted.get_run(record.run_id)).status == "cancelled"
            denied = await restarted.create_run()
            denied_cp = checkpoint(denied.run_id)
            await restarted.persist_waiting(run_id=denied.run_id, checkpoint=denied_cp, event=denied_cp.waiting_event())
            await restarted.stop_native_run(run_id=denied.run_id, expected_generation=0, reason_code="approval_denied")
            assert (await restarted.get_run(denied.run_id)).status == "failed"
            assert (await restarted.get_events(denied.run_id)).events[-1].data.reason == "approval_denied"

        finally:
            keys = [key async for key in redis.scan_iter(match=prefix + "*")]
            if keys:
                await redis.delete(*keys)
            await redis.aclose()

    asyncio.run(exercise())


@pytest.mark.integration
@pytest.mark.skipif(not os.environ.get("DIFY_AGENT_NATIVE_TEST_REDIS_URL"), reason="normal CI Redis only")
def test_real_redis_result_store_owner_bound_and_restart():
    async def exercise():
        redis = Redis.from_url(os.environ["DIFY_AGENT_NATIVE_TEST_REDIS_URL"])
        prefix = "native-ci-" + uuid4().hex
        cp = checkpoint()
        try:
            store = RedisAgentResultStore(redis, ref=cp.ref, prefix=prefix)
            key = cp.pending_calls[0].intent.key
            result_ref = await store.store(ref=cp.ref, key=key, result={"rows": [1, True]})
            assert await RedisAgentResultStore(redis, ref=cp.ref, prefix=prefix).load(result_ref) == {"rows": [1, True]}
            other = cp.ref.model_copy(update={"invocation_id": "other"})
            with pytest.raises(NativeContinuationConflict):
                await RedisAgentResultStore(redis, ref=other, prefix=prefix).load(result_ref)
            with pytest.raises(NativeContinuationConflict):
                await store.store(ref=cp.ref, key=key, result={"rows": [2]})
            with pytest.raises(ValueError):
                await store.store(ref=cp.ref, key=key, result="x" * (2**20 + 1))
        finally:
            keys = [key async for key in redis.scan_iter(match=prefix + "*")]
            if keys:
                await redis.delete(*keys)
            await redis.aclose()

    asyncio.run(exercise())
