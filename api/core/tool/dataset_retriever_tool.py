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
from models.dataset import Dataset, DocumentSegment


class DatasetRetrieverToolInput(BaseModel):
    dataset_id: str = Field(..., description="ID of dataset to be queried. MUST be UUID format.")
    query: str = Field(..., description="Query for the dataset to be used to retrieve the dataset.")


class DatasetRetrieverTool(BaseTool):
    """Tool for querying a Dataset."""
    name: str = "dataset"
    args_schema: Type[BaseModel] = DatasetRetrieverToolInput
    description: str = "use this to retrieve a dataset. "

    tenant_id: str
    dataset_id: str
    k: int = 3

    @classmethod
    def from_dataset(cls, dataset: Dataset, **kwargs):
        description = dataset.description
        if not description:
            description = 'useful for when you want to answer queries about the ' + dataset.name

        description = description.replace('\n', '').replace('\r', '')
        description += '\nID of dataset MUST be ' + dataset.id
        return cls(
            tenant_id=dataset.tenant_id,
            dataset_id=dataset.id,
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
            return str("\n".join([document.page_content for document in documents]))
        else:
            model_credentials = LLMBuilder.get_model_credentials(
                tenant_id=dataset.tenant_id,
                model_provider=LLMBuilder.get_default_provider(dataset.tenant_id, 'text-embedding-ada-002'),
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
            document_context_list = []
            index_node_ids = [document.metadata['doc_id'] for document in documents]
            segments = DocumentSegment.query.filter(DocumentSegment.completed_at.isnot(None),
                                                    DocumentSegment.status == 'completed',
                                                    DocumentSegment.enabled == True,
                                                    DocumentSegment.index_node_id.in_(index_node_ids)
                                                    ).all()

            if segments:
                index_node_id_to_position = {id: position for position, id in enumerate(index_node_ids)}
                sorted_segments = sorted(segments,
                                         key=lambda segment: index_node_id_to_position.get(segment.index_node_id,
                                                                                           float('inf')))
                for segment in sorted_segments:
                    if segment.answer:
                        document_context_list.append(f'question:{segment.content} \nanswer:{segment.answer}')
                    else:
                        document_context_list.append(segment.content)

            return str("\n".join(document_context_list))

    async def _arun(self, tool_input: str) -> str:
        raise NotImplementedError()
