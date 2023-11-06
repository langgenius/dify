import json
from typing import Type, Optional, List

from flask import current_app
from langchain.tools import BaseTool
from pydantic import Field, BaseModel

from core.callback_handler.index_tool_callback_handler import DatasetIndexToolCallbackHandler
from core.conversation_message_task import ConversationMessageTask
from core.embedding.cached_embedding import CacheEmbedding
from core.index.keyword_table_index.keyword_table_index import KeywordTableIndex, KeywordTableConfig
from core.index.vector_index.vector_index import VectorIndex
from core.model_providers.error import LLMBadRequestError, ProviderTokenNotInitError
from core.model_providers.model_factory import ModelFactory
from extensions.ext_database import db
from models.dataset import Dataset, DocumentSegment, Document


class DatasetChooseToolInput(BaseModel):
    query: str = Field(..., description="Choose the dataset to be used")


class DatasetChooseTool(BaseTool):
    """Tool for querying a Dataset."""
    name: str = "dataset"
    args_schema: Type[BaseModel] = DatasetChooseToolInput
    description: str = "choose the dataset to be used. "

    tenant_id: str
    dataset_id: str

    @classmethod
    def from_dataset(cls, dataset: Dataset, **kwargs):
        description = dataset.description
        if not description:
            description = 'useful for when you want to answer queries about the ' + dataset.name

        description = description.replace('\n', '').replace('\r', '')
        return cls(
            name=f'dataset-{dataset.id}',
            tenant_id=dataset.tenant_id,
            dataset_id=dataset.id,
            description=description,
            **kwargs
        )

    def _run(self) -> List[str]:
        return [self.dataset_id]

    async def _arun(self, tool_input: str) -> str:
        raise NotImplementedError()
