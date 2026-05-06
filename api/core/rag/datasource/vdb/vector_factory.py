import base64
import logging
import time
from abc import ABC, abstractmethod
from typing import Any

from sqlalchemy import select

from configs import dify_config
from core.model_manager import ModelManager
from core.rag.datasource.vdb.vector_backend_registry import get_vector_factory_class
from core.rag.datasource.vdb.vector_base import BaseVector, VectorIndexStructDict
from core.rag.datasource.vdb.vector_type import VectorType
from core.rag.embedding.cached_embedding import CacheEmbedding
from core.rag.embedding.embedding_base import Embeddings
from core.rag.index_processor.constant.doc_type import DocType
from core.rag.models.document import Document
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from extensions.ext_storage import storage
from graphon.model_runtime.entities.model_entities import ModelType
from models.dataset import Dataset, Whitelist
from models.model import UploadFile

logger = logging.getLogger(__name__)


class AbstractVectorFactory(ABC):
    @abstractmethod
    def init_vector(self, dataset: Dataset, attributes: list, embeddings: Embeddings) -> BaseVector:
        raise NotImplementedError

    @staticmethod
    def gen_index_struct_dict(vector_type: VectorType, collection_name: str) -> VectorIndexStructDict:
        index_struct_dict: VectorIndexStructDict = {
            "type": vector_type,
            "vector_store": {"class_prefix": collection_name},
        }
        return index_struct_dict


class _LazyEmbeddings(Embeddings):
    """Lazy proxy that defers materializing the real embedding model.

    Constructing the real embeddings (via ``ModelManager.get_model_instance``)
    transitively calls ``FeatureService.get_features`` → ``BillingService``
    HTTP GETs (see ``provider_manager.py``). Cleanup paths
    (``delete_by_ids`` / ``delete`` / ``text_exists``) do not need embeddings
    at all, so deferring this until an ``embed_*`` method is actually invoked
    keeps cleanup tasks resilient to transient billing-API failures and avoids
    leaving stranded ``document_segments`` / ``child_chunks`` whenever billing
    hiccups.

    Existing callers that perform create / search operations are unaffected:
    the first ``embed_*`` call materializes the underlying model and the
    behavior is identical from that point on.
    """

    def __init__(self, dataset: Dataset):
        self._dataset = dataset
        self._real: Embeddings | None = None

    def _ensure(self) -> Embeddings:
        if self._real is None:
            model_manager = ModelManager.for_tenant(tenant_id=self._dataset.tenant_id)
            embedding_model = model_manager.get_model_instance(
                tenant_id=self._dataset.tenant_id,
                provider=self._dataset.embedding_model_provider,
                model_type=ModelType.TEXT_EMBEDDING,
                model=self._dataset.embedding_model,
            )
            self._real = CacheEmbedding(embedding_model)
        return self._real

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return self._ensure().embed_documents(texts)

    def embed_multimodal_documents(self, multimodel_documents: list[dict[str, Any]]) -> list[list[float]]:
        return self._ensure().embed_multimodal_documents(multimodel_documents)

    def embed_query(self, text: str) -> list[float]:
        return self._ensure().embed_query(text)

    def embed_multimodal_query(self, multimodel_document: dict[str, Any]) -> list[float]:
        return self._ensure().embed_multimodal_query(multimodel_document)

    async def aembed_documents(self, texts: list[str]) -> list[list[float]]:
        return await self._ensure().aembed_documents(texts)

    async def aembed_query(self, text: str) -> list[float]:
        return await self._ensure().aembed_query(text)


class Vector:
    def __init__(self, dataset: Dataset, attributes: list | None = None):
        if attributes is None:
            # `is_summary` and `original_chunk_id` are stored on summary vectors
            # by `SummaryIndexService` and read back by `RetrievalService` to
            # route summary hits through their original parent chunks. They
            # must be listed here so vector backends that use this list as an
            # explicit return-properties projection (notably Weaviate) actually
            # return those fields; without them, summary hits silently
            # collapse into `is_summary = False` branches and the summary
            # retrieval path is a no-op. See #34884.
            attributes = [
                "doc_id",
                "dataset_id",
                "document_id",
                "doc_hash",
                "doc_type",
                "is_summary",
                "original_chunk_id",
            ]
        self._dataset = dataset
        # Use a lazy proxy so cleanup paths (delete_by_ids / delete / text_exists)
        # never transitively trigger billing API calls during ``Vector(dataset)``
        # construction. The real embedding model is materialized only when an
        # ``embed_*`` method is actually invoked (i.e. create / search paths).
        self._embeddings: Embeddings = _LazyEmbeddings(dataset)
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

        vector_factory_cls = self.get_vector_factory(vector_type)
        return vector_factory_cls().init_vector(self._dataset, self._attributes, self._embeddings)

    @staticmethod
    def get_vector_factory(vector_type: str) -> type[AbstractVectorFactory]:
        return get_vector_factory_class(vector_type)

    @staticmethod
    def _filter_empty_text_documents(documents: list[Document]) -> list[Document]:
        filtered_documents = [document for document in documents if document.page_content.strip()]
        skipped_count = len(documents) - len(filtered_documents)
        if skipped_count:
            logger.warning("skip %d empty documents before vector embedding", skipped_count)
        return filtered_documents

    def create(self, texts: list | None = None, **kwargs):
        if texts:
            texts = self._filter_empty_text_documents(texts)
            if not texts:
                return

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

    def create_multimodal(self, file_documents: list | None = None, **kwargs):
        if file_documents:
            start = time.time()
            logger.info("start embedding %s files %s", len(file_documents), start)
            batch_size = 1000
            total_batches = len(file_documents) + batch_size - 1
            for i in range(0, len(file_documents), batch_size):
                batch = file_documents[i : i + batch_size]
                batch_start = time.time()
                logger.info("Processing batch %s/%s (%s files)", i // batch_size + 1, total_batches, len(batch))

                # Batch query all upload files to avoid N+1 queries
                attachment_ids = [doc.metadata["doc_id"] for doc in batch]
                stmt = select(UploadFile).where(UploadFile.id.in_(attachment_ids))
                upload_files = db.session.scalars(stmt).all()
                upload_file_map = {str(f.id): f for f in upload_files}

                file_base64_list = []
                real_batch = []
                for document in batch:
                    attachment_id = document.metadata["doc_id"]
                    doc_type = document.metadata["doc_type"]
                    upload_file = upload_file_map.get(attachment_id)
                    if upload_file:
                        blob = storage.load_once(upload_file.key)
                        file_base64_str = base64.b64encode(blob).decode()
                        file_base64_list.append(
                            {
                                "content": file_base64_str,
                                "content_type": doc_type,
                                "file_id": attachment_id,
                            }
                        )
                        real_batch.append(document)
                batch_embeddings = self._embeddings.embed_multimodal_documents(file_base64_list)
                logger.info(
                    "Embedding batch %s/%s took %s s", i // batch_size + 1, total_batches, time.time() - batch_start
                )
                self._vector_processor.create(texts=real_batch, embeddings=batch_embeddings, **kwargs)
            logger.info("Embedding %s files took %s s", len(file_documents), time.time() - start)

    def add_texts(self, documents: list[Document], **kwargs):
        documents = self._filter_empty_text_documents(documents)
        if not documents:
            return

        if kwargs.get("duplicate_check", False):
            documents = self._filter_duplicate_texts(documents)
            if not documents:
                return

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

    def search_by_file(self, file_id: str, **kwargs: Any) -> list[Document]:
        upload_file: UploadFile | None = db.session.get(UploadFile, file_id)

        if not upload_file:
            return []
        blob = storage.load_once(upload_file.key)
        file_base64_str = base64.b64encode(blob).decode()
        multimodal_vector = self._embeddings.embed_multimodal_query(
            {
                "content": file_base64_str,
                "content_type": DocType.IMAGE,
                "file_id": file_id,
            }
        )
        return self._vector_processor.search_by_vector(multimodal_vector, **kwargs)

    def search_by_full_text(self, query: str, **kwargs: Any) -> list[Document]:
        return self._vector_processor.search_by_full_text(query, **kwargs)

    def delete(self):
        self._vector_processor.delete()
        # delete collection redis cache
        if self._vector_processor.collection_name:
            collection_exist_cache_key = f"vector_indexing_{self._vector_processor.collection_name}"
            redis_client.delete(collection_exist_cache_key)

    def _get_embeddings(self) -> Embeddings:
        model_manager = ModelManager.for_tenant(tenant_id=self._dataset.tenant_id)

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
