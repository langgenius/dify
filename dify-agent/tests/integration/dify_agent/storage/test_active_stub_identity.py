"""CI-only real Redis witness. Never collect/import this module in local checks."""

import asyncio
import json
import os
from uuid import uuid4

import pytest
from redis.asyncio import Redis

from dify_agent.protocol.native_testing import AgentRuntimeIdentitySeed
from dify_agent.runtime.native_continuation import NativeContinuationConflict
from dify_agent.storage.redis_keys import run_cancel_intent_key, run_record_key
from dify_agent.storage.redis_run_store import RedisRunStore

pytestmark = pytest.mark.integration


@pytest.fixture
def redis_url() -> str:
    """Require the Redis service configured by the owning CI job."""
    configured_url = os.environ.get("DIFY_AGENT_NATIVE_TEST_REDIS_URL")
    if not configured_url or not configured_url.strip():
        pytest.fail("DIFY_AGENT_NATIVE_TEST_REDIS_URL is required for the active Stub Redis witness", pytrace=False)
    return configured_url


@pytest.mark.parametrize(
    "mutation",
    [
        "live",
        "cancel_intent",
        "succeeded",
        "failed",
        "cancelled",
        "waiting",
        "generation",
        "digest",
        "run",
        "legacy",
        "native",
        "parent",
    ],
)
def test_active_stub_atomic_selection(redis_url, mutation):
    async def exercise():
        redis = Redis.from_url(redis_url)
        prefix = "stub-ci-" + str(uuid4())
        store = RedisRunStore(redis, prefix=prefix)
        record = await store.create_run(
            identity=AgentRuntimeIdentitySeed(execution_mode="ordinary", parent_node=None, request_digest="a" * 64)
        )
        selected = record.runtime_identity
        assert selected is not None
        try:
            raw = record.model_dump(mode="json")
            if mutation == "cancel_intent":
                await redis.set(run_cancel_intent_key(prefix, record.run_id), "cancelled")
            elif mutation in {"succeeded", "failed", "cancelled", "waiting"}:
                raw["status"] = mutation
            elif mutation == "generation":
                raw["native_generation"] = 1
            elif mutation == "digest":
                raw["runtime_identity"]["request_digest"] = "b" * 64
            elif mutation == "run":
                raw["runtime_identity"]["run_id"] = "other"
            elif mutation == "legacy":
                raw["runtime_identity"] = None
            elif mutation == "native":
                raw["runtime_identity"]["execution_mode"] = "builder_test"
            elif mutation == "parent":
                raw["runtime_identity"]["parent_node"] = {}
            await redis.set(run_record_key(prefix, record.run_id), json.dumps(raw))
            if mutation == "live":
                assert await store.read_active_stub_identity(selected) == selected
            else:
                with pytest.raises(NativeContinuationConflict):
                    await store.read_active_stub_identity(selected)
        finally:
            await redis.delete(run_record_key(prefix, record.run_id), run_cancel_intent_key(prefix, record.run_id))
            await redis.aclose()

    asyncio.run(exercise())


@pytest.mark.parametrize("mutation", ["live", "cancel_intent", "waiting", "generation", "parent"])
def test_confirmed_active_stub_atomic_selection(redis_url, mutation):
    async def exercise():
        redis = Redis.from_url(redis_url)
        prefix = "confirmed-stub-ci-" + str(uuid4())
        store = RedisRunStore(redis, prefix=prefix)
        identity = AgentRuntimeIdentitySeed(
            execution_mode="builder_test",
            native_test_profile="confirmed",
            request_digest="a" * 64,
            parent_node={
                "ref": {
                    "policy_version": "builder-native-test-v1",
                    "request_id": "request",
                    "invocation_id": "invocation",
                    "context_digest": "a" * 64,
                },
                "execution_id": "4c959aea-9025-4db9-9361-eed1191c11c7",
                "input_result_ref": "input",
                "input_digest": "b" * 64,
            },
        )
        record = await store.create_run(identity=identity)
        selected = record.runtime_identity
        try:
            raw = record.model_dump(mode="json")
            if mutation == "cancel_intent":
                await redis.set(run_cancel_intent_key(prefix, record.run_id), "cancelled")
            elif mutation == "waiting":
                raw["status"] = "waiting"
            elif mutation == "generation":
                raw["native_generation"] = 1
            elif mutation == "parent":
                raw["runtime_identity"]["parent_node"]["input_result_ref"] = "other"
            await redis.set(run_record_key(prefix, record.run_id), json.dumps(raw))
            if mutation == "live":
                assert await store.read_active_stub_identity(selected) == selected
            else:
                with pytest.raises(NativeContinuationConflict):
                    await store.read_active_stub_identity(selected)
        finally:
            await redis.delete(run_record_key(prefix, record.run_id), run_cancel_intent_key(prefix, record.run_id))
            await redis.aclose()

    asyncio.run(exercise())
