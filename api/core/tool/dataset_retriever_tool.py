import re
from typing import Type

from flask import current_app
from langchain.embeddings import OpenAIEmbeddings
from langchain.tools import BaseTool
from pydantic import Field, BaseModel

from core.callback_handler.index_tool_callback_handler import DatasetIndexToolCallbackHandler
from core.embedding.cached_embedding import CacheEmbedding
from core.index.keyword_table_index.keyword_table_index import KeywordTableIndex, KeywordTableConfig
from core.index.vector_index.vector_index import VectorIndex
from core.llm.llm_builder import LLMBuilder
from extensions.ext_database import db
from models.dataset import Dataset


class DatasetRetrieverToolInput(BaseModel):
    dataset_id: str = Field(..., description="ID of dataset to be queried. MUST be UUID format.")
    query: str = Field(..., description="Query for the dataset to be used to retrieve the dataset.")


class DatasetRetrieverTool(BaseTool):
    """Tool for querying a Dataset."""
    name: str = "dataset_retriever"
    args_schema: Type[BaseModel] = DatasetRetrieverToolInput
    description: str = "use this to retrieve a dataset. "

    tenant_id: str
    k: int = 3

    @classmethod
    def from_dataset(cls, dataset: Dataset, **kwargs):
        description = dataset.description
        if not description:
            description = 'useful for when you want to answer queries about the ' + dataset.name

        description += '\nID of dataset MUST be ' + dataset.id
        return cls(
            tenant_id=dataset.tenant_id,
            description=description,
            **kwargs
        )

    def _run(self, dataset_id: str, query: str) -> str:
        pattern = r'\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b'
        match = re.search(pattern, dataset_id, re.IGNORECASE)
        if match:
            dataset_id = match.group()

        dataset = db.session.query(Dataset).filter(
            Dataset.tenant_id == self.tenant_id,
            Dataset.id == dataset_id
        ).first()

        if not dataset:
            return f'[{self.name} failed to find dataset with id {dataset_id}.]'

        if dataset.indexing_technique == "economy":
            # use keyword table query
            kw_table_index = KeywordTableIndex(
                dataset=dataset,
                config=KeywordTableConfig(
                    max_keywords_per_chunk=5
                )
            )

            documents = kw_table_index.search(query, search_kwargs={'k': self.k})
        else:
            model_credentials = LLMBuilder.get_model_credentials(
                tenant_id=dataset.tenant_id,
                model_provider=LLMBuilder.get_default_provider(dataset.tenant_id),
                model_name='text-embedding-ada-002'
            )

            embeddings = CacheEmbedding(OpenAIEmbeddings(
                **model_credentials
            ))

            vector_index = VectorIndex(
                dataset=dataset,
                config=current_app.config,
                embeddings=embeddings
            )

            if self.k > 0:
                documents = vector_index.search(
                    query,
                    search_type='similarity',
                    search_kwargs={
                        'k': self.k
                    }
                )
            else:
                documents = []

            hit_callback = DatasetIndexToolCallbackHandler(dataset.id)
            hit_callback.on_tool_end(documents)

        return str("\n".join([document.page_content for document in documents]))

    async def _arun(self, tool_input: str) -> str:
        raise NotImplementedError()
