"""``/v1/chat/completions`` router (blocking + streaming).

Translates OpenAI Chat Completions requests into Dify ``chat-messages`` calls
via the resolved customer's lazy-built App. References returned by Dify's
retriever are surfaced under ``choices[0].message.metadata.references`` (R6).

Conversation handling:
    OpenAI is stateless (full ``messages`` array each request) while Dify
    tracks conversations server-side keyed by ``conversation_id``. We take the
    *last user message* as the Dify ``query`` and forward
    ``extra_body.conversation_id`` (if any) so clients can opt into Dify-side
    history. Previous turns in ``messages`` are forwarded as ``inputs.history``
    text for the App to optionally reference.
"""

from __future__ import annotations

import json
import uuid
from typing import Any

import structlog
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse

from gateway.dify.app_manager import AppManager
from gateway.dify.client import DifyClient
from gateway.errors import InvalidRequestError
from gateway.registry import CustomerEntry
from gateway.schemas import (
    ChatChoice,
    ChatCompletionRequest,
    ChatCompletionResponse,
    ChatMessage,
    ChatResponseMessage,
    Reference,
    Usage,
    make_metadata,
)
from gateway.streaming.converter import dify_to_openai_chunks

logger = structlog.get_logger(__name__)

router = APIRouter()


# ---------- helpers ----------


def _last_user_message(messages: list[ChatMessage]) -> str:
    """Return the content of the most recent ``user`` message, or raise."""
    for msg in reversed(messages):
        if msg.role == "user" and msg.content:
            return msg.content
    raise InvalidRequestError("messages must contain at least one user message", param="messages")


def _serialise_history(messages: list[ChatMessage]) -> str:
    """Render prior turns (excluding the final user message) as plain text.

    Forwarded as ``inputs.history`` so the Dify App can include it via
    template substitution if its pre-prompt expects it.
    """
    if not messages:
        return ""
    # Drop the trailing user message; the rest is "history".
    if messages[-1].role == "user":
        prior = messages[:-1]
    else:
        prior = list(messages)
    parts: list[str] = []
    for m in prior:
        if not m.content:
            continue
        parts.append(f"{m.role}: {m.content}")
    return "\n".join(parts)


def _user_id(req: ChatCompletionRequest, customer: CustomerEntry, request_id: str) -> str:
    """Stable end-user identifier sent to Dify.

    Prefers ``request.user`` (OpenAI standard); falls back to a deterministic
    per-customer fallback when omitted, since Dify requires this field.
    """
    if req.user:
        return req.user
    # Use ``customer_id:request_id`` as fallback; not ideal for cross-call
    # personalisation but unambiguous for tracing.
    return f"{customer.customer_id}:{request_id}"


def _extract_references(metadata: dict[str, Any] | None) -> list[Reference]:
    if not metadata:
        return []
    out: list[Reference] = []
    for r in metadata.get("retriever_resources", []) or []:
        out.append(
            Reference(
                content=r.get("content", ""),
                score=r.get("score"),
                document_name=r.get("document_name"),
                document_id=r.get("document_id"),
                segment_id=r.get("segment_id"),
            )
        )
    return out


def _extract_usage(metadata: dict[str, Any] | None) -> Usage:
    if not metadata:
        return Usage()
    u = metadata.get("usage") or {}
    return Usage(
        prompt_tokens=int(u.get("prompt_tokens", 0) or 0),
        completion_tokens=int(u.get("completion_tokens", 0) or 0),
        total_tokens=int(u.get("total_tokens", 0) or 0),
    )


# ---------- endpoint ----------


@router.post("/v1/chat/completions")
async def chat_completions(request: Request, body: ChatCompletionRequest) -> Any:
    """OpenAI-compatible chat completions.

    Honors ``stream`` flag; non-streaming returns JSON, streaming returns SSE.
    """
    customer: CustomerEntry = request.state.customer
    request_id: str = request.state.request_id
    app_manager: AppManager = request.app.state.app_manager
    dify_factory = request.app.state.dify_client_factory

    # Validate model + obtain App key (lazy-build).
    app_key = await app_manager.get_app_key(customer, body.model)
    dify_client: DifyClient = dify_factory(customer)

    query = _last_user_message(body.messages)
    history_text = _serialise_history(body.messages)
    inputs: dict[str, Any] = {}
    if history_text:
        inputs["history"] = history_text

    user = _user_id(body, customer, request_id)

    # ---- streaming branch ----
    #
    # Pre-flight pattern: open the upstream stream **before** returning a
    # ``StreamingResponse``. If Dify replies non-2xx or times out at this
    # stage, the GatewayError propagates to the global exception handler and
    # becomes a clean 502/504 JSON envelope. Without this, errors raised
    # inside ``StreamingResponse`` after headers are flushed would yield a
    # broken SSE stream and hide the real status from clients.
    if body.stream:
        stream_cm = dify_client.open_chat_stream(
            app_key=app_key,
            query=query,
            user=user,
            inputs=inputs,
            conversation_id=body.conversation_id,
        )
        # Enter the context here; raises DifyUpstreamError / DifyTimeoutError
        # synchronously which is exactly what we want before sending headers.
        dify_lines = await stream_cm.__aenter__()

        async def event_source():  # type: ignore[no-untyped-def]
            try:
                async for chunk in dify_to_openai_chunks(
                    dify_lines, request_id=request_id, model_id=body.model
                ):
                    yield chunk
            finally:
                # Best-effort close; errors inside cleanup are swallowed because
                # the response has already started streaming.
                try:
                    await stream_cm.__aexit__(None, None, None)
                except Exception:  # noqa: BLE001
                    logger.exception("chat.stream_close_failed")

        return StreamingResponse(
            event_source(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",  # disable proxy buffering for true streaming
            },
        )

    # ---- blocking branch ----
    dify_resp = await dify_client.chat_messages_blocking(
        app_key=app_key,
        query=query,
        user=user,
        inputs=inputs,
        conversation_id=body.conversation_id,
    )

    answer: str = dify_resp.get("answer") or ""
    metadata = dify_resp.get("metadata") or {}
    references = _extract_references(metadata)
    usage = _extract_usage(metadata)
    conversation_id = dify_resp.get("conversation_id")

    response = ChatCompletionResponse(
        id=f"chatcmpl-{request_id}",
        model=body.model,
        choices=[
            ChatChoice(
                index=0,
                message=ChatResponseMessage(
                    role="assistant",
                    content=answer,
                    metadata=make_metadata(
                        references=[r.model_dump(exclude_none=True) for r in references],
                        conversation_id=conversation_id,
                        request_id=request_id,
                    ),
                ),
                finish_reason="stop",
            )
        ],
        usage=usage,
    )

    logger.info(
        "chat.blocking.completed",
        model=body.model,
        prompt_tokens=usage.prompt_tokens,
        completion_tokens=usage.completion_tokens,
        references=len(references),
    )

    # ``model_dump`` to honour ``extra='allow'`` fields (metadata).
    return JSONResponse(content=json.loads(response.model_dump_json(exclude_none=True)))
