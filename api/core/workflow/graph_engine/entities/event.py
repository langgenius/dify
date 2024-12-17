from collections.abc import Mapping
from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field

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
    outputs: Optional[dict[str, Any]] = None
    """outputs"""


class GraphRunFailedEvent(BaseGraphEvent):
    error: str = Field(..., description="failed reason")
    exceptions_count: Optional[int] = Field(description="exception count", default=0)


class GraphRunPartialSucceededEvent(BaseGraphEvent):
    exceptions_count: int = Field(..., description="exception count")
    outputs: Optional[dict[str, Any]] = None


###########################################
# Node Events
###########################################


class BaseNodeEvent(GraphEngineEvent):
    id: str = Field(..., description="node execution id")
    node_id: str = Field(..., description="node id")
    node_type: NodeType = Field(..., description="node type")
    node_data: BaseNodeData = Field(..., description="node data")
    route_node_state: RouteNodeState = Field(..., description="route node state")
    parallel_id: Optional[str] = None
    """parallel id if node is in parallel"""
    parallel_start_node_id: Optional[str] = None
    """parallel start node id if node is in parallel"""
    parent_parallel_id: Optional[str] = None
    """parent parallel id if node is in parallel"""
    parent_parallel_start_node_id: Optional[str] = None
    """parent parallel start node id if node is in parallel"""
    in_iteration_id: Optional[str] = None
    """iteration id if node is in iteration"""


class NodeRunStartedEvent(BaseNodeEvent):
    predecessor_node_id: Optional[str] = None
    parallel_mode_run_id: Optional[str] = None
    """predecessor node id"""


class NodeRunStreamChunkEvent(BaseNodeEvent):
    chunk_content: str = Field(..., description="chunk content")
    from_variable_selector: Optional[list[str]] = None
    """from variable selector"""


class NodeRunRetrieverResourceEvent(BaseNodeEvent):
    retriever_resources: list[dict] = Field(..., description="retriever resources")
    context: str = Field(..., description="context")


class NodeRunSucceededEvent(BaseNodeEvent):
    pass


class NodeRunFailedEvent(BaseNodeEvent):
    error: str = Field(..., description="error")


class NodeRunExceptionEvent(BaseNodeEvent):
    error: str = Field(..., description="error")


class NodeInIterationFailedEvent(BaseNodeEvent):
    error: str = Field(..., description="error")


###########################################
# Parallel Branch Events
###########################################


class BaseParallelBranchEvent(GraphEngineEvent):
    parallel_id: str = Field(..., description="parallel id")
    """parallel id"""
    parallel_start_node_id: str = Field(..., description="parallel start node id")
    """parallel start node id"""
    parent_parallel_id: Optional[str] = None
    """parent parallel id if node is in parallel"""
    parent_parallel_start_node_id: Optional[str] = None
    """parent parallel start node id if node is in parallel"""
    in_iteration_id: Optional[str] = None
    """iteration id if node is in iteration"""


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
    parallel_id: Optional[str] = None
    """parallel id if node is in parallel"""
    parallel_start_node_id: Optional[str] = None
    """parallel start node id if node is in parallel"""
    parent_parallel_id: Optional[str] = None
    """parent parallel id if node is in parallel"""
    parent_parallel_start_node_id: Optional[str] = None
    """parent parallel start node id if node is in parallel"""
    parallel_mode_run_id: Optional[str] = None
    """iteratoin run in parallel mode run id"""


class IterationRunStartedEvent(BaseIterationEvent):
    start_at: datetime = Field(..., description="start at")
    inputs: Optional[Mapping[str, Any]] = None
    metadata: Optional[Mapping[str, Any]] = None
    predecessor_node_id: Optional[str] = None


class IterationRunNextEvent(BaseIterationEvent):
    index: int = Field(..., description="index")
    pre_iteration_output: Optional[Any] = Field(None, description="pre iteration output")
    duration: Optional[float] = Field(None, description="duration")


class IterationRunSucceededEvent(BaseIterationEvent):
    start_at: datetime = Field(..., description="start at")
    inputs: Optional[Mapping[str, Any]] = None
    outputs: Optional[Mapping[str, Any]] = None
    metadata: Optional[Mapping[str, Any]] = None
    steps: int = 0
    iteration_duration_map: Optional[dict[str, float]] = None


class IterationRunFailedEvent(BaseIterationEvent):
    start_at: datetime = Field(..., description="start at")
    inputs: Optional[Mapping[str, Any]] = None
    outputs: Optional[Mapping[str, Any]] = None
    metadata: Optional[Mapping[str, Any]] = None
    steps: int = 0
    error: str = Field(..., description="failed reason")


InNodeEvent = BaseNodeEvent | BaseParallelBranchEvent | BaseIterationEvent
