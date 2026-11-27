"""Official a2a-sdk 1.3.0 HTTP+JSON interoperability peer for isolated dev.

Only the agent executor and ID/hash-only admin observations are fixture code.
Agent Card serialization, protocol validation, HTTP routing, Task storage,
Send/Stream/Get/Cancel and SSE serialization belong to the unmodified SDK.
Run in the separate environment described by official_sdk_requirements.in.
Never publish the unauthenticated admin route outside the acceptance network.
"""

from __future__ import annotations

import asyncio
import copy
import hashlib
import importlib.metadata
import os
import re
from typing import Any
from uuid import uuid4

import uvicorn
from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.events import EventQueue
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.routes.agent_card_routes import create_agent_card_routes
from a2a.server.routes.rest_routes import create_rest_routes
from a2a.server.tasks import InMemoryTaskStore, TaskUpdater
from a2a.types import (
    AgentCapabilities,
    AgentCard,
    AgentInterface,
    AgentSkill,
    Message,
    Part,
    Role,
    Task,
    TaskState,
    TaskStatus,
)
from google.protobuf.json_format import ParseDict
from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Mount, Route

SDK_VERSION = "1.3.0"
SDK_COMMIT = "0d9dafb92328144384eca58a6e8ab80cb8f7d445"
FILE_BYTES = b"%PDF-1.4\nOfficial A2A SDK interoperability\n%%EOF\n"
SCENARIO = re.compile(r"^\[byoa:([a-z-]+)(?::([A-Za-z0-9_-]+))?\]")


class SDKState:
    """Keep only synthetic identities, byte hashes and protocol operation counts."""

    def __init__(self) -> None:
        """Start an empty observation set before any SDK request is admitted."""
        self.counts = dict.fromkeys(("send", "stream", "get", "cancel", "subscribe", "verify"), 0)
        self.messages: dict[str, dict[str, Any]] = {}
        self.tasks: dict[str, str] = {}

    def snapshot(self) -> dict[str, Any]:
        """Return a detached, secret-free snapshot without changing SDK state."""
        return {
            "sdk_version": SDK_VERSION,
            "sdk_upstream_commit": SDK_COMMIT,
            "compat_v0_3_enabled": False,
            "counts": dict(self.counts),
            "messages": copy.deepcopy(self.messages),
            "tasks": dict(self.tasks),
        }


class SDKExecutor(AgentExecutor):
    """Supply deterministic agent work; all transport behavior remains SDK-owned."""

    def __init__(self, state: SDKState) -> None:
        """Receive one peer's in-memory observation set, with no application access."""
        self.state = state

    async def execute(self, context: RequestContext, event_queue: EventQueue) -> None:
        """Accept SDK-validated input and emit a Message or a cancellable Task.

        Preconditions: the official handler has admitted a message and generated
        Task/context identities. Postcondition: exactly one executor observation
        is recorded; task completion and bytes are published through SDK events.
        """
        message = context.message
        if message is None or context.task_id is None or context.context_id is None:
            raise ValueError("The SDK did not provide a complete execution context.")
        match = SCENARIO.match(context.get_user_input())
        scenario, run = (match.group(1), match.group(2) or "") if match else ("completed", "")
        inputs = [
            {"size": len(part.raw), "sha256": hashlib.sha256(part.raw).hexdigest(), "media_type": part.media_type}
            for part in message.parts
            if part.WhichOneof("content") == "raw"
        ]
        old = self.state.messages.get(message.message_id)
        self.state.messages[message.message_id] = {
            "executions": int(old["executions"]) + 1 if old else 1,
            "scenario": scenario,
            "run": run,
            "context_id": context.context_id,
            "task_id": context.task_id if scenario != "direct" else None,
            "input_files": inputs,
        }
        if scenario == "direct":
            await event_queue.enqueue_event(
                Message(
                    message_id=str(uuid4()),
                    context_id=context.context_id,
                    role=Role.ROLE_AGENT,
                    parts=[Part(text="official sdk direct ok")],
                )
            )
            return
        self.state.tasks[context.task_id] = "working"
        await event_queue.enqueue_event(
            Task(
                id=context.task_id,
                context_id=context.context_id,
                status=TaskStatus(state=TaskState.TASK_STATE_WORKING),
            )
        )
        updater = TaskUpdater(event_queue, context.task_id, context.context_id)
        await asyncio.sleep(180 if scenario == "hold" else 35 if scenario == "sdk-sse" else 2)
        if scenario == "file-output":
            await updater.add_artifact(
                [Part(raw=FILE_BYTES, media_type="application/pdf", filename="official-sdk.pdf")], name="report"
            )
        elif scenario == "file-input":
            part = ParseDict(
                {
                    "data": {
                        "text": "official sdk input ok",
                        "file_count": len(inputs),
                        "total_bytes": sum(item["size"] for item in inputs),
                    }
                },
                Part(),
            )
            await updater.add_artifact([part], name="result")
        else:
            await updater.add_artifact([Part(text="official sdk task ok")], name="text")
        await updater.complete()
        self.state.tasks[context.task_id] = "completed"

    async def cancel(self, context: RequestContext, event_queue: EventQueue) -> None:
        """Publish confirmed SDK cancellation of the already admitted Task only."""
        if context.task_id is None or context.context_id is None:
            raise ValueError("Cannot cancel an unidentified SDK Task.")
        await TaskUpdater(event_queue, context.task_id, context.context_id).cancel()
        self.state.tasks[context.task_id] = "canceled"


class CountRequests(BaseHTTPMiddleware):
    """Observe operation paths without reading or rewriting protocol messages."""

    def __init__(self, app, *, state: SDKState) -> None:
        """Bind counters to this isolated ASGI application."""
        super().__init__(app)
        self.state = state

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        """Count each HTTP attempt once and pass its untouched body to the SDK."""
        path = request.url.path
        operation = (
            "send"
            if path.endswith("message:send")
            else "stream"
            if path.endswith("message:stream")
            else "cancel"
            if path.endswith(":cancel")
            else "subscribe"
            if ":subscribe" in path
            else "verify"
            if path.endswith("agent-card.json")
            else "get"
            if "/tasks/" in path and request.method == "GET"
            else None
        )
        if operation is not None:
            self.state.counts[operation] += 1
        return await call_next(request)


def create_app(public_url: str) -> Starlette:
    """Construct SDK 1.0-only REST routes and secret-free admin observations.

    Preconditions: the pinned SDK is installed; public_url is this isolated
    peer's HTTPS origin. No compatibility adapter, custom REST dispatcher or
    manually serialized A2A response is used.
    """
    if importlib.metadata.version("a2a-sdk") != SDK_VERSION:
        raise RuntimeError("Official SDK version does not match the interoperability pin.")
    state = SDKState()
    public_url = public_url.rstrip("/")

    def card(*, streaming: bool) -> AgentCard:
        prefix = "/stream/a2a" if streaming else "/a2a"
        return AgentCard(
            name="Official A2A SDK interoperability peer",
            description="Isolated SDK 1.0 HTTP+JSON contract acceptance",
            version=SDK_VERSION,
            supported_interfaces=[
                AgentInterface(url=public_url + prefix, protocol_binding="HTTP+JSON", protocol_version="1.0")
            ],
            capabilities=AgentCapabilities(streaming=streaming),
            default_input_modes=["text/plain", "application/pdf"],
            default_output_modes=["text/plain", "application/json", "application/pdf"],
            skills=[
                AgentSkill(id="interop", name="Interoperability", description="Controlled SDK agent", tags=["test"])
            ],
        )

    async def stats(_request: Request) -> JSONResponse:
        """Read counters; this route cannot alter a Task or manufacture recovery."""
        return JSONResponse(state.snapshot())

    routes = []
    for streaming in (False, True):
        agent_card = card(streaming=streaming)
        handler = DefaultRequestHandler(SDKExecutor(state), InMemoryTaskStore(), agent_card)
        prefix = "/stream" if streaming else ""
        routes.extend(create_agent_card_routes(agent_card, card_url=prefix + "/.well-known/agent-card.json"))
        # Scope the SDK's own routing-tenant catch-all below its interface.
        # A root-level /{tenant} mount would swallow the second public Card.
        routes.append(Mount(prefix + "/a2a", routes=create_rest_routes(handler, enable_v0_3_compat=False)))
    routes.append(Route("/admin/state", stats, methods=["GET"]))
    return Starlette(routes=routes, middleware=[Middleware(CountRequests, state=state)])


def main() -> None:
    """Serve only the isolated HTTPS peer; TLS cert/key arrive from environment."""
    uvicorn.run(
        create_app(os.environ["BYOA_SDK_PUBLIC_URL"]),
        host=os.environ.get("BYOA_SDK_LISTEN_HOST", "0.0.0.0"),
        port=int(os.environ.get("BYOA_SDK_PORT", "443")),
        ssl_certfile=os.environ["BYOA_SDK_CERT"],
        ssl_keyfile=os.environ["BYOA_SDK_KEY"],
        access_log=False,
        log_level="warning",
    )


if __name__ == "__main__":
    main()
