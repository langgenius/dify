from pydantic import BaseModel, Field

from core.model_runtime.entities.llm_entities import LLMUsage
from core.workflow.entities.node_entities import NodeRunResult


class RunCompletedEvent(BaseModel):
    run_result: NodeRunResult = Field(..., description="run result")


class RunStreamChunkEvent(BaseModel):
    chunk_content: str = Field(..., description="chunk content")
    from_variable_selector: list[str] = Field(..., description="from variable selector")


class RunRetrieverResourceEvent(BaseModel):
    retriever_resources: list[dict] = Field(..., description="retriever resources")
    context: str = Field(..., description="context")


class ModelInvokeCompletedEvent(BaseModel):
    """
    Model invoke completed
    """

    text: str
    usage: LLMUsage
    finish_reason: str | None = None
