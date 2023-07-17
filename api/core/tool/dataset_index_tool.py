from flask import current_app
from langchain.embeddings import OpenAIEmbeddings
from langchain.tools import BaseTool

from core.callback_handler.index_tool_callback_handler import DatasetIndexToolCallbackHandler
from core.embedding.cached_embedding import CacheEmbedding
from core.index.keyword_table_index.keyword_table_index import KeywordTableIndex, KeywordTableConfig
from core.index.vector_index.vector_index import VectorIndex
from core.llm.llm_builder import LLMBuilder
from models.dataset import Dataset


class DatasetTool(BaseTool):
    """Tool for querying a Dataset."""

    dataset: Dataset
    k: int = 2

    def _run(self, tool_input: str) -> str:
        if self.dataset.indexing_technique == "economy":
            # use keyword table query
            kw_table_index = KeywordTableIndex(
                dataset=self.dataset,
                config=KeywordTableConfig(
                    max_keywords_per_chunk=5
                )
            )

            documents = kw_table_index.search(tool_input, search_kwargs={'k': self.k})
        else:
            model_credentials = LLMBuilder.get_model_credentials(
                tenant_id=self.dataset.tenant_id,
                model_provider=LLMBuilder.get_default_provider(self.dataset.tenant_id, 'text-embedding-ada-002'),
                model_name='text-embedding-ada-002'
            )

            embeddings = CacheEmbedding(OpenAIEmbeddings(
                **model_credentials
            ))

            vector_index = VectorIndex(
                dataset=self.dataset,
                config=current_app.config,
                embeddings=embeddings
            )

            documents = vector_index.search(
                tool_input,
                search_type='similarity',
                search_kwargs={
                    'k': self.k
                }
            )

            hit_callback = DatasetIndexToolCallbackHandler(self.dataset.id)
            hit_callback.on_tool_end(documents)

        return str("\n".join([document.page_content for document in documents]))

    async def _arun(self, tool_input: str) -> str:
        model_credentials = LLMBuilder.get_model_credentials(
            tenant_id=self.dataset.tenant_id,
            model_provider=LLMBuilder.get_default_provider(self.dataset.tenant_id, 'text-embedding-ada-002'),
            model_name='text-embedding-ada-002'
        )

        embeddings = CacheEmbedding(OpenAIEmbeddings(
            **model_credentials
        ))

        vector_index = VectorIndex(
            dataset=self.dataset,
            config=current_app.config,
            embeddings=embeddings
        )

        documents = await vector_index.asearch(
            tool_input,
            search_type='similarity',
            search_kwargs={
                'k': 10
            }
        )

        hit_callback = DatasetIndexToolCallbackHandler(self.dataset.id)
        hit_callback.on_tool_end(documents)
        return str("\n".join([document.page_content for document in documents]))
