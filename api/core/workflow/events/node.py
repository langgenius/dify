from collections.abc import Sequence
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field

from core.rag.entities.citation_metadata import RetrievalSourceMetadata

from .base import GraphNodeEventBase


class AgentNodeStrategyInit(BaseModel):
    name: str
    icon: str | None = None


class NodeRunStartedEvent(GraphNodeEventBase):
    node_title: str
    predecessor_node_id: Optional[str] = None
    parallel_mode_run_id: Optional[str] = None
    agent_strategy: Optional[AgentNodeStrategyInit] = None
    start_at: datetime = Field(..., description="node start time")

    # FIXME(-LAN-): only for ToolNode
    provider_type: str = ""
    provider_id: str = ""


class NodeRunStreamChunkEvent(GraphNodeEventBase):
    # Spec-compliant fields
    selector: Sequence[str] = Field(
        ..., description="selector identifying the output location (e.g., ['nodeA', 'text'])"
    )
    chunk: str = Field(..., description="the actual chunk content")
    is_final: bool = Field(default=False, description="indicates if this is the last chunk")

    # Legacy fields for backward compatibility - will be removed later
    chunk_content: str = Field(default="", description="[DEPRECATED] chunk content")
    from_variable_selector: Optional[list[str]] = Field(default=None, description="[DEPRECATED] variable selector")


class NodeRunRetrieverResourceEvent(GraphNodeEventBase):
    retriever_resources: Sequence[RetrievalSourceMetadata] = Field(..., description="retriever resources")
    context: str = Field(..., description="context")


class NodeRunSucceededEvent(GraphNodeEventBase):
    start_at: datetime = Field(..., description="node start time")


class NodeRunFailedEvent(GraphNodeEventBase):
    error: str = Field(..., description="error")
    start_at: datetime = Field(..., description="node start time")


class NodeRunExceptionEvent(GraphNodeEventBase):
    error: str = Field(..., description="error")
    start_at: datetime = Field(..., description="node start time")


class NodeRunRetryEvent(NodeRunStartedEvent):
    error: str = Field(..., description="error")
    retry_index: int = Field(..., description="which retry attempt is about to be performed")
