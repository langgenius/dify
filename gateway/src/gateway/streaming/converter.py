"""Convert Dify SSE event stream into OpenAI-compatible ``chat.completion.chunk`` SSE.

Dify's ``POST /v1/chat-messages`` (response_mode=streaming) emits events:

* ``message`` — a chunk of the assistant's answer (``answer`` field is delta).
* ``message_end`` — terminal event with ``metadata`` (usage, retriever_resources).
* ``error`` — Dify reports an error mid-stream.
* ``ping`` — keep-alive.

OpenAI SSE chunks look like:

.. code-block:: text

    data: {"id":"...","object":"chat.completion.chunk","choices":[{"delta":{"content":"Hi"},"index":0,"finish_reason":null}],...}\n\n
    ...
    data: {"id":"...","choices":[{"delta":{},"index":0,"finish_reason":"stop"}],...}\n\n
    data: [DONE]\n\n

The first chunk carries ``role: "assistant"`` in delta; subsequent chunks carry
``content`` deltas; the final chunk carries ``finish_reason``. We attach
``references`` and ``conversation_id`` to the **final chunk's**
``choices[0].delta.metadata`` so streaming clients receive the same metadata
they would in blocking mode (R6).
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterable, AsyncIterator
from typing import Any

import structlog

from gateway.schemas import ChatChunkChoice, ChatCompletionChunk, DeltaMessage, Reference

logger = structlog.get_logger(__name__)


def parse_dify_sse_line(line: str) -> dict[str, Any] | None:
    """Parse a single SSE line; return the JSON event dict or None for non-data."""
    if not line or not line.startswith("data:"):
        return None
    payload = line[len("data:") :].strip()
    if not payload or payload == "[DONE]":
        return None
    try:
        obj = json.loads(payload)
    except json.JSONDecodeError:
        logger.warning("dify.sse.invalid_json", line=payload[:200])
        return None
    if not isinstance(obj, dict):
        return None
    return obj


def _format_chunk(chunk: ChatCompletionChunk) -> str:
    return f"data: {chunk.model_dump_json(exclude_none=True)}\n\n"


async def dify_to_openai_chunks(
    dify_lines: AsyncIterable[str],
    *,
    request_id: str,
    model_id: str,
) -> AsyncIterator[str]:
    """Yield OpenAI SSE strings derived from Dify SSE lines.

    Args:
        dify_lines: async iterator of raw lines from
            :meth:`DifyClient.chat_messages_streaming`.
        request_id: gateway-issued request id (used as ``id`` of every chunk).
        model_id: client-facing model id (echoed in every chunk).

    Yields:
        Strings already framed as ``data: {...}\\n\\n`` ready to push down the
        wire. The terminator ``data: [DONE]\\n\\n`` is emitted once at the end.
    """
    started = False
    last_event_metadata: dict[str, Any] | None = None
    finish_reason: str = "stop"
    conversation_id: str | None = None

    async for raw in dify_lines:
        event = parse_dify_sse_line(raw)
        if event is None:
            continue

        event_type = event.get("event")

        if event_type == "message":
            answer = event.get("answer", "")
            if not answer:
                continue
            delta = DeltaMessage(content=answer)
            if not started:
                # First chunk announces the role per OpenAI convention.
                delta.role = "assistant"
                started = True
            yield _format_chunk(
                ChatCompletionChunk(
                    id=request_id,
                    model=model_id,
                    choices=[ChatChunkChoice(index=0, delta=delta, finish_reason=None)],
                )
            )

        elif event_type == "message_end":
            last_event_metadata = event.get("metadata") or {}
            conversation_id = event.get("conversation_id")
            # Loop continues; we emit the final chunk after exhausting the stream.

        elif event_type == "error":
            # Surface the error as a final chunk with finish_reason='content_filter'
            # to keep the stream parseable; clients that need the raw error can
            # inspect logs / non-streaming retry.
            logger.warning(
                "dify.sse.error_event",
                code=event.get("code"),
                message=event.get("message"),
            )
            finish_reason = "content_filter"
            break

        # ``ping`` and unknown events are ignored.

    # Emit terminal chunk with metadata (references + conversation_id).
    references_payload: list[dict[str, Any]] = []
    if last_event_metadata:
        for r in last_event_metadata.get("retriever_resources", []) or []:
            references_payload.append(
                Reference(
                    content=r.get("content", ""),
                    score=r.get("score"),
                    document_name=r.get("document_name"),
                    document_id=r.get("document_id"),
                    segment_id=r.get("segment_id"),
                ).model_dump(exclude_none=True)
            )

    final_delta_metadata: dict[str, Any] = {}
    if references_payload:
        final_delta_metadata["references"] = references_payload
    if conversation_id:
        final_delta_metadata["conversation_id"] = conversation_id

    final_delta = DeltaMessage()
    final_chunk_data: dict[str, Any] = {
        "id": request_id,
        "object": "chat.completion.chunk",
        "model": model_id,
        "choices": [
            {
                "index": 0,
                "delta": final_delta.model_dump(exclude_none=True),
                "finish_reason": finish_reason,
            }
        ],
    }
    if final_delta_metadata:
        # Attach metadata to the delta (extra='allow' on schemas permits this).
        final_chunk_data["choices"][0]["delta"]["metadata"] = final_delta_metadata

    yield f"data: {json.dumps(final_chunk_data, ensure_ascii=False)}\n\n"
    yield "data: [DONE]\n\n"
