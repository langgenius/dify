"""FastAPI application exposing the Codex CLI through A2A 1.0 HTTP+JSON."""

from __future__ import annotations

import hmac
import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, Header, Query
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, StreamingResponse

from .models import (
    A2A_MEDIA_TYPE,
    A2A_PROTOCOL_VERSION,
    BridgeProblem,
    InvalidMessageError,
    SendMessageRequest,
    UnauthorizedError,
    VersionNotSupportedError,
)
from .runtime import CodexA2ARuntime
from .settings import CodexBridgeSettings


BRIDGE_VERSION = "0.1.0"


def create_app(
    settings: CodexBridgeSettings,
    runtime: CodexA2ARuntime | None = None,
) -> FastAPI:
    """Create the local bridge with one process-local task ledger."""
    resolved_runtime = runtime or CodexA2ARuntime(settings)

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        try:
            yield
        finally:
            await resolved_runtime.shutdown()

    app = FastAPI(
        title="Local Codex A2A Bridge",
        version=BRIDGE_VERSION,
        lifespan=lifespan,
    )
    app.state.codex_a2a_runtime = resolved_runtime

    @app.exception_handler(BridgeProblem)
    async def handle_bridge_problem(_request, exc: BridgeProblem):  # type: ignore[no-untyped-def]
        return _a2a_error_response(exc)

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(_request, _exc: RequestValidationError):  # type: ignore[no-untyped-def]
        return _a2a_error_response(InvalidMessageError("Request payload validation error"))

    async def require_protocol_version(
        version: Annotated[str | None, Header(alias="A2A-Version")] = None,
    ) -> None:
        if version is not None and version != A2A_PROTOCOL_VERSION:
            raise VersionNotSupportedError(version)

    async def require_auth(
        authorization: Annotated[str | None, Header()] = None,
    ) -> None:
        if settings.api_token is None:
            return
        expected = f"Bearer {settings.api_token.get_secret_value()}"
        if authorization is None or not hmac.compare_digest(authorization, expected):
            raise UnauthorizedError()

    operation_dependencies = [Depends(require_protocol_version), Depends(require_auth)]

    @app.get("/.well-known/agent-card.json")
    async def get_agent_card() -> JSONResponse:
        card = _agent_card(settings)
        return JSONResponse(
            content=card,
            media_type=A2A_MEDIA_TYPE,
            headers={
                "Cache-Control": "public, max-age=60",
                "ETag": f'"codex-a2a-bridge-{BRIDGE_VERSION}"',
            },
        )

    @app.post("/message:send", dependencies=operation_dependencies)
    async def send_message(request: SendMessageRequest) -> JSONResponse:
        record, _created = await resolved_runtime.start(request)
        if not request.configuration.return_immediately:
            await record.done.wait()
        return _a2a_response({"task": record.to_dict(history_length=request.configuration.history_length)})

    @app.post("/message:stream", dependencies=operation_dependencies)
    async def stream_message(request: SendMessageRequest) -> StreamingResponse:
        record, _created = await resolved_runtime.start(request)
        return StreamingResponse(
            _sse_events(resolved_runtime.stream(record.id)),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
            },
        )

    @app.get("/tasks/{task_id}:subscribe", dependencies=operation_dependencies)
    async def subscribe_task(task_id: str) -> StreamingResponse:
        # Preparation happens before StreamingResponse sends headers, allowing a
        # terminal task to return a normal A2A error rather than a broken stream.
        subscription = await resolved_runtime.prepare_subscription(task_id)
        return StreamingResponse(
            _sse_events(resolved_runtime.stream_subscription(subscription)),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
            },
        )

    @app.get("/tasks/{task_id}", dependencies=operation_dependencies)
    async def get_task(
        task_id: str,
        history_length: Annotated[int | None, Query(alias="historyLength", ge=0)] = None,
    ) -> JSONResponse:
        return _a2a_response(resolved_runtime.get(task_id).to_dict(history_length=history_length))

    @app.post("/tasks/{task_id}:cancel", dependencies=operation_dependencies)
    async def cancel_task(task_id: str) -> JSONResponse:
        record = await resolved_runtime.cancel(task_id)
        return _a2a_response(record.to_dict())

    return app


def _agent_card(settings: CodexBridgeSettings) -> dict[str, object]:
    card: dict[str, object] = {
        "name": "Local Codex Agent",
        "description": "Runs the locally installed Codex CLI inside one server-configured workspace.",
        "supportedInterfaces": [
            {
                "url": settings.public_url,
                "protocolBinding": "HTTP+JSON",
                "protocolVersion": A2A_PROTOCOL_VERSION,
            }
        ],
        "version": BRIDGE_VERSION,
        "capabilities": {
            "streaming": settings.streaming_enabled,
            "pushNotifications": False,
            "extendedAgentCard": False,
        },
        "securitySchemes": {},
        "securityRequirements": [],
        "defaultInputModes": ["text/plain"],
        "defaultOutputModes": ["text/plain"],
        "skills": [
            {
                "id": "codex-workspace-agent",
                "name": "Codex workspace agent",
                "description": "Analyzes and changes code within the configured local workspace.",
                "tags": ["coding", "codex", "local-workspace"],
                "examples": ["Explain this repository", "Implement the requested change and run tests"],
                "inputModes": ["text/plain"],
                "outputModes": ["text/plain"],
            }
        ],
    }
    if settings.api_token is not None:
        card["securitySchemes"] = {
            "bearerAuth": {
                "httpAuthSecurityScheme": {
                    "description": "Bearer token configured by the bridge operator.",
                    "scheme": "Bearer",
                }
            }
        }
        card["securityRequirements"] = [{"schemes": {"bearerAuth": {"list": []}}}]
    return card


def _a2a_response(content: object) -> JSONResponse:
    return JSONResponse(content=content, media_type=A2A_MEDIA_TYPE)


def _a2a_error_response(error: BridgeProblem) -> JSONResponse:
    error_info: dict[str, object] = {
        "@type": "type.googleapis.com/google.rpc.ErrorInfo",
        "reason": error.reason,
        "domain": "a2a-protocol.org",
    }
    if error.metadata:
        error_info["metadata"] = error.metadata
    return JSONResponse(
        status_code=error.status,
        media_type=A2A_MEDIA_TYPE,
        headers=error.headers,
        content={
            "error": {
                "code": error.status,
                "status": error.status_name,
                "message": error.detail,
                "details": [error_info],
            }
        },
    )


async def _sse_events(events: AsyncIterator[object]) -> AsyncIterator[str]:
    async for event in events:
        yield f"data: {json.dumps(event, ensure_ascii=False, separators=(',', ':'))}\n\n"


__all__ = ["BRIDGE_VERSION", "create_app"]
