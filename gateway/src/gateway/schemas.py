"""OpenAI-compatible Pydantic schemas for request/response bodies.

The gateway exposes the OpenAI Chat Completions surface, with a single deviation:
``choices[0].message.metadata`` carries gateway-specific data (currently
``references`` populated from Dify's ``retriever_resources``). Standard OpenAI
clients ignore unknown fields, but our SDK examples surface this metadata.

Reference:
    * https://platform.openai.com/docs/api-reference/chat
"""

from __future__ import annotations

import time
import uuid
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


# ---------- Request ----------


class ChatMessage(BaseModel):
    """A single message in a chat completion request.

    Tool messages are accepted on input but the gateway does not surface tool
    calling outwards in PR#1; they pass through to Dify if the App supports it.
    """

    model_config = ConfigDict(extra="allow")

    role: Literal["system", "user", "assistant", "tool"]
    content: str | None = None
    name: str | None = None


class ChatCompletionRequest(BaseModel):
    """Subset of OpenAI Chat Completions request that the gateway understands.

    Unknown fields are accepted (``extra="allow"``) and forwarded where
    semantically sensible. ``extra_body`` extensions are namespaced so they do
    not collide with future OpenAI additions.
    """

    model_config = ConfigDict(extra="allow")

    model: str = Field(min_length=1, description="Model id (validated against customer registry)")
    messages: list[ChatMessage] = Field(min_length=1)
    stream: bool = Field(default=False)
    temperature: float | None = Field(default=None, ge=0.0, le=2.0)
    max_tokens: int | None = Field(default=None, gt=0)
    user: str | None = Field(default=None, description="Stable end-user identifier")

    # Gateway extensions (kept under ``extra_body`` for client SDK compatibility).
    # Officially passed via ``extra_body={"conversation_id": "..."}``.
    conversation_id: str | None = Field(default=None)


# ---------- Response (non-streaming) ----------


class Reference(BaseModel):
    """A single retrieved chunk surfaced to the client.

    Sourced from Dify's ``metadata.retriever_resources``.
    """

    model_config = ConfigDict(extra="allow")

    content: str
    score: float | None = None
    document_name: str | None = None
    document_id: str | None = None
    segment_id: str | None = None


class MessageMetadata(BaseModel):
    """Gateway-specific metadata attached to assistant messages.

    Lives at ``choices[0].message.metadata``. Survives ``model_dump()`` from the
    official OpenAI Python SDK because it is part of the parsed model.
    """

    model_config = ConfigDict(extra="allow")

    references: list[Reference] = Field(default_factory=list)
    conversation_id: str | None = None
    request_id: str | None = None


class ChatResponseMessage(BaseModel):
    """Assistant message in a non-streaming response."""

    model_config = ConfigDict(extra="allow")

    role: Literal["assistant"] = "assistant"
    content: str
    metadata: MessageMetadata | None = None


class ChatChoice(BaseModel):
    model_config = ConfigDict(extra="allow")

    index: int = 0
    message: ChatResponseMessage
    finish_reason: Literal["stop", "length", "content_filter", "tool_calls"] = "stop"


class Usage(BaseModel):
    model_config = ConfigDict(extra="allow")

    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0


class ChatCompletionResponse(BaseModel):
    """OpenAI-compatible non-streaming response."""

    model_config = ConfigDict(extra="allow")

    id: str = Field(default_factory=lambda: f"chatcmpl-{uuid.uuid4().hex}")
    object: Literal["chat.completion"] = "chat.completion"
    created: int = Field(default_factory=lambda: int(time.time()))
    model: str
    choices: list[ChatChoice]
    usage: Usage = Field(default_factory=Usage)


# ---------- Streaming chunks ----------


class DeltaMessage(BaseModel):
    """Incremental delta in a streaming response."""

    model_config = ConfigDict(extra="allow")

    role: Literal["assistant"] | None = None
    content: str | None = None


class ChatChunkChoice(BaseModel):
    model_config = ConfigDict(extra="allow")

    index: int = 0
    delta: DeltaMessage
    finish_reason: Literal["stop", "length", "content_filter", "tool_calls"] | None = None


class ChatCompletionChunk(BaseModel):
    """OpenAI-compatible streaming chunk (SSE ``data:`` payload)."""

    model_config = ConfigDict(extra="allow")

    id: str
    object: Literal["chat.completion.chunk"] = "chat.completion.chunk"
    created: int = Field(default_factory=lambda: int(time.time()))
    model: str
    choices: list[ChatChunkChoice]


# ---------- /v1/models ----------


class ModelInfo(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    object: Literal["model"] = "model"
    created: int = Field(default_factory=lambda: int(time.time()))
    owned_by: str = "ai-sdk-gateway"


class ModelList(BaseModel):
    model_config = ConfigDict(extra="allow")

    object: Literal["list"] = "list"
    data: list[ModelInfo]


def make_metadata(
    references: list[dict[str, Any]] | None = None,
    conversation_id: str | None = None,
    request_id: str | None = None,
) -> MessageMetadata:
    """Convenience factory used by the chat router and tests."""
    refs = [Reference(**r) for r in references] if references else []
    return MessageMetadata(references=refs, conversation_id=conversation_id, request_id=request_id)
