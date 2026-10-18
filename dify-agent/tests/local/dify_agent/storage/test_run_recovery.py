"""Real Redis create admission; uses the existing isolated CI Redis opt-in."""

import asyncio
import os
from uuid import UUID, uuid4

import pytest
from redis.asyncio import Redis

from dify_agent.storage.redis_run_store import RedisRunStore


@pytest.mark.integration
@pytest.mark.skipif(not os.environ.get("DIFY_AGENT_NATIVE_TEST_REDIS_URL"), reason="normal CI Redis only")
def test_real_redis_keyed_claim_lookup_conflict_expiry_and_corrupt_state():
    from dify_agent.protocol.run_recovery import LookupRunRequest
    from dify_agent.storage.redis_run_store import RunCreateConflictError, RunNotFoundError
    from dify_agent.storage.redis_keys import run_record_key

    async def exercise():
        redis = Redis.from_url(os.environ["DIFY_AGENT_NATIVE_TEST_REDIS_URL"])
        prefix = "create-ci-" + uuid4().hex
        store = RedisRunStore(redis, prefix=prefix)
        selection = LookupRunRequest(idempotency_key="private-key", request_digest="a" * 64)
        try:
            claims = await asyncio.gather(
                *(RedisRunStore(redis, prefix=prefix).claim_run(selection=selection) for _ in range(12))
            )
            assert sum(claim.inserted for claim in claims) == 1
            assert len({claim.record.run_id for claim in claims}) == 1
            run_id = claims[0].record.run_id
            assert UUID(run_id).version == 5
            assert await redis.keys(prefix + "*") == [run_record_key(prefix, run_id).encode()]
            raw = await redis.get(run_record_key(prefix, run_id))
            assert b"private-key" not in raw
            restarted = RedisRunStore(redis, prefix=prefix)
            result = await restarted.lookup_run(selection)
            assert (result.run_id, result.status) == (run_id, "running")
            conflict = selection.model_copy(update={"request_digest": "b" * 64})
            with pytest.raises(RunCreateConflictError):
                await restarted.claim_run(selection=conflict)
            with pytest.raises(RunCreateConflictError):
                await restarted.lookup_run(conflict)
            assert await redis.get(run_record_key(prefix, run_id)) == raw
            assert 0 < await redis.ttl(run_record_key(prefix, run_id)) <= store.run_retention_seconds
            await redis.set(run_record_key(prefix, run_id), "corrupt", ex=60)
            with pytest.raises(RunCreateConflictError):
                await restarted.lookup_run(selection)
            with pytest.raises(RunCreateConflictError):
                await restarted.claim_run(selection=selection)
            await redis.delete(run_record_key(prefix, run_id))
            await redis.rpush(run_record_key(prefix, run_id), "wrong Redis type")
            with pytest.raises(RunCreateConflictError):
                await restarted.lookup_run(selection)
            await redis.pexpire(run_record_key(prefix, run_id), 1)
            await asyncio.sleep(0.02)
            with pytest.raises(RunNotFoundError):
                await restarted.lookup_run(selection)
            assert not await redis.keys(prefix + "*")
            assert UUID((await restarted.create_run()).run_id).version == 4
        finally:
            keys = await redis.keys(prefix + "*")
            if keys:
                await redis.delete(*keys)
            await redis.aclose()

    asyncio.run(exercise())


@pytest.mark.integration
@pytest.mark.skipif(not os.environ.get("DIFY_AGENT_NATIVE_TEST_REDIS_URL"), reason="normal CI Redis only")
def test_real_redis_two_schedulers_and_lost_set_ack_do_not_replay():
    import httpx
    from redis.exceptions import ConnectionError as RedisConnectionError
    from dify_agent.protocol.run_recovery import LookupRunRequest, create_run_fingerprint
    from dify_agent.protocol.schemas import CreateRunRequest
    from dify_agent.runtime.context import Services
    from dify_agent.runtime.run_scheduler import RunScheduler
    from dify_agent.storage.redis_keys import run_record_key

    async def exercise():
        redis = Redis.from_url(os.environ["DIFY_AGENT_NATIVE_TEST_REDIS_URL"])
        prefix = "scheduler-ci-" + uuid4().hex
        executions = []
        release = asyncio.Event()

        class Runner:
            terminal_session_snapshot = None
            terminal_usage = None

            async def run(self):
                executions.append("executed")
                await release.wait()

        class LostAck:
            async def set(self, *args, **kwargs):
                await redis.set(*args, **kwargs)
                raise RedisConnectionError("accepted write, response lost")

        async with httpx.AsyncClient() as http:
            services = Services(plugin_daemon_http_client=http, dify_api_http_client=http)
            stores = [RedisRunStore(redis, prefix=prefix) for _ in range(2)]
            schedulers = [RunScheduler(store=s, services=services, runner_factory=lambda *_: Runner()) for s in stores]
            request = CreateRunRequest(composition={"layers": []}, idempotency_key="same")
            try:
                records = await asyncio.gather(*(s.create_run(request) for s in schedulers))
                await asyncio.sleep(0.01)
                assert records[0].run_id == records[1].run_id
                assert sum(len(s.active_tasks) for s in schedulers) == 1
                assert executions == ["executed"]
                # A separate accepted claim whose reply was lost never registers
                # a supervisor. Restart/lookup and even repeated create do not heal
                # that gap by dispatching a second time.
                lost = request.model_copy(update={"idempotency_key": "lost-before-schedule"})
                broken = RunScheduler(store=RedisRunStore(LostAck(), prefix=prefix), services=services)
                with pytest.raises(RedisConnectionError):
                    await broken.create_run(lost)
                assert broken.active_tasks == {}
                selection = LookupRunRequest(
                    idempotency_key=lost.idempotency_key, request_digest=create_run_fingerprint(lost)
                )
                recovered = await stores[1].lookup_run(selection)
                before_ttl = await redis.pttl(run_record_key(prefix, recovered.run_id))
                repeated = await schedulers[1].create_run(lost)
                assert repeated.run_id == recovered.run_id
                assert len(executions) == 1
                assert await redis.pttl(run_record_key(prefix, recovered.run_id)) <= before_ttl
            finally:
                release.set()
                for scheduler in schedulers:
                    await scheduler.shutdown()
                keys = await redis.keys(prefix + "*")
                if keys:
                    await redis.delete(*keys)
                await redis.aclose()

    asyncio.run(exercise())
