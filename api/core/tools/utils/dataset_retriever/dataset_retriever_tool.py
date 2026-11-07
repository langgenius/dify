from typing import override

from pydantic import BaseModel, Field

from core.app.app_config.entities import DatasetRetrieveConfigEntity
from core.tools.utils.dataset_retriever.dataset_retriever_base_tool import DatasetRetrieverBaseTool
from graphon.nodes.llm.entities import ModelConfig
from services.knowledge.entities.retrieval import KnowledgeRetrievalRequest, RetrievableDataset


class DatasetRetrieverToolInput(BaseModel):
    query: str = Field(..., description="Query for the dataset to be used to retrieve the dataset.")


class DatasetRetrieverTool(DatasetRetrieverBaseTool):
    """Tool for querying a Dataset."""

    name: str = "dataset"
    args_schema: type[BaseModel] = DatasetRetrieverToolInput
    description: str = "use this to retrieve a dataset. "
    dataset_id: str
    retrieve_config: DatasetRetrieveConfigEntity

    @classmethod
    def from_dataset(cls, dataset: RetrievableDataset, tenant_id: str, **kwargs):
        description = dataset.description
        if not description:
            description = "useful for when you want to answer queries about the " + dataset.name

        description = description.replace("\n", "").replace("\r", "")
        return cls(
            name=f"dataset_{dataset.dataset_id.replace('-', '_')}",
            tenant_id=tenant_id,
            dataset_id=dataset.dataset_id,
            description=description,
            **kwargs,
        )

    @override
    def _run(self, query: str) -> str:
        metadata_model_config = self.retrieve_config.metadata_model_config
        result = self.knowledge_retrieval.retrieve(
            KnowledgeRetrievalRequest(
                tenant_id=self.tenant_id,
                user_id=self.user_id,
                user_from=self.user_from,
                app_id=self.app_id,
                dataset_ids=[self.dataset_id],
                query=query,
                retrieval_mode="direct",
                metadata_filtering_mode=self.retrieve_config.metadata_filtering_mode or "disabled",
                metadata_model_config=(
                    ModelConfig.model_validate(metadata_model_config.model_dump()) if metadata_model_config else None
                ),
                metadata_filtering_conditions=self.retrieve_config.metadata_filtering_conditions,
                metadata_inputs=self.metadata_inputs,
                retriever_from=self.retriever_from,
            ),
            request_metadata={"app_id": self.app_id},
        )
        self._publish_retriever_resources(result.sources)
        return result.context
