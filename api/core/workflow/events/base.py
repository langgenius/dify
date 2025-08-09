from abc import ABC
from collections.abc import Mapping
from typing import Any, Optional

from pydantic import BaseModel, Field

from core.model_runtime.entities.llm_entities import LLMUsage
from core.workflow.enums import NodeType, WorkflowNodeExecutionMetadataKey, WorkflowNodeExecutionStatus


class NodeRunResult(BaseModel):
    """
    Node Run Result.
    """

    status: WorkflowNodeExecutionStatus = WorkflowNodeExecutionStatus.PENDING

    inputs: Mapping[str, Any] = Field(default_factory=dict)
    process_data: Mapping[str, Any] = Field(default_factory=dict)
    outputs: Mapping[str, Any] = Field(default_factory=dict)
    metadata: Mapping[WorkflowNodeExecutionMetadataKey, Any] = Field(default_factory=dict)
    llm_usage: LLMUsage = Field(default_factory=LLMUsage.empty_usage)

    edge_source_handle: str = "source"  # source handle id of node with multiple branches

    error: str = ""
    error_type: str = ""

    # single step node run retry
    retry_index: int = 0


class GraphEngineEvent(BaseModel):
    pass


class BaseGraphEvent(GraphEngineEvent):
    pass


class GraphBaseNodeEvent(GraphEngineEvent):
    id: str = Field(..., description="node execution id")
    node_id: str
    node_type: NodeType
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
    node_run_result: NodeRunResult = Field(default_factory=NodeRunResult)


class BaseIterationEvent(GraphBaseNodeEvent):
    iteration_node_data: Any = Field(
        ..., description="node data"
    )  # Type: BaseNodeData from core.workflow.nodes.base.entities
    parallel_mode_run_id: Optional[str] = None
    """iteratoin run in parallel mode run id"""

    @property
    def iteration_id(self) -> str:
        """Alias for id to maintain backward compatibility"""
        return self.id

    @property
    def iteration_node_id(self) -> str:
        """Alias for node_id to maintain backward compatibility"""
        return self.node_id

    @property
    def iteration_node_type(self) -> NodeType:
        """Alias for node_type to maintain backward compatibility"""
        return self.node_type


class BaseLoopEvent(GraphBaseNodeEvent):
    loop_node_data: Any = Field(
        ..., description="node data"
    )  # Type: BaseNodeData from core.workflow.nodes.base.entities
    parallel_mode_run_id: Optional[str] = None
    """loop run in parallel mode run id"""

    @property
    def loop_id(self) -> str:
        """Alias for id to maintain backward compatibility"""
        return self.id

    @property
    def loop_node_id(self) -> str:
        """Alias for node_id to maintain backward compatibility"""
        return self.node_id

    @property
    def loop_node_type(self) -> NodeType:
        """Alias for node_type to maintain backward compatibility"""
        return self.node_type


class BaseAgentEvent(GraphBaseNodeEvent):
    pass


class NodeEvent(GraphEngineEvent, ABC):
    """Base class for all node events"""

    pass
