import json
from typing import Any

from configs import dify_config
from core.rag.datasource.vdb.analyticdb.analyticdb_vector_openapi import (
    AnalyticdbVectorOpenAPI,
    AnalyticdbVectorOpenAPIConfig,
)
from core.rag.datasource.vdb.analyticdb.analyticdb_vector_sql import AnalyticdbVectorBySql, AnalyticdbVectorBySqlConfig
from core.rag.datasource.vdb.vector_base import BaseVector
from core.rag.datasource.vdb.vector_factory import AbstractVectorFactory
from core.rag.datasource.vdb.vector_type import VectorType
from core.rag.embedding.embedding_base import Embeddings
from core.rag.models.document import Document
from models.dataset import Dataset


class AnalyticdbVector(BaseVector):
    def __init__(
        self,
        collection_name: str,
        api_config: AnalyticdbVectorOpenAPIConfig | None,
        sql_config: AnalyticdbVectorBySqlConfig | None,
    ):
        super().__init__(collection_name)
        if api_config is not None:
            self.analyticdb_vector: AnalyticdbVectorOpenAPI | AnalyticdbVectorBySql = AnalyticdbVectorOpenAPI(
                collection_name, api_config
            )
        else:
            if sql_config is None:
                raise ValueError("Either api_config or sql_config must be provided")
            self.analyticdb_vector = AnalyticdbVectorBySql(collection_name, sql_config)

    def get_type(self) -> str:
        return VectorType.ANALYTICDB

    def create(self, texts: list[Document], embeddings: list[list[float]], **kwargs):
        dimension = len(embeddings[0])
        self.analyticdb_vector._create_collection_if_not_exists(dimension)
        self.analyticdb_vector.add_texts(texts, embeddings)

    def add_texts(self, documents: list[Document], embeddings: list[list[float]], **kwargs):
        self.analyticdb_vector.add_texts(documents, embeddings)

    def text_exists(self, id: str) -> bool:
        return self.analyticdb_vector.text_exists(id)

    def delete_by_ids(self, ids: list[str]) -> None:
        self.analyticdb_vector.delete_by_ids(ids)

    def delete_by_metadata_field(self, key: str, value: str) -> None:
        self.analyticdb_vector.delete_by_metadata_field(key, value)

    def search_by_vector(self, query_vector: list[float], **kwargs: Any) -> list[Document]:
        return self.analyticdb_vector.search_by_vector(query_vector)

    def search_by_full_text(self, query: str, **kwargs: Any) -> list[Document]:
        return self.analyticdb_vector.search_by_full_text(query, **kwargs)

    def delete(self) -> None:
        self.analyticdb_vector.delete()


class AnalyticdbVectorFactory(AbstractVectorFactory):
    def init_vector(self, dataset: Dataset, attributes: list, embeddings: Embeddings) -> AnalyticdbVector:
        if dataset.index_struct_dict:
            class_prefix: str = dataset.index_struct_dict["vector_store"]["class_prefix"]
            collection_name = class_prefix.lower()
        else:
            dataset_id = dataset.id
            collection_name = Dataset.gen_collection_name_by_id(dataset_id).lower()
            dataset.index_struct = json.dumps(self.gen_index_struct_dict(VectorType.ANALYTICDB, collection_name))

        if dify_config.ANALYTICDB_HOST is None:
            # implemented through OpenAPI
            apiConfig = AnalyticdbVectorOpenAPIConfig(
                access_key_id=dify_config.ANALYTICDB_KEY_ID or "",
                access_key_secret=dify_config.ANALYTICDB_KEY_SECRET or "",
                region_id=dify_config.ANALYTICDB_REGION_ID or "",
                instance_id=dify_config.ANALYTICDB_INSTANCE_ID or "",
                account=dify_config.ANALYTICDB_ACCOUNT or "",
                account_password=dify_config.ANALYTICDB_PASSWORD or "",
                namespace=dify_config.ANALYTICDB_NAMESPACE or "",
                namespace_password=dify_config.ANALYTICDB_NAMESPACE_PASSWORD,
            )
            sqlConfig = None
        else:
            # implemented through sql
            sqlConfig = AnalyticdbVectorBySqlConfig(
                host=dify_config.ANALYTICDB_HOST,
                port=dify_config.ANALYTICDB_PORT,
                account=dify_config.ANALYTICDB_ACCOUNT or "",
                account_password=dify_config.ANALYTICDB_PASSWORD or "",
                min_connection=dify_config.ANALYTICDB_MIN_CONNECTION,
                max_connection=dify_config.ANALYTICDB_MAX_CONNECTION,
                namespace=dify_config.ANALYTICDB_NAMESPACE or "",
            )
            apiConfig = None
        return AnalyticdbVector(
            collection_name,
            apiConfig,
            sqlConfig,
        )
