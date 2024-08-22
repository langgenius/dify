from pydantic import BaseModel, Field

from core.workflow.entities.node_entities import NodeRunResult


class RunCompletedEvent(BaseModel):
    run_result: NodeRunResult = Field(..., description="run result")


class RunStreamChunkEvent(BaseModel):
    chunk_content: str = Field(..., description="chunk content")
    from_variable_selector: list[str] = Field(..., description="from variable selector")


class RunRetrieverResourceEvent(BaseModel):
    retriever_resources: list[dict] = Field(..., description="retriever resources")
    context: str = Field(..., description="context")


RunEvent = RunCompletedEvent | RunStreamChunkEvent | RunRetrieverResourceEvent
