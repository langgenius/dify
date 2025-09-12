from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from core.rag.entities.citation_metadata import RetrievalSourceMetadata
from core.workflow.entities.node_entities import AgentNodeStrategyInit
from core.workflow.graph_engine.entities.runtime_route_state import RouteNodeState
from core.workflow.nodes import NodeType
from core.workflow.nodes.base import BaseNodeData


class GraphEngineEvent(BaseModel):
    pass


###########################################
# Graph Events
###########################################


class BaseGraphEvent(GraphEngineEvent):
    pass


class GraphRunStartedEvent(BaseGraphEvent):
    pass


class GraphRunSucceededEvent(BaseGraphEvent):
    outputs: dict[str, Any] | None = None
    """outputs"""


class GraphRunFailedEvent(BaseGraphEvent):
    error: str = Field(..., description="failed reason")
    exceptions_count: int = Field(description="exception count", default=0)


class GraphRunPartialSucceededEvent(BaseGraphEvent):
    exceptions_count: int = Field(..., description="exception count")
    outputs: dict[str, Any] | None = None


###########################################
# Node Events
###########################################


class BaseNodeEvent(GraphEngineEvent):
    id: str = Field(..., description="node execution id")
    node_id: str = Field(..., description="node id")
    node_type: NodeType = Field(..., description="node type")
    node_data: BaseNodeData = Field(..., description="node data")
    route_node_state: RouteNodeState = Field(..., description="route node state")
    parallel_id: str | None = None
    """parallel id if node is in parallel"""
    parallel_start_node_id: str | None = None
    """parallel start node id if node is in parallel"""
    parent_parallel_id: str | None = None
    """parent parallel id if node is in parallel"""
    parent_parallel_start_node_id: str | None = None
    """parent parallel start node id if node is in parallel"""
    in_iteration_id: str | None = None
    """iteration id if node is in iteration"""
    in_loop_id: str | None = None
    """loop id if node is in loop"""
    # The version of the node, or "1" if not specified.
    node_version: str = "1"


class NodeRunStartedEvent(BaseNodeEvent):
    predecessor_node_id: str | None = None
    """predecessor node id"""
    parallel_mode_run_id: str | None = None
    """iteration node parallel mode run id"""
    agent_strategy: AgentNodeStrategyInit | None = None


class NodeRunStreamChunkEvent(BaseNodeEvent):
    chunk_content: str = Field(..., description="chunk content")
    from_variable_selector: list[str] | None = None
    """from variable selector"""


class NodeRunRetrieverResourceEvent(BaseNodeEvent):
    retriever_resources: Sequence[RetrievalSourceMetadata] = Field(..., description="retriever resources")
    context: str = Field(..., description="context")


class NodeRunSucceededEvent(BaseNodeEvent):
    pass


class NodeRunFailedEvent(BaseNodeEvent):
    error: str = Field(..., description="error")


class NodeRunExceptionEvent(BaseNodeEvent):
    error: str = Field(..., description="error")


class NodeInIterationFailedEvent(BaseNodeEvent):
    error: str = Field(..., description="error")


class NodeInLoopFailedEvent(BaseNodeEvent):
    error: str = Field(..., description="error")


class NodeRunRetryEvent(NodeRunStartedEvent):
    error: str = Field(..., description="error")
    retry_index: int = Field(..., description="which retry attempt is about to be performed")
    start_at: datetime = Field(..., description="retry start time")


###########################################
# Parallel Branch Events
###########################################


class BaseParallelBranchEvent(GraphEngineEvent):
    parallel_id: str = Field(..., description="parallel id")
    """parallel id"""
    parallel_start_node_id: str = Field(..., description="parallel start node id")
    """parallel start node id"""
    parent_parallel_id: str | None = None
    """parent parallel id if node is in parallel"""
    parent_parallel_start_node_id: str | None = None
    """parent parallel start node id if node is in parallel"""
    in_iteration_id: str | None = None
    """iteration id if node is in iteration"""
    in_loop_id: str | None = None
    """loop id if node is in loop"""


class ParallelBranchRunStartedEvent(BaseParallelBranchEvent):
    pass


class ParallelBranchRunSucceededEvent(BaseParallelBranchEvent):
    pass


class ParallelBranchRunFailedEvent(BaseParallelBranchEvent):
    error: str = Field(..., description="failed reason")


###########################################
# Iteration Events
###########################################


class BaseIterationEvent(GraphEngineEvent):
    iteration_id: str = Field(..., description="iteration node execution id")
    iteration_node_id: str = Field(..., description="iteration node id")
    iteration_node_type: NodeType = Field(..., description="node type, iteration or loop")
    iteration_node_data: BaseNodeData = Field(..., description="node data")
    parallel_id: str | None = None
    """parallel id if node is in parallel"""
    parallel_start_node_id: str | None = None
    """parallel start node id if node is in parallel"""
    parent_parallel_id: str | None = None
    """parent parallel id if node is in parallel"""
    parent_parallel_start_node_id: str | None = None
    """parent parallel start node id if node is in parallel"""
    parallel_mode_run_id: str | None = None
    """iteration run in parallel mode run id"""


class IterationRunStartedEvent(BaseIterationEvent):
    start_at: datetime = Field(..., description="start at")
    inputs: Mapping[str, Any] | None = None
    metadata: Mapping[str, Any] | None = None
    predecessor_node_id: str | None = None


class IterationRunNextEvent(BaseIterationEvent):
    index: int = Field(..., description="index")
    pre_iteration_output: Any | None = None
    duration: float | None = None


class IterationRunSucceededEvent(BaseIterationEvent):
    start_at: datetime = Field(..., description="start at")
    inputs: Mapping[str, Any] | None = None
    outputs: Mapping[str, Any] | None = None
    metadata: Mapping[str, Any] | None = None
    steps: int = 0
    iteration_duration_map: dict[str, float] | None = None


class IterationRunFailedEvent(BaseIterationEvent):
    start_at: datetime = Field(..., description="start at")
    inputs: Mapping[str, Any] | None = None
    outputs: Mapping[str, Any] | None = None
    metadata: Mapping[str, Any] | None = None
    steps: int = 0
    error: str = Field(..., description="failed reason")


###########################################
# Loop Events
###########################################


class BaseLoopEvent(GraphEngineEvent):
    loop_id: str = Field(..., description="loop node execution id")
    loop_node_id: str = Field(..., description="loop node id")
    loop_node_type: NodeType = Field(..., description="node type, loop or loop")
    loop_node_data: BaseNodeData = Field(..., description="node data")
    parallel_id: str | None = None
    """parallel id if node is in parallel"""
    parallel_start_node_id: str | None = None
    """parallel start node id if node is in parallel"""
    parent_parallel_id: str | None = None
    """parent parallel id if node is in parallel"""
    parent_parallel_start_node_id: str | None = None
    """parent parallel start node id if node is in parallel"""
    parallel_mode_run_id: str | None = None
    """loop run in parallel mode run id"""


class LoopRunStartedEvent(BaseLoopEvent):
    start_at: datetime = Field(..., description="start at")
    inputs: Mapping[str, Any] | None = None
    metadata: Mapping[str, Any] | None = None
    predecessor_node_id: str | None = None


class LoopRunNextEvent(BaseLoopEvent):
    index: int = Field(..., description="index")
    pre_loop_output: Any | None = None
    duration: float | None = None


class LoopRunSucceededEvent(BaseLoopEvent):
    start_at: datetime = Field(..., description="start at")
    inputs: Mapping[str, Any] | None = None
    outputs: Mapping[str, Any] | None = None
    metadata: Mapping[str, Any] | None = None
    steps: int = 0
    loop_duration_map: dict[str, float] | None = None


class LoopRunFailedEvent(BaseLoopEvent):
    start_at: datetime = Field(..., description="start at")
    inputs: Mapping[str, Any] | None = None
    outputs: Mapping[str, Any] | None = None
    metadata: Mapping[str, Any] | None = None
    steps: int = 0
    error: str = Field(..., description="failed reason")


###########################################
# Agent Events
###########################################


class BaseAgentEvent(GraphEngineEvent):
    pass


class AgentLogEvent(BaseAgentEvent):
    id: str = Field(..., description="id")
    label: str = Field(..., description="label")
    node_execution_id: str = Field(..., description="node execution id")
    parent_id: str | None = Field(..., description="parent id")
    error: str | None = Field(..., description="error")
    status: str = Field(..., description="status")
    data: Mapping[str, Any] = Field(..., description="data")
    metadata: Mapping[str, Any] | None = Field(default=None, description="metadata")
    node_id: str = Field(..., description="agent node id")


InNodeEvent = BaseNodeEvent | BaseParallelBranchEvent | BaseIterationEvent | BaseAgentEvent | BaseLoopEvent
