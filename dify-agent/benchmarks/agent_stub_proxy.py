"""Restricted reverse proxy for E2B callbacks into the benchmark Agent Stub."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
import os

from fastapi import FastAPI, Request
from fastapi.responses import Response, StreamingResponse
import httpx
from starlette.background import BackgroundTask


_HOP_BY_HOP_HEADERS = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
}
_RESPONSE_HEADERS = {
    "accept-ranges",
    "content-disposition",
    "content-range",
    "content-type",
    "etag",
    "last-modified",
    "location",
}


def create_app(
    *,
    upstream_base_url: str | None = None,
    fake_deps_base_url: str | None = None,
    transport: httpx.AsyncBaseTransport | None = None,
) -> FastAPI:
    """Create a proxy limited to Agent Stub and deterministic benchmark data."""
    upstream = (upstream_base_url or os.environ.get("BENCH_AGENT_STUB_UPSTREAM") or "http://agent:5050").rstrip("/")
    fake_deps_upstream = (
        fake_deps_base_url or os.environ.get("BENCH_FAKE_DEPS_UPSTREAM") or "http://fake-deps:5002"
    ).rstrip("/")

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        timeout = httpx.Timeout(connect=10, read=180, write=180, pool=10)
        async with (
            httpx.AsyncClient(
                base_url=upstream,
                timeout=timeout,
                transport=transport,
            ) as agent_client,
            httpx.AsyncClient(
                base_url=fake_deps_upstream,
                timeout=timeout,
                transport=transport,
            ) as fake_deps_client,
        ):
            app.state.agent_client = agent_client
            app.state.fake_deps_client = fake_deps_client
            yield

    proxy = FastAPI(
        docs_url=None,
        openapi_url=None,
        redoc_url=None,
        lifespan=lifespan,
    )

    @proxy.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @proxy.api_route(
        "/agent-stub/{path:path}",
        methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
    )
    async def forward_agent_stub(path: str, request: Request) -> Response:
        client: httpx.AsyncClient = request.app.state.agent_client
        return await _forward(client, f"/agent-stub/{path}", request)

    @proxy.api_route(
        "/benchmark-data/files/{path:path}",
        methods=["GET", "POST", "HEAD", "OPTIONS"],
    )
    async def forward_file_data(path: str, request: Request) -> Response:
        client: httpx.AsyncClient = request.app.state.fake_deps_client
        return await _forward(client, f"/__bench/files/{path}", request)

    async def _forward(
        client: httpx.AsyncClient,
        target: str,
        request: Request,
    ) -> Response:
        query = request.url.query
        if query:
            target = f"{target}?{query}"
        request_headers = {
            name: value
            for name, value in request.headers.items()
            if name.lower() not in _HOP_BY_HOP_HEADERS | {"host", "content-length"}
        }
        upstream_request = client.build_request(
            method=request.method,
            url=target,
            headers=request_headers,
            content=request.stream(),
        )
        upstream_response = await client.send(upstream_request, stream=True)
        response_headers = {
            name: value for name, value in upstream_response.headers.items() if name.lower() in _RESPONSE_HEADERS
        }
        return StreamingResponse(
            content=upstream_response.aiter_raw(),
            status_code=upstream_response.status_code,
            headers=response_headers,
            background=BackgroundTask(upstream_response.aclose),
        )

    return proxy


app = create_app()


__all__ = ["app", "create_app"]
