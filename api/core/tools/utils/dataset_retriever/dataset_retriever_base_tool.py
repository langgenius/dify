from abc import ABC, abstractmethod

from pydantic import BaseModel, ConfigDict

from core.callback_handler.index_tool_callback_handler import DatasetIndexToolCallbackHandler


class DatasetRetrieverBaseTool(BaseModel, ABC):
    """Tool for querying a Dataset."""

    name: str = "dataset"
    description: str = "use this to retrieve a dataset. "
    tenant_id: str
    top_k: int = 4
    score_threshold: float | None = None
    hit_callbacks: list[DatasetIndexToolCallbackHandler] = []
    return_resource: bool
    retriever_from: str
    model_config = ConfigDict(arbitrary_types_allowed=True)

    def run(self, query: str) -> str:
        """Use the tool."""
        return self._run(query)

    @abstractmethod
    def _run(self, query: str) -> str:
        """Use the tool.

        Add run_manager: Optional[CallbackManagerForToolRun] = None
        to child implementations to enable tracing,
        """
