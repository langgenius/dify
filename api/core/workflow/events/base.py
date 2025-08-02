from abc import ABC
from typing import Any, Optional

from pydantic import BaseModel, Field

# from core.workflow.entities import RouteNodeState  # Removed to avoid cycle imports
from core.workflow.enums import NodeType


class GraphEngineEvent(BaseModel):
    pass


class BaseGraphEvent(GraphEngineEvent):
    pass


class BaseNodeEvent(GraphEngineEvent):
    id: str = Field(..., description="node execution id")
    node_id: str = Field(..., description="node id")
    node_type: NodeType = Field(..., description="node type")
    node_data: Any = Field(..., description="node data")  # Type: BaseNodeData from core.workflow.nodes.base.entities
    route_node_state: Any = Field(..., description="route node state")
    # Type: RouteNodeState from core.workflow.entities
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
    in_loop_id: Optional[str] = None
    """loop id if node is in loop"""
    # The version of the node, or "1" if not specified.
    node_version: str = "1"


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
    in_loop_id: Optional[str] = None
    """loop id if node is in loop"""


class BaseIterationEvent(GraphEngineEvent):
    iteration_id: str = Field(..., description="iteration node execution id")
    iteration_node_id: str = Field(..., description="iteration node id")
    iteration_node_type: NodeType = Field(..., description="node type, iteration or loop")
    iteration_node_data: Any = Field(
        ..., description="node data"
    )  # Type: BaseNodeData from core.workflow.nodes.base.entities
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


class BaseLoopEvent(GraphEngineEvent):
    loop_id: str = Field(..., description="loop node execution id")
    loop_node_id: str = Field(..., description="loop node id")
    loop_node_type: NodeType = Field(..., description="node type, loop or loop")
    loop_node_data: Any = Field(
        ..., description="node data"
    )  # Type: BaseNodeData from core.workflow.nodes.base.entities
    parallel_id: Optional[str] = None
    """parallel id if node is in parallel"""
    parallel_start_node_id: Optional[str] = None
    """parallel start node id if node is in parallel"""
    parent_parallel_id: Optional[str] = None
    """parent parallel id if node is in parallel"""
    parent_parallel_start_node_id: Optional[str] = None
    """parent parallel start node id if node is in parallel"""
    parallel_mode_run_id: Optional[str] = None
    """loop run in parallel mode run id"""


class BaseAgentEvent(GraphEngineEvent):
    pass


class NodeEvent(GraphEngineEvent, ABC):
    """Base class for all node events"""

    pass


InNodeEvent = BaseNodeEvent | BaseParallelBranchEvent | BaseIterationEvent | BaseAgentEvent | BaseLoopEvent
