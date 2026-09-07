"""Standalone FastAPI application factory for the Dify Agent Stub server.

The standalone stub server is only a convenience wrapper around the shared
router. It reuses the main ``ServerSettings`` model and derives the Agent Stub
token codec plus optional file and config request bridges from the same helper
methods that the standard run server uses before mounting
``create_agent_stub_router(...)``.
"""

from __future__ import annotations

from fastapi import FastAPI
from contextlib import asynccontextmanager
from typing import TypedDict
import httpx
from redis.asyncio import Redis

from dify_agent.agent_stub.server.router import create_agent_stub_router
from dify_agent.server.settings import ServerSettings
from dify_agent.storage.redis_knowledge_sessions import RedisKnowledgeSessionStore
from dify_agent.agent_stub.server.knowledge import AgentStubKnowledgeHandler


class _KnowledgeResources(TypedDict, total=False):
    store: RedisKnowledgeSessionStore
    client: httpx.AsyncClient


def create_agent_stub_app(settings: ServerSettings | None = None) -> FastAPI:
    """Build the standalone FastAPI app for authenticated stub endpoints."""
    resolved_settings = settings or ServerSettings()
    state: _KnowledgeResources = {}

    @asynccontextmanager
    async def lifespan(_app):
        async with (
            Redis.from_url(resolved_settings.redis_url) as redis,
            httpx.AsyncClient(
                timeout=resolved_settings.create_outbound_http_timeout(),
                trust_env=False,
            ) as client,
        ):
            state["store"] = RedisKnowledgeSessionStore(redis, prefix=resolved_settings.redis_prefix)
            state["client"] = client
            yield
            state.pop("store", None)
            state.pop("client", None)

    handler = (
        AgentStubKnowledgeHandler(
            get_store=lambda: state["store"],
            get_http_client=lambda: state["client"],
            inner_api_url=resolved_settings.inner_api_url,
            inner_api_key=resolved_settings.inner_api_key or "",
        )
        if resolved_settings.inner_api_key
        else None
    )
    app = FastAPI(title="Dify Agent Stub Server", version="0.1.0", lifespan=lifespan)
    app.include_router(
        create_agent_stub_router(
            token_codec=resolved_settings.create_agent_stub_token_codec(),
            file_request_handler=resolved_settings.create_agent_stub_file_request_handler(),
            config_request_handler=resolved_settings.create_agent_stub_config_request_handler(),
            knowledge_request_handler=handler,
        )
    )
    return app


app = create_agent_stub_app()


__all__ = ["app", "create_agent_stub_app"]
