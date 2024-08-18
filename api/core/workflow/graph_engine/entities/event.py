from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field

from core.workflow.entities.base_node_data_entities import BaseNodeData
from core.workflow.entities.node_entities import NodeType
from core.workflow.graph_engine.entities.runtime_route_state import RouteNodeState


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


class IterationRunStartedEvent(BaseIterationEvent):
    start_at: datetime = Field(..., description="start at")
    inputs: Optional[dict[str, Any]] = None
    metadata: Optional[dict[str, Any]] = None
    predecessor_node_id: Optional[str] = None


class IterationRunNextEvent(BaseIterationEvent):
    index: int = Field(..., description="index")
    pre_iteration_output: Optional[Any] = Field(None, description="pre iteration output")


class IterationRunSucceededEvent(BaseIterationEvent):
    start_at: datetime = Field(..., description="start at")
    inputs: Optional[dict[str, Any]] = None
    outputs: Optional[dict[str, Any]] = None
    metadata: Optional[dict[str, Any]] = None
    steps: int = 0


class IterationRunFailedEvent(BaseIterationEvent):
    start_at: datetime = Field(..., description="start at")
    inputs: Optional[dict[str, Any]] = None
    outputs: Optional[dict[str, Any]] = None
    metadata: Optional[dict[str, Any]] = None
    steps: int = 0
    error: str = Field(..., description="failed reason")


InNodeEvent = BaseNodeEvent | BaseParallelBranchEvent | BaseIterationEvent
