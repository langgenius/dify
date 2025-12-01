from collections.abc import Sequence
from datetime import datetime

from pydantic import Field

from core.model_runtime.entities.llm_entities import LLMUsage
from core.rag.entities.citation_metadata import RetrievalSourceMetadata
from core.workflow.entities.pause_reason import PauseReason
from core.workflow.node_events import NodeRunResult

from .base import NodeEventBase


class RunRetrieverResourceEvent(NodeEventBase):
    retriever_resources: Sequence[RetrievalSourceMetadata] = Field(..., description="retriever resources")
    context: str = Field(..., description="context")


class ModelInvokeCompletedEvent(NodeEventBase):
    text: str
    usage: LLMUsage
    finish_reason: str | None = None
    reasoning_content: str | None = None
    structured_output: dict | None = None


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


class StreamCompletedEvent(NodeEventBase):
    node_run_result: NodeRunResult = Field(..., description="run result")


class PauseRequestedEvent(NodeEventBase):
    reason: PauseReason = Field(..., description="pause reason")
