"""Keyed admission claims stay on the same retention window as native record writes."""

import asyncio
import hashlib
import os
from uuid import uuid4

import pytest
from redis.asyncio import Redis

from dify_agent.protocol.run_recovery import LookupRunRequest
from dify_agent.storage.redis_keys import run_idempotency_key, run_record_key
from dify_agent.storage.redis_run_store import RedisRunStore
from tests.local.dify_agent.storage.test_native_continuation_store import checkpoint


@pytest.mark.integration
@pytest.mark.skipif(not os.environ.get("DIFY_AGENT_NATIVE_TEST_REDIS_URL"), reason="normal CI Redis only")
def test_real_redis_native_writes_refresh_only_their_own_admission_claim():
    async def exercise():
        redis = Redis.from_url(os.environ["DIFY_AGENT_NATIVE_TEST_REDIS_URL"], decode_responses=True)
        prefix = "keyed-native-ci-" + uuid4().hex
        store = RedisRunStore(redis, prefix=prefix, run_retention_seconds=60)
        fingerprint = "f" * 64
        claim_key = run_idempotency_key(prefix, hashlib.sha256(b"builder-key").hexdigest())
        try:
            record, created = await store.create_run_idempotent(
                idempotency_key="builder-key", request_fingerprint=fingerprint
            )
            assert created
            await redis.expire(claim_key, 5)
            cp = checkpoint(record.run_id)
            await store.persist_waiting(run_id=record.run_id, checkpoint=cp, event=cp.waiting_event())
            assert await redis.get(claim_key) == record.run_id
            assert 5 < await redis.ttl(claim_key) <= 60

            # A waiting keyed run is still the retained acceptance: replay and
            # lookup select it without scheduling or refreshing any TTL.
            await redis.expire(claim_key, 30)
            await redis.expire(run_record_key(prefix, record.run_id), 30)
            replay, created = await store.create_run_idempotent(
                idempotency_key="builder-key", request_fingerprint=fingerprint
            )
            assert (replay.run_id, replay.status, created) == (record.run_id, "waiting", False)
            selected = await store.lookup_run(
                LookupRunRequest(idempotency_key="builder-key", request_digest=fingerprint)
            )
            assert (selected.run_id, selected.status) == (record.run_id, "waiting")
            assert await redis.ttl(claim_key) <= 30
            assert await redis.ttl(run_record_key(prefix, record.run_id)) <= 30

            # An expired claim that a newer run already owns is never taken back.
            await redis.set(claim_key, "newer-run", ex=60)
            await store.claim_continuation(run_id=record.run_id, expected_generation=0, idempotency_key="continue")
            assert await redis.get(claim_key) == "newer-run"
        finally:
            keys = await redis.keys(prefix + "*")
            if keys:
                await redis.delete(*keys)
            await redis.aclose()

    asyncio.run(exercise())
