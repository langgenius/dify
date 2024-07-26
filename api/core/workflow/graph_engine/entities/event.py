from typing import Any, Optional

from pydantic import BaseModel, Field

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
    pass


class GraphRunFailedEvent(BaseGraphEvent):
    reason: str = Field(..., description="failed reason")


###########################################
# Node Events
###########################################


class BaseNodeEvent(GraphEngineEvent):
    route_node_state: RouteNodeState = Field(..., description="route node state")
    parallel_id: Optional[str] = None
    """parallel id if node is in parallel"""
    parallel_start_node_id: Optional[str] = None
    """parallel start node id if node is in parallel"""
    # iteration_id: Optional[str] = Field(None, description="iteration id if node is in iteration")


class NodeRunStartedEvent(BaseNodeEvent):
    pass


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
    pass


###########################################
# Parallel Branch Events
###########################################


class BaseParallelBranchEvent(GraphEngineEvent):
    parallel_id: str = Field(..., description="parallel id")
    parallel_start_node_id: str = Field(..., description="parallel start node id")


class ParallelBranchRunStartedEvent(BaseParallelBranchEvent):
    pass


class ParallelBranchRunSucceededEvent(BaseParallelBranchEvent):
    pass


class ParallelBranchRunFailedEvent(BaseParallelBranchEvent):
    reason: str = Field(..., description="failed reason")


###########################################
# Iteration Events
###########################################


class BaseIterationEvent(GraphEngineEvent):
    iteration_id: str = Field(..., description="iteration id")


class IterationRunStartedEvent(BaseIterationEvent):
    pass


class IterationRunNextEvent(BaseIterationEvent):
    index: int = Field(..., description="index")
    pre_iteration_output: Optional[Any] = Field(None, description="pre iteration output")


class IterationRunSucceededEvent(BaseIterationEvent):
    pass


class IterationRunFailedEvent(BaseIterationEvent):
    reason: str = Field(..., description="failed reason")


InNodeEvent = BaseNodeEvent | BaseParallelBranchEvent | BaseIterationEvent
