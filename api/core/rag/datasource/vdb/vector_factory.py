from abc import ABC, abstractmethod
from typing import Any, Optional

from configs import dify_config
from core.model_manager import ModelManager
from core.model_runtime.entities.model_entities import ModelType
from core.rag.datasource.vdb.vector_base import BaseVector
from core.rag.datasource.vdb.vector_type import VectorType
from core.rag.embedding.cached_embedding import CacheEmbedding
from core.rag.embedding.embedding_base import Embeddings
from core.rag.models.document import Document
from extensions.ext_redis import redis_client
from models.dataset import Dataset


class AbstractVectorFactory(ABC):
    @abstractmethod
    def init_vector(self, dataset: Dataset, attributes: list, embeddings: Embeddings) -> BaseVector:
        raise NotImplementedError

    @staticmethod
    def gen_index_struct_dict(vector_type: VectorType, collection_name: str) -> dict:
        index_struct_dict = {"type": vector_type, "vector_store": {"class_prefix": collection_name}}
        return index_struct_dict


class Vector:
    def __init__(self, dataset: Dataset, attributes: Optional[list] = None):
        if attributes is None:
            attributes = ["doc_id", "dataset_id", "document_id", "doc_hash"]
        self._dataset = dataset
        self._embeddings = self._get_embeddings()
        self._attributes = attributes
        self._vector_processor = self._init_vector()

    def _init_vector(self) -> BaseVector:
        vector_type = dify_config.VECTOR_STORE
        if self._dataset.index_struct_dict:
            vector_type = self._dataset.index_struct_dict["type"]

        if not vector_type:
            raise ValueError("Vector store must be specified.")

        vector_factory_cls = self.get_vector_factory(vector_type)
        return vector_factory_cls().init_vector(self._dataset, self._attributes, self._embeddings)

    @staticmethod
    def get_vector_factory(vector_type: str) -> type[AbstractVectorFactory]:
        match vector_type:
            case VectorType.CHROMA:
                from core.rag.datasource.vdb.chroma.chroma_vector import ChromaVectorFactory

                return ChromaVectorFactory
            case VectorType.MILVUS:
                from core.rag.datasource.vdb.milvus.milvus_vector import MilvusVectorFactory

                return MilvusVectorFactory
            case VectorType.MYSCALE:
                from core.rag.datasource.vdb.myscale.myscale_vector import MyScaleVectorFactory

                return MyScaleVectorFactory
            case VectorType.PGVECTOR:
                from core.rag.datasource.vdb.pgvector.pgvector import PGVectorFactory

                return PGVectorFactory
            case VectorType.PGVECTO_RS:
                from core.rag.datasource.vdb.pgvecto_rs.pgvecto_rs import PGVectoRSFactory

                return PGVectoRSFactory
            case VectorType.QDRANT:
                from core.rag.datasource.vdb.qdrant.qdrant_vector import QdrantVectorFactory

                return QdrantVectorFactory
            case VectorType.RELYT:
                from core.rag.datasource.vdb.relyt.relyt_vector import RelytVectorFactory

                return RelytVectorFactory
            case VectorType.ELASTICSEARCH:
                from core.rag.datasource.vdb.elasticsearch.elasticsearch_vector import ElasticSearchVectorFactory

                return ElasticSearchVectorFactory
            case VectorType.TIDB_VECTOR:
                from core.rag.datasource.vdb.tidb_vector.tidb_vector import TiDBVectorFactory

                return TiDBVectorFactory
            case VectorType.WEAVIATE:
                from core.rag.datasource.vdb.weaviate.weaviate_vector import WeaviateVectorFactory

                return WeaviateVectorFactory
            case VectorType.TENCENT:
                from core.rag.datasource.vdb.tencent.tencent_vector import TencentVectorFactory

                return TencentVectorFactory
            case VectorType.ORACLE:
                from core.rag.datasource.vdb.oracle.oraclevector import OracleVectorFactory

                return OracleVectorFactory
            case VectorType.OPENSEARCH:
                from core.rag.datasource.vdb.opensearch.opensearch_vector import OpenSearchVectorFactory

                return OpenSearchVectorFactory
            case VectorType.ANALYTICDB:
                from core.rag.datasource.vdb.analyticdb.analyticdb_vector import AnalyticdbVectorFactory

                return AnalyticdbVectorFactory
            case VectorType.BAIDU:
                from core.rag.datasource.vdb.baidu.baidu_vector import BaiduVectorFactory

                return BaiduVectorFactory
            case VectorType.VIKINGDB:
                from core.rag.datasource.vdb.vikingdb.vikingdb_vector import VikingDBVectorFactory

                return VikingDBVectorFactory
            case _:
                raise ValueError(f"Vector store {vector_type} is not supported.")

    def create(self, texts: Optional[list] = None, **kwargs):
        if texts:
            embeddings = self._embeddings.embed_documents([document.page_content for document in texts])
            self._vector_processor.create(texts=texts, embeddings=embeddings, **kwargs)

    def add_texts(self, documents: list[Document], **kwargs):
        if kwargs.get("duplicate_check", False):
            documents = self._filter_duplicate_texts(documents)

        embeddings = self._embeddings.embed_documents([document.page_content for document in documents])
        self._vector_processor.create(texts=documents, embeddings=embeddings, **kwargs)

    def text_exists(self, id: str) -> bool:
        return self._vector_processor.text_exists(id)

    def delete_by_ids(self, ids: list[str]) -> None:
        self._vector_processor.delete_by_ids(ids)

    def delete_by_metadata_field(self, key: str, value: str) -> None:
        self._vector_processor.delete_by_metadata_field(key, value)

    def search_by_vector(self, query: str, **kwargs: Any) -> list[Document]:
        query_vector = self._embeddings.embed_query(query)
        return self._vector_processor.search_by_vector(query_vector, **kwargs)

    def search_by_full_text(self, query: str, **kwargs: Any) -> list[Document]:
        return self._vector_processor.search_by_full_text(query, **kwargs)

    def delete(self) -> None:
        self._vector_processor.delete()
        # delete collection redis cache
        if self._vector_processor.collection_name:
            collection_exist_cache_key = "vector_indexing_{}".format(self._vector_processor.collection_name)
            redis_client.delete(collection_exist_cache_key)

    def _get_embeddings(self) -> Embeddings:
        model_manager = ModelManager()

        embedding_model = model_manager.get_model_instance(
            tenant_id=self._dataset.tenant_id,
            provider=self._dataset.embedding_model_provider,
            model_type=ModelType.TEXT_EMBEDDING,
            model=self._dataset.embedding_model,
        )
        return CacheEmbedding(embedding_model)

    def _filter_duplicate_texts(self, texts: list[Document]) -> list[Document]:
        for text in texts.copy():
            doc_id = text.metadata["doc_id"]
            exists_duplicate_node = self.text_exists(doc_id)
            if exists_duplicate_node:
                texts.remove(text)

        return texts

    def __getattr__(self, name):
        if self._vector_processor is not None:
            method = getattr(self._vector_processor, name)
            if callable(method):
                return method

        raise AttributeError(f"'vector_processor' object has no attribute '{name}'")
