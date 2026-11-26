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
from dify_agent.storage.redis_run_store import RedisAgentResultStore, RedisRunStore, RunNotFoundError


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


# Selected checkpoint readback below is NORMAL-CI REDIS ONLY. Never collect this
# module locally to substitute fake replies for Lua/ACK/restart qualification.
async def _selected_wait_fixture(redis, prefix, *, generation=0):
    from dify_agent.protocol.native_continuation import ReadNativeCheckpointRequest

    store = RedisRunStore(redis, prefix=prefix)
    record = await store.create_run()
    cp = checkpoint(record.run_id)
    event_id = await store.persist_waiting(run_id=record.run_id, checkpoint=cp, event=cp.waiting_event())
    for current in range(generation):
        claim = await store.claim_continuation(
            run_id=record.run_id, expected_generation=current, idempotency_key=f"advance-{current}"
        )
        assert await store.start_continuation(claim)
        cp = cp.model_copy(update={"generation": current + 1})
        event_id = await store.persist_waiting(run_id=record.run_id, checkpoint=cp, event=cp.waiting_event())
    request = ReadNativeCheckpointRequest(
        ref=cp.ref,
        expected_generation=cp.generation,
        waiting_event_id=event_id,
        config_ref=cp.config_ref,
        config_digest=cp.config_digest,
    )
    return store, cp, request


async def _delete_selected_fixture(redis, prefix):
    keys = [key async for key in redis.scan_iter(match=prefix + "*")]
    if keys:
        await redis.delete(*keys)
    await redis.aclose()


@pytest.mark.integration
@pytest.mark.skipif(not os.environ.get("DIFY_AGENT_NATIVE_TEST_REDIS_URL"), reason="normal CI Redis only")
@pytest.mark.parametrize("generation", [0, 7])
def test_real_redis_selected_checkpoint_ack_and_fresh_process_read(generation):
    async def exercise():
        from dify_agent.storage.redis_keys import run_record_key

        redis = Redis.from_url(os.environ["DIFY_AGENT_NATIVE_TEST_REDIS_URL"])
        prefix = "native-selected-ci-" + uuid4().hex
        try:
            store, cp, request = await _selected_wait_fixture(redis, prefix, generation=generation)
            # Backend 0/7 is independent from a parent local2/shared3 occurrence.
            assert cp.generation == generation
            record = await store.get_run(cp.run_id)
            assert record.native_wait_event_id == request.waiting_event_id
            before = await redis.get(run_record_key(prefix, cp.run_id))
            first = await store.read_native_checkpoint(run_id=cp.run_id, request=request)
            second = await RedisRunStore(redis, prefix=prefix).read_native_checkpoint(run_id=cp.run_id, request=request)
            assert first == second
            assert first.checkpoint == cp
            assert first.waiting_event.id == request.waiting_event_id
            assert first.waiting_event.data.pending_actions[0].wait_reason == "configuration"
            assert before == await redis.get(run_record_key(prefix, cp.run_id))  # Reads do not create/claim/rewrite.
            child = await asyncio.create_subprocess_exec(
                sys.executable,
                "-c",
                r"""
import asyncio, os, sys
from redis.asyncio import Redis
from dify_agent.protocol.native_continuation import ReadNativeCheckpointRequest
from dify_agent.storage.redis_run_store import RedisRunStore
async def verify():
    redis = Redis.from_url(os.environ["DIFY_AGENT_NATIVE_TEST_REDIS_URL"])
    try:
        request = ReadNativeCheckpointRequest.model_validate_json(sys.argv[3])
        selected = await RedisRunStore(redis,prefix=sys.argv[1]).read_native_checkpoint(run_id=sys.argv[2],request=request)
        assert selected.checkpoint.generation == request.expected_generation
        assert selected.waiting_event.id == request.waiting_event_id
        assert selected.checkpoint.history[-1].parts[0].tool_call_id == "call-1"
        assert selected.checkpoint.result_refs == {"previous":"result-1"}
    finally:
        await redis.aclose()
asyncio.run(verify())
""",
                prefix,
                cp.run_id,
                request.model_dump_json(),
            )
            assert await child.wait() == 0
        finally:
            await _delete_selected_fixture(redis, prefix)

    asyncio.run(exercise())


@pytest.mark.integration
@pytest.mark.skipif(not os.environ.get("DIFY_AGENT_NATIVE_TEST_REDIS_URL"), reason="normal CI Redis only")
def test_real_redis_lost_wait_ack_discovers_exact_committed_event_without_republish():
    async def exercise():
        redis = Redis.from_url(os.environ["DIFY_AGENT_NATIVE_TEST_REDIS_URL"])
        prefix = "native-selected-ci-" + uuid4().hex
        try:
            from dify_agent.protocol.native_continuation import ReadNativeCheckpointRequest

            store = RedisRunStore(redis, prefix=prefix)
            record = await store.create_run()
            cp = checkpoint(record.run_id)

            class LoseReply:
                async def eval(self, *args):
                    await redis.eval(*args)
                    raise ConnectionError("synthetic lost postcommit ACK")

            with pytest.raises(ConnectionError):
                await RedisRunStore(LoseReply(), prefix=prefix).persist_waiting(
                    run_id=cp.run_id, checkpoint=cp, event=cp.waiting_event()
                )
            committed = await RedisRunStore(redis, prefix=prefix).get_run(cp.run_id)
            request = ReadNativeCheckpointRequest(
                ref=cp.ref,
                expected_generation=0,
                waiting_event_id=committed.native_wait_event_id,
                config_ref=cp.config_ref,
                config_digest=cp.config_digest,
            )
            selected = await store.read_native_checkpoint(run_id=cp.run_id, request=request)
            assert selected.checkpoint == cp
            assert selected.waiting_event.id == committed.native_wait_event_id
            with pytest.raises(NativeContinuationConflict):
                await store.persist_waiting(run_id=cp.run_id, checkpoint=cp, event=cp.waiting_event())
            assert len((await store.get_events(cp.run_id)).events) == 1
        finally:
            await _delete_selected_fixture(redis, prefix)

    asyncio.run(exercise())


@pytest.mark.integration
@pytest.mark.skipif(not os.environ.get("DIFY_AGENT_NATIVE_TEST_REDIS_URL"), reason="normal CI Redis only")
@pytest.mark.parametrize(
    "mutation",
    [
        "old_generation",
        "pruned_event",
        "foreign_run",
        "foreign_ref",
        "changed_config",
        "wrong_event",
        "expired",
        "oversized_record",
        "oversized_event",
        "altered_pending",
    ],
)
def test_real_redis_selected_checkpoint_refuses_actual_changed_or_unavailable_state(mutation):
    async def exercise():
        import json
        from dify_agent.storage.redis_keys import run_record_key, run_events_key

        redis = Redis.from_url(os.environ["DIFY_AGENT_NATIVE_TEST_REDIS_URL"])
        prefix = "native-selected-ci-" + uuid4().hex
        try:
            store, cp, request = await _selected_wait_fixture(redis, prefix)
            original_run_id = cp.run_id
            key = run_record_key(prefix, original_run_id)
            if mutation == "old_generation":
                claim = await store.claim_continuation(run_id=cp.run_id, expected_generation=0, idempotency_key="next")
                assert await store.start_continuation(claim)
                next_cp = cp.model_copy(update={"generation": 1})
                await store.persist_waiting(run_id=cp.run_id, checkpoint=next_cp, event=next_cp.waiting_event())
            elif mutation == "pruned_event":
                await redis.xdel(run_events_key(prefix, cp.run_id), request.waiting_event_id)
            elif mutation == "foreign_run":
                cp = cp.model_copy(update={"run_id": "foreign"})
            elif mutation == "foreign_ref":
                cp = cp.model_copy(update={"ref": cp.ref.model_copy(update={"request_id": "foreign"})})
            elif mutation == "changed_config":
                cp = cp.model_copy(update={"config_ref": "other"})
            elif mutation == "wrong_event":
                request = request.model_copy(update={"waiting_event_id": "1-0"})
            elif mutation == "expired":
                await redis.expire(key, 0)
            elif mutation == "oversized_record":
                await redis.set(key, b"x" * (2**21 + 16385))
            elif mutation in {"oversized_event", "altered_pending"}:
                event = cp.waiting_event()
                if mutation == "altered_pending":
                    raw = event.model_dump(mode="json", exclude={"id"})
                    raw["data"]["pending_actions"][0]["pending_operation_id"] = "foreign"
                    payload = json.dumps(raw)
                else:
                    payload = "x" * (2**20 + 1)
                replacement = await redis.xadd(run_events_key(prefix, cp.run_id), {"payload": payload})
                if isinstance(replacement, bytes):
                    replacement = replacement.decode()
                record = await store.get_run(cp.run_id)
                record.native_wait_event_id = replacement
                await redis.set(key, record.model_dump_json())
                request = request.model_copy(update={"waiting_event_id": replacement})
            if mutation in {"foreign_run", "foreign_ref", "changed_config"}:
                record = await store.get_run(original_run_id)
                record.native_checkpoint_json = cp.model_dump_json()
                await redis.set(key, record.model_dump_json())
            with pytest.raises((NativeContinuationConflict, RunNotFoundError)):
                await store.read_native_checkpoint(run_id=original_run_id, request=request)
        finally:
            await _delete_selected_fixture(redis, prefix)

    asyncio.run(exercise())


@pytest.mark.integration
@pytest.mark.skipif(not os.environ.get("DIFY_AGENT_NATIVE_TEST_REDIS_URL"), reason="normal CI Redis only")
@pytest.mark.parametrize("action", ["cancel", "start"])
def test_real_redis_atomic_read_race_never_mixes_wait_and_execution_generation(action):
    async def exercise():
        redis = Redis.from_url(os.environ["DIFY_AGENT_NATIVE_TEST_REDIS_URL"])
        prefix = "native-selected-ci-" + uuid4().hex
        try:
            store, cp, request = await _selected_wait_fixture(redis, prefix)
            claim = await store.claim_continuation(run_id=cp.run_id, expected_generation=0, idempotency_key="continue")
            # An unstarted claim is still the exact original waiting generation.
            assert (await store.read_native_checkpoint(run_id=cp.run_id, request=request)).checkpoint == cp
            gate = asyncio.Event()

            async def read():
                await gate.wait()
                try:
                    return await RedisRunStore(redis, prefix=prefix).read_native_checkpoint(
                        run_id=cp.run_id, request=request
                    )
                except NativeContinuationConflict:
                    return None

            async def mutate():
                await gate.wait()
                if action == "cancel":
                    await store.request_cancellation(cp.run_id, CancelRunRequest())
                else:
                    assert await store.start_continuation(claim)

            reads = asyncio.create_task(read())
            mutations = asyncio.create_task(mutate())
            gate.set()
            selected, _ = await asyncio.gather(reads, mutations)
            if selected is not None:
                assert selected.checkpoint == cp
                assert selected.waiting_event.id == request.waiting_event_id
            with pytest.raises(NativeContinuationConflict):
                await store.read_native_checkpoint(run_id=cp.run_id, request=request)
        finally:
            await _delete_selected_fixture(redis, prefix)

    asyncio.run(exercise())


@pytest.mark.skipif(not os.environ.get("DIFY_AGENT_NATIVE_TEST_REDIS_URL"), reason="normal CI Redis only")
def test_real_redis_initial_identity_persists_before_prepare_and_private_read_survives_restart():
    """NORMAL CI ONLY: actual Redis SET + bounded Lua, legacy unknown never ordinary."""
    from dify_agent.protocol.native_testing import AgentRuntimeIdentitySeed, ReadAgentRuntimeIdentity
    from dify_agent.storage.redis_keys import run_record_key

    async def exercise():
        redis = Redis.from_url(os.environ["DIFY_AGENT_NATIVE_TEST_REDIS_URL"])
        prefix = "s1-identity-" + str(uuid4())
        store = RedisRunStore(redis, prefix=prefix)
        ref = {
            "policy_version": "builder-native-test-v1",
            "request_id": "request-1",
            "invocation_id": "invocation-1",
            "context_digest": "a" * 64,
        }
        parent = {"ref": ref, "execution_id": str(uuid4()), "input_result_ref": "input", "input_digest": "b" * 64}
        seed = AgentRuntimeIdentitySeed(execution_mode="builder_test", parent_node=parent, request_digest="c" * 64)
        record = await store.create_run(identity=seed)
        selection = ReadAgentRuntimeIdentity(parent_node=parent, request_digest="c" * 64)
        restarted = RedisRunStore(redis, prefix=prefix)
        actual = await restarted.read_run_identity(run_id=record.run_id, selection=selection)
        assert actual.run_id == record.run_id and actual.agent_generation == 0
        assert actual.execution_mode == "builder_test" and actual.parent_node == selection.parent_node
        # A fresh interpreter reads the same persisted producer identity. No owner
        # object, scheduler task or in-process fixture state crosses this boundary.
        import json
        import subprocess

        child = await asyncio.to_thread(
            subprocess.run,
            [sys.executable, "-c", _READ_INITIAL_IDENTITY_CHILD, prefix, record.run_id, selection.model_dump_json()],
            check=True,
            capture_output=True,
            text=True,
        )
        assert json.loads(child.stdout) == actual.model_dump(mode="json")
        raw = await redis.get(run_record_key(prefix, record.run_id))
        assert b"composition" not in raw and b"credentials" not in raw
        for changed in [
            selection.model_copy(update={"request_digest": "d" * 64}),
            selection.model_copy(update={"parent_node": None}),
        ]:
            with pytest.raises(NativeContinuationConflict):
                await restarted.read_run_identity(run_id=record.run_id, selection=changed)
        legacy = await store.create_run()
        with pytest.raises(NativeContinuationConflict):
            await restarted.read_run_identity(
                run_id=legacy.run_id, selection=ReadAgentRuntimeIdentity(parent_node=None, request_digest="c" * 64)
            )
        ordinary = await store.create_run(
            identity=AgentRuntimeIdentitySeed(execution_mode="ordinary", parent_node=None, request_digest="e" * 64)
        )
        assert (
            await restarted.read_run_identity(
                run_id=ordinary.run_id, selection=ReadAgentRuntimeIdentity(parent_node=None, request_digest="e" * 64)
            )
        ).execution_mode == "ordinary"
        await redis.delete(
            run_record_key(prefix, record.run_id),
            run_record_key(prefix, legacy.run_id),
            run_record_key(prefix, ordinary.run_id),
        )
        await redis.aclose()

    asyncio.run(exercise())


_READ_INITIAL_IDENTITY_CHILD = """
import asyncio, os, sys
from redis.asyncio import Redis
from dify_agent.protocol.native_testing import ReadAgentRuntimeIdentity
from dify_agent.storage.redis_run_store import RedisRunStore
async def main():
    redis = Redis.from_url(os.environ["DIFY_AGENT_NATIVE_TEST_REDIS_URL"])
    store = RedisRunStore(redis, prefix=sys.argv[1])
    selected = await store.read_run_identity(run_id=sys.argv[2], selection=ReadAgentRuntimeIdentity.model_validate_json(sys.argv[3]))
    print(selected.model_dump_json())
    await redis.aclose()
asyncio.run(main())
"""
