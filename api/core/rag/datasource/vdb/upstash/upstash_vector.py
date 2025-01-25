import json
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, model_validator
from upstash_vector import Index, Vector

from configs import dify_config
from core.rag.datasource.vdb.vector_base import BaseVector
from core.rag.datasource.vdb.vector_factory import AbstractVectorFactory
from core.rag.datasource.vdb.vector_type import VectorType
from core.rag.embedding.embedding_base import Embeddings
from core.rag.models.document import Document
from models.dataset import Dataset


class UpstashVectorConfig(BaseModel):
    url: str
    token: str

    @model_validator(mode="before")
    @classmethod
    def validate_config(cls, values: dict) -> dict:
        if not values["url"]:
            raise ValueError("Upstash URL is required")
        if not values["token"]:
            raise ValueError("Upstash Token is required")
        return values


class UpstashVector(BaseVector):
    def __init__(self, collection_name: str, config: UpstashVectorConfig):
        super().__init__(collection_name)
        self._table_name = collection_name
        self.index = Index(url=config.url, token=config.token)

    def _get_index_dimension(self) -> int:
        index_info = self.index.info()
        if index_info and index_info.dimension:
            return index_info.dimension
        else:
            return 1536

    def create(self, texts: list[Document], embeddings: list[list[float]], **kwargs):
        self.add_texts(texts, embeddings)

    def add_texts(self, documents: list[Document], embeddings: list[list[float]], **kwargs):
        vectors = [
            Vector(
                id=str(uuid4()),
                vector=embedding,
                metadata=doc.metadata,
                data=doc.page_content,
            )
            for doc, embedding in zip(documents, embeddings)
        ]
        self.index.upsert(vectors=vectors)

    def text_exists(self, id: str) -> bool:
        response = self.get_ids_by_metadata_field("doc_id", id)
        return len(response) > 0

    def delete_by_ids(self, ids: list[str]) -> None:
        item_ids = []
        for doc_id in ids:
            ids = self.get_ids_by_metadata_field("doc_id", doc_id)
            if ids:
                item_ids += ids
        self._delete_by_ids(ids=item_ids)

    def _delete_by_ids(self, ids: list[str]) -> None:
        if ids:
            self.index.delete(ids=ids)

    def get_ids_by_metadata_field(self, key: str, value: str) -> list[str]:
        query_result = self.index.query(
            vector=[1.001 * i for i in range(self._get_index_dimension())],
            include_metadata=True,
            top_k=1000,
            filter=f"{key} = '{value}'",
        )
        return [result.id for result in query_result]

    def delete_by_metadata_field(self, key: str, value: str) -> None:
        ids = self.get_ids_by_metadata_field(key, value)
        if ids:
            self._delete_by_ids(ids)

    def search_by_vector(self, query_vector: list[float], **kwargs: Any) -> list[Document]:
        top_k = kwargs.get("top_k", 4)
        result = self.index.query(vector=query_vector, top_k=top_k, include_metadata=True, include_data=True)
        docs = []
        score_threshold = float(kwargs.get("score_threshold") or 0.0)
        for record in result:
            metadata = record.metadata
            text = record.data
            score = record.score
            if metadata is not None and text is not None:
                metadata["score"] = score
                if score > score_threshold:
                    docs.append(Document(page_content=text, metadata=metadata))
        return docs

    def search_by_full_text(self, query: str, **kwargs: Any) -> list[Document]:
        return []

    def delete(self) -> None:
        self.index.reset()

    def get_type(self) -> str:
        return VectorType.UPSTASH


class UpstashVectorFactory(AbstractVectorFactory):
    def init_vector(self, dataset: Dataset, attributes: list, embeddings: Embeddings) -> UpstashVector:
        if dataset.index_struct_dict:
            class_prefix: str = dataset.index_struct_dict["vector_store"]["class_prefix"]
            collection_name = class_prefix.lower()
        else:
            dataset_id = dataset.id
            collection_name = Dataset.gen_collection_name_by_id(dataset_id).lower()
            dataset.index_struct = json.dumps(self.gen_index_struct_dict(VectorType.UPSTASH, collection_name))

        return UpstashVector(
            collection_name=collection_name,
            config=UpstashVectorConfig(
                url=dify_config.UPSTASH_VECTOR_URL or "",
                token=dify_config.UPSTASH_VECTOR_TOKEN or "",
            ),
        )
