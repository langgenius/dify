import json
import time
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, model_validator
from supabase import Client

from configs import dify_config
from core.rag.datasource.vdb.supabase.supabase_sql import SQL_CREATE_TABLE
from core.rag.datasource.vdb.vector_base import BaseVector
from core.rag.datasource.vdb.vector_factory import AbstractVectorFactory
from core.rag.datasource.vdb.vector_type import VectorType
from core.rag.embedding.embedding_base import Embeddings
from core.rag.models.document import Document
from extensions.ext_redis import redis_client
from models.dataset import Dataset


class SupabaseVectorConfig(BaseModel):
    api_key: str
    url: str

    @model_validator(mode="before")
    @classmethod
    def validate_config(cls, values: dict) -> dict:
        if not values["api_key"]:
            raise ValueError("config Supabase API_KEY is required")
        if not values["url"]:
            raise ValueError("config Supabase URL is required")
        return values


class SupabaseVector(BaseVector):
    def __init__(self, collection_name: str, config: SupabaseVectorConfig):
        super().__init__(collection_name)
        self._table_name = collection_name
        self.client = Client(supabase_url=config.url, supabase_key=config.api_key)
        print(config.url, config.api_key)

    def _create_table_if_not_exists(self, dimension: int):
        lock_name = "vector_indexing_lock_{}".format(self._table_name)
        with redis_client.lock(lock_name, timeout=20):
            collection_exist_cache_key = "vector_indexing_{}".format(self._collection_name)
            if redis_client.get(collection_exist_cache_key):
                return
            create_table_sql = SQL_CREATE_TABLE.format(table_name=self._table_name, dimension=dimension)
            print(create_table_sql)
            self.client.rpc("execute_sql", {"sql": create_table_sql}).execute()
            # Waiting for the database table to be created
            time.sleep(1)
            redis_client.set(collection_exist_cache_key, 1, ex=3600)

    def create(self, texts: list[Document], embeddings: list[list[float]], **kwargs):
        dimension = len(embeddings[0])
        self._create_table_if_not_exists(dimension)
        data = [
            {"id": str(uuid4()), "text": doc.page_content, "meta": doc.metadata, "embedding": embedding}
            for doc, embedding in zip(texts, embeddings)
        ]
        self.client.table(self._table_name).insert(data).execute()

    def add_texts(self, documents: list[Document], embeddings: list[list[float]], **kwargs):
        data = [
            {"id": str(uuid4()), "text": doc.page_content, "meta": doc.metadata, "embedding": embedding}
            for doc, embedding in zip(documents, embeddings)
        ]
        self.client.table(self._table_name).insert(data).execute()

    def text_exists(self, id: str) -> bool:
        response = self.client.table(self._table_name).select("*").eq("id", id).execute()
        return len(response.data) > 0

    def delete_by_ids(self, ids: list[str]) -> None:
        self.client.table(self._table_name).delete().in_("id", ids).execute()

    def delete_by_metadata_field(self, key: str, value: str) -> None:
        self.client.table(self._table_name).delete().eq(f"meta->{key}", value).execute()

    def search_by_vector(self, query_vector: list[float], **kwargs: Any) -> list[Document]:
        top_k = kwargs.get("top_k", 4)

        result = self.client.rpc(
            "search_vector", {"table_name": self._table_name, "query_vector": query_vector, "result_limit": top_k}
        ).execute()

        docs = []
        score_threshold = float(kwargs.get("score_threshold") or 0.0)
        for record in result.data:
            metadata = record["meta"]
            text = record["text"]
            distance = record["distance"]
            score = 1 - distance
            metadata["score"] = score

            if score > score_threshold:
                docs.append(Document(page_content=text, metadata=metadata))
        return docs

    def search_by_full_text(self, query: str, **kwargs: Any) -> list[Document]:
        """
        Search for documents based on full text query using Supabase.

        :param query: The input text to search for similar items.
        :return: List of Documents that match the full text query.
        """
        top_k = kwargs.get("top_k", 4)
        result = self.client.rpc(
            "search_full_text", {"table_name": self._table_name, "query": query, "result_limit": top_k}
        ).execute()

        docs = []
        for record in result.data:
            metadata = record["meta"]
            metadata["score"] = record["score"]
            docs.append(Document(page_content=record["text"], metadata=metadata))

        return docs

    def delete(self) -> None:
        drop_table_sql = f"DROP TABLE IF EXISTS {self._table_name};"
        self.client.rpc("execute_sql", {"sql": drop_table_sql}).execute()

    def get_type(self) -> str:
        return VectorType.SUPABASE


class SupabaseVectorFactory(AbstractVectorFactory):
    def init_vector(self, dataset: Dataset, attributes: list, embeddings: Embeddings) -> SupabaseVector:
        if dataset.index_struct_dict:
            class_prefix: str = dataset.index_struct_dict["vector_store"]["class_prefix"]
            collection_name = class_prefix.lower()
        else:
            dataset_id = dataset.id
            collection_name = Dataset.gen_collection_name_by_id(dataset_id)
            dataset.index_struct = json.dumps(self.gen_index_struct_dict(VectorType.SUPABASE, collection_name))

        return SupabaseVector(
            collection_name=collection_name,
            config=SupabaseVectorConfig(
                api_key=dify_config.SUPABASE_VECTOR_API_KEY,
                url=dify_config.SUPABASE_VECTOR_URL,
                dimension=dify_config.SUPABASE_VECTOR_DIMENSION,
            ),
        )
