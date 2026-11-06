"""Persisted profile readback through real Redis, FastAPI and the async SDK."""

import asyncio
import os
from uuid import uuid4

import httpx
import pytest
from fastapi import APIRouter, FastAPI
from pydantic import ValidationError
from redis.asyncio import Redis

from dify_agent.client import Client
from dify_agent.protocol.native_testing import AgentRuntimeIdentitySeed, ReadAgentRuntimeIdentity
from dify_agent.server.auth import create_bearer_token_dependency
from dify_agent.server.routes.native_testing import create_native_testing_router
from dify_agent.storage.redis_run_store import RedisRunStore
from tests.local.dify_agent.server.test_initial_identity import PARENT


def test_confirmed_identity_profile_is_explicit_and_cannot_describe_ordinary_run():
    seed = AgentRuntimeIdentitySeed(
        execution_mode="builder_test", parent_node=PARENT, request_digest="c" * 64, native_test_profile="confirmed"
    )
    assert seed.native_test_profile == "confirmed"
    assert (
        AgentRuntimeIdentitySeed(
            execution_mode="builder_test", parent_node=PARENT, request_digest="c" * 64
        ).native_test_profile
        == "isolated"
    )
    with pytest.raises(ValidationError):
        AgentRuntimeIdentitySeed(
            execution_mode="ordinary", parent_node=None, request_digest="c" * 64, native_test_profile="confirmed"
        )


@pytest.mark.parametrize("profile", ["isolated", "confirmed"])
def test_real_redis_authenticated_endpoint_sdk_preserves_saved_profile(profile):
    url = os.getenv("DIFY_AGENT_NATIVE_TEST_REDIS_URL")
    if not url:
        pytest.skip("Requires isolated DIFY_AGENT_NATIVE_TEST_REDIS_URL")

    async def exercise():
        prefix = "identity-profile-test:" + uuid4().hex
        redis = Redis.from_url(url)
        store = RedisRunStore(redis, prefix=prefix)
        try:
            record = await store.create_run(
                identity=AgentRuntimeIdentitySeed(
                    execution_mode="builder_test",
                    parent_node=PARENT,
                    request_digest="c" * 64,
                    native_test_profile=profile,
                )
            )
            restored = RedisRunStore(redis, prefix=prefix)
            app = FastAPI()
            protected = APIRouter(dependencies=[create_bearer_token_dependency("synthetic-token")])
            protected.include_router(create_native_testing_router(lambda: restored))
            app.include_router(protected)
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app)) as http:
                async with Client(
                    base_url="http://synthetic.invalid",
                    headers={"Authorization": "Bearer synthetic-token"},
                    async_http_client=http,
                ) as sdk:
                    identity = await sdk.read_run_identity(
                        record.run_id, ReadAgentRuntimeIdentity(parent_node=PARENT, request_digest="c" * 64)
                    )
            assert identity.native_test_profile == profile
            assert identity.run_id == record.run_id
            assert identity.parent_node.model_dump(mode="json") == PARENT
        finally:
            keys = [key async for key in redis.scan_iter(match=prefix + "*")]
            if keys:
                await redis.delete(*keys)
            await redis.aclose()

    asyncio.run(exercise())
