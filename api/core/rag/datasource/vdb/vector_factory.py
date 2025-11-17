import logging
import time
from abc import ABC, abstractmethod
from typing import Any

from sqlalchemy import select

from configs import dify_config
from core.model_manager import ModelManager
from core.model_runtime.entities.model_entities import ModelType
from core.rag.datasource.vdb.vector_base import BaseVector
from core.rag.datasource.vdb.vector_type import VectorType
from core.rag.embedding.cached_embedding import CacheEmbedding
from core.rag.embedding.embedding_base import Embeddings
from core.rag.models.document import Document
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models.dataset import Dataset, Whitelist

logger = logging.getLogger(__name__)


class AbstractVectorFactory(ABC):
    @abstractmethod
    def init_vector(self, dataset: Dataset, attributes: list, embeddings: Embeddings) -> BaseVector:
        raise NotImplementedError

    @staticmethod
    def gen_index_struct_dict(vector_type: VectorType, collection_name: str):
        index_struct_dict = {"type": vector_type, "vector_store": {"class_prefix": collection_name}}
        return index_struct_dict


VECTOR_FACTORY_CLS: type[AbstractVectorFactory]

match dify_config.VECTOR_STORE:
    case VectorType.CHROMA:
        from core.rag.datasource.vdb.chroma.chroma_vector import ChromaVectorFactory

        VECTOR_FACTORY_CLS = ChromaVectorFactory
    case VectorType.MILVUS:
        from core.rag.datasource.vdb.milvus.milvus_vector import MilvusVectorFactory

        VECTOR_FACTORY_CLS = MilvusVectorFactory
    case VectorType.ALIBABACLOUD_MYSQL:
        from core.rag.datasource.vdb.alibabacloud_mysql.alibabacloud_mysql_vector import (
            AlibabaCloudMySQLVectorFactory,
        )

        VECTOR_FACTORY_CLS = AlibabaCloudMySQLVectorFactory
    case VectorType.MYSCALE:
        from core.rag.datasource.vdb.myscale.myscale_vector import MyScaleVectorFactory

        VECTOR_FACTORY_CLS = MyScaleVectorFactory
    case VectorType.PGVECTOR:
        from core.rag.datasource.vdb.pgvector.pgvector import PGVectorFactory

        VECTOR_FACTORY_CLS = PGVectorFactory
    case VectorType.VASTBASE:
        from core.rag.datasource.vdb.pyvastbase.vastbase_vector import VastbaseVectorFactory

        VECTOR_FACTORY_CLS = VastbaseVectorFactory
    case VectorType.PGVECTO_RS:
        from core.rag.datasource.vdb.pgvecto_rs.pgvecto_rs import PGVectoRSFactory

        VECTOR_FACTORY_CLS = PGVectoRSFactory
    case VectorType.QDRANT:
        from core.rag.datasource.vdb.qdrant.qdrant_vector import QdrantVectorFactory

        VECTOR_FACTORY_CLS = QdrantVectorFactory
    case VectorType.RELYT:
        from core.rag.datasource.vdb.relyt.relyt_vector import RelytVectorFactory

        VECTOR_FACTORY_CLS = RelytVectorFactory
    case VectorType.ELASTICSEARCH:
        from core.rag.datasource.vdb.elasticsearch.elasticsearch_vector import ElasticSearchVectorFactory

        VECTOR_FACTORY_CLS = ElasticSearchVectorFactory
    case VectorType.ELASTICSEARCH_JA:
        from core.rag.datasource.vdb.elasticsearch.elasticsearch_ja_vector import (
            ElasticSearchJaVectorFactory,
        )

        VECTOR_FACTORY_CLS = ElasticSearchJaVectorFactory
    case VectorType.TIDB_VECTOR:
        from core.rag.datasource.vdb.tidb_vector.tidb_vector import TiDBVectorFactory

        VECTOR_FACTORY_CLS = TiDBVectorFactory
    case VectorType.WEAVIATE:
        from core.rag.datasource.vdb.weaviate.weaviate_vector import WeaviateVectorFactory

        VECTOR_FACTORY_CLS = WeaviateVectorFactory
    case VectorType.TENCENT:
        from core.rag.datasource.vdb.tencent.tencent_vector import TencentVectorFactory

        VECTOR_FACTORY_CLS = TencentVectorFactory
    case VectorType.ORACLE:
        from core.rag.datasource.vdb.oracle.oraclevector import OracleVectorFactory

        VECTOR_FACTORY_CLS = OracleVectorFactory
    case VectorType.OPENSEARCH:
        from core.rag.datasource.vdb.opensearch.opensearch_vector import OpenSearchVectorFactory

        VECTOR_FACTORY_CLS = OpenSearchVectorFactory
    case VectorType.ANALYTICDB:
        from core.rag.datasource.vdb.analyticdb.analyticdb_vector import AnalyticdbVectorFactory

        VECTOR_FACTORY_CLS = AnalyticdbVectorFactory
    case VectorType.COUCHBASE:
        from core.rag.datasource.vdb.couchbase.couchbase_vector import CouchbaseVectorFactory

        VECTOR_FACTORY_CLS = CouchbaseVectorFactory
    case VectorType.BAIDU:
        from core.rag.datasource.vdb.baidu.baidu_vector import BaiduVectorFactory

        VECTOR_FACTORY_CLS = BaiduVectorFactory
    case VectorType.VIKINGDB:
        from core.rag.datasource.vdb.vikingdb.vikingdb_vector import VikingDBVectorFactory

        VECTOR_FACTORY_CLS = VikingDBVectorFactory
    case VectorType.UPSTASH:
        from core.rag.datasource.vdb.upstash.upstash_vector import UpstashVectorFactory

        VECTOR_FACTORY_CLS = UpstashVectorFactory
    case VectorType.TIDB_ON_QDRANT:
        from core.rag.datasource.vdb.tidb_on_qdrant.tidb_on_qdrant_vector import TidbOnQdrantVectorFactory

        VECTOR_FACTORY_CLS = TidbOnQdrantVectorFactory
    case VectorType.LINDORM:
        from core.rag.datasource.vdb.lindorm.lindorm_vector import LindormVectorStoreFactory

        VECTOR_FACTORY_CLS = LindormVectorStoreFactory
    case VectorType.OCEANBASE:
        from core.rag.datasource.vdb.oceanbase.oceanbase_vector import OceanBaseVectorFactory

        VECTOR_FACTORY_CLS = OceanBaseVectorFactory
    case VectorType.OPENGAUSS:
        from core.rag.datasource.vdb.opengauss.opengauss import OpenGaussFactory

        VECTOR_FACTORY_CLS = OpenGaussFactory
    case VectorType.TABLESTORE:
        from core.rag.datasource.vdb.tablestore.tablestore_vector import TableStoreVectorFactory

        VECTOR_FACTORY_CLS = TableStoreVectorFactory
    case VectorType.HUAWEI_CLOUD:
        from core.rag.datasource.vdb.huawei.huawei_cloud_vector import HuaweiCloudVectorFactory

        VECTOR_FACTORY_CLS = HuaweiCloudVectorFactory
    case VectorType.MATRIXONE:
        from core.rag.datasource.vdb.matrixone.matrixone_vector import MatrixoneVectorFactory

        VECTOR_FACTORY_CLS = MatrixoneVectorFactory
    case VectorType.CLICKZETTA:
        from core.rag.datasource.vdb.clickzetta.clickzetta_vector import ClickzettaVectorFactory

        VECTOR_FACTORY_CLS = ClickzettaVectorFactory
    case _:
        raise ValueError(f"Vector store {dify_config.VECTOR_STORE} is not supported.")


class Vector:
    def __init__(self, dataset: Dataset, attributes: list | None = None):
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
        else:
            if dify_config.VECTOR_STORE_WHITELIST_ENABLE:
                stmt = select(Whitelist).where(
                    Whitelist.tenant_id == self._dataset.tenant_id, Whitelist.category == "vector_db"
                )
                whitelist = db.session.scalars(stmt).one_or_none()
                if whitelist:
                    vector_type = VectorType.TIDB_ON_QDRANT

        if not vector_type:
            raise ValueError("Vector store must be specified.")

        return VECTOR_FACTORY_CLS().init_vector(self._dataset, self._attributes, self._embeddings)

    def create(self, texts: list | None = None, **kwargs):
        if texts:
            start = time.time()
            logger.info("start embedding %s texts %s", len(texts), start)
            batch_size = 1000
            total_batches = len(texts) + batch_size - 1
            for i in range(0, len(texts), batch_size):
                batch = texts[i : i + batch_size]
                batch_start = time.time()
                logger.info("Processing batch %s/%s (%s texts)", i // batch_size + 1, total_batches, len(batch))
                batch_embeddings = self._embeddings.embed_documents([document.page_content for document in batch])
                logger.info(
                    "Embedding batch %s/%s took %s s", i // batch_size + 1, total_batches, time.time() - batch_start
                )
                self._vector_processor.create(texts=batch, embeddings=batch_embeddings, **kwargs)
            logger.info("Embedding %s texts took %s s", len(texts), time.time() - start)

    def add_texts(self, documents: list[Document], **kwargs):
        if kwargs.get("duplicate_check", False):
            documents = self._filter_duplicate_texts(documents)

        embeddings = self._embeddings.embed_documents([document.page_content for document in documents])
        self._vector_processor.create(texts=documents, embeddings=embeddings, **kwargs)

    def text_exists(self, id: str) -> bool:
        return self._vector_processor.text_exists(id)

    def delete_by_ids(self, ids: list[str]):
        self._vector_processor.delete_by_ids(ids)

    def delete_by_metadata_field(self, key: str, value: str):
        self._vector_processor.delete_by_metadata_field(key, value)

    def search_by_vector(self, query: str, **kwargs: Any) -> list[Document]:
        query_vector = self._embeddings.embed_query(query)
        return self._vector_processor.search_by_vector(query_vector, **kwargs)

    def search_by_full_text(self, query: str, **kwargs: Any) -> list[Document]:
        return self._vector_processor.search_by_full_text(query, **kwargs)

    def delete(self):
        self._vector_processor.delete()
        # delete collection redis cache
        if self._vector_processor.collection_name:
            collection_exist_cache_key = f"vector_indexing_{self._vector_processor.collection_name}"
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
            if text.metadata is None:
                continue
            doc_id = text.metadata["doc_id"]
            if doc_id:
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
