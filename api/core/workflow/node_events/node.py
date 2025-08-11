from collections.abc import Sequence
from datetime import datetime
from typing import Optional

from pydantic import Field

from core.model_runtime.entities.llm_entities import LLMUsage
from core.rag.entities.citation_metadata import RetrievalSourceMetadata
from core.workflow.node_events import NodeRunResult

from .base import NodeEventBase


class RunRetrieverResourceEvent(NodeEventBase):
    retriever_resources: Sequence[RetrievalSourceMetadata] = Field(..., description="retriever resources")
    context: str = Field(..., description="context")


class ModelInvokeCompletedEvent(NodeEventBase):
    text: str
    usage: LLMUsage
    finish_reason: str | None = None


class RunRetryEvent(NodeEventBase):
    error: str = Field(..., description="error")
    retry_index: int = Field(..., description="Retry attempt number")
    start_at: datetime = Field(..., description="Retry start time")


class StreamChunkEvent(NodeEventBase):
    # Spec-compliant fields
    selector: Sequence[str] = Field(
        ..., description="selector identifying the output location (e.g., ['nodeA', 'text'])"
    )
    chunk: str = Field(..., description="the actual chunk content")
    is_final: bool = Field(default=False, description="indicates if this is the last chunk")

    # Legacy fields for backward compatibility - will be removed later
    chunk_content: str = Field(default="", description="[DEPRECATED] chunk content")
    from_variable_selector: Optional[list[str]] = Field(default=None, description="[DEPRECATED] variable selector")


class StreamCompletedEvent(NodeEventBase):
    node_run_result: NodeRunResult = Field(..., description="run result")
