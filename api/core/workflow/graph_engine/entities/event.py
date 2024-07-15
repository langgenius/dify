from typing import Optional

from pydantic import BaseModel, Field, model_validator

from core.workflow.entities.node_entities import NodeRunResult


class GraphEngineEvent(BaseModel):
    pass

###########################################
# Graph Events
###########################################


class BaseGraphEvent(GraphEngineEvent):
    pass


class GraphRunStartedEvent(BaseGraphEvent):
    pass


class GraphRunBackToRootEvent(BaseGraphEvent):
    pass


class GraphRunSucceededEvent(BaseGraphEvent):
    pass


class GraphRunFailedEvent(BaseGraphEvent):
    reason: str = Field(..., description="failed reason")


###########################################
# Node Events
###########################################


class BaseNodeEvent(GraphEngineEvent):
    node_id: str = Field(..., description="node id")
    parallel_id: Optional[str] = Field(None, description="parallel id if node is in parallel")
    # iteration_id: Optional[str] = Field(None, description="iteration id if node is in iteration")


class NodeRunStartedEvent(BaseNodeEvent):
    pass


class NodeRunStreamChunkEvent(BaseNodeEvent):
    chunk_content: str = Field(..., description="chunk content")


class NodeRunRetrieverResourceEvent(BaseNodeEvent):
    retriever_resources: list[dict] = Field(..., description="retriever resources")


class NodeRunSucceededEvent(BaseNodeEvent):
    run_result: NodeRunResult = Field(..., description="run result")


class NodeRunFailedEvent(BaseNodeEvent):
    run_result: NodeRunResult = Field(..., description="run result")
    reason: str = Field("", description="failed reason")

    @model_validator(mode='before')
    def init_reason(cls, values: dict) -> dict:
        if not values.get("reason"):
            values["reason"] = values.get("run_result").error or "Unknown error"
        return values


###########################################
# Parallel Events
###########################################


class BaseParallelEvent(GraphEngineEvent):
    parallel_id: str = Field(..., description="parallel id")


class ParallelRunStartedEvent(BaseParallelEvent):
    pass


class ParallelRunSucceededEvent(BaseParallelEvent):
    pass


class ParallelRunFailedEvent(BaseParallelEvent):
    reason: str = Field(..., description="failed reason")


###########################################
# Iteration Events
###########################################


class BaseIterationEvent(GraphEngineEvent):
    iteration_id: str = Field(..., description="iteration id")


class IterationRunStartedEvent(BaseIterationEvent):
    pass


class IterationRunSucceededEvent(BaseIterationEvent):
    pass


class IterationRunFailedEvent(BaseIterationEvent):
    reason: str = Field(..., description="failed reason")


InNodeEvent = BaseNodeEvent | BaseParallelEvent | BaseIterationEvent
