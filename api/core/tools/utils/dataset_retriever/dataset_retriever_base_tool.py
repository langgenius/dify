from abc import ABC, abstractmethod
from collections.abc import Sequence

from pydantic import BaseModel, ConfigDict, Field, SkipValidation

from core.callback_handler.index_tool_callback_handler import DatasetIndexToolCallbackHandler
from services.knowledge.entities.citation import RetrievalSourceMetadata, to_retrieval_source_metadata
from services.knowledge.entities.retrieval import Source
from services.knowledge.retrieval.retrieval import KnowledgeRetriever


class DatasetRetrieverBaseTool(BaseModel, ABC):
    """Tool for querying a Dataset."""

    name: str = "dataset"
    description: str = "use this to retrieve a dataset. "
    tenant_id: str
    app_id: str
    user_id: str
    user_from: str
    hit_callbacks: list[DatasetIndexToolCallbackHandler] = Field(default_factory=list)
    return_resource: bool
    retriever_from: str
    metadata_inputs: dict[str, str] = Field(default_factory=dict)
    knowledge_retrieval: SkipValidation[KnowledgeRetriever]
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

    def _publish_retriever_resources(self, sources: Sequence[Source]) -> None:
        if not self.return_resource or not sources:
            return
        resources: list[RetrievalSourceMetadata] = []
        for source in sources:
            resources.append(to_retrieval_source_metadata(source))
        for hit_callback in self.hit_callbacks:
            hit_callback.return_retriever_resource_info(resources)
