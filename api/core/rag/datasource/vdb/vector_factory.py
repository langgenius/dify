import base64
import logging
import time
from abc import ABC, abstractmethod
from collections.abc import Mapping
from typing import Any, override

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.model_manager import ModelManager
from core.rag.datasource.vdb.vector_backend_registry import get_vector_factory_class
from core.rag.datasource.vdb.vector_base import BaseVector, VectorIndexStructDict
from core.rag.datasource.vdb.vector_type import VectorType
from core.rag.embedding.cached_embedding import CacheEmbedding
from core.rag.embedding.embedding_base import Embeddings
from core.rag.index_processor.constant.doc_type import DocType
from core.rag.models.document import Document
from extensions.ext_redis import redis_client
from extensions.ext_storage import storage
from extensions.otel import trace_span
from graphon.model_runtime.entities.model_entities import ModelType
from models.dataset import Dataset
from models.model import UploadFile

logger = logging.getLogger(__name__)


class AbstractVectorFactory(ABC):
    @abstractmethod
    def init_vector(
        self, dataset: Dataset, attributes: list, embeddings: Embeddings, *, session: Session | None
    ) -> BaseVector:
        """Initialize the backend using the caller's session for metadata reads.

        ``None`` is used by callers that initialize a resolved vector backend
        outside their database transaction; backend-specific legacy reads may
        still use their own session in that case. A supplied session belongs to
        the caller and must not be committed, rolled back, or closed here.
        """
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

    @override
    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return self._ensure().embed_documents(texts)

    @override
    def embed_multimodal_documents(self, multimodel_documents: list[dict[str, Any]]) -> list[list[float]]:
        return self._ensure().embed_multimodal_documents(multimodel_documents)

    @override
    def embed_query(self, text: str) -> list[float]:
        provider = self._dataset.embedding_model_provider
        model_name = self._dataset.embedding_model
        if provider and model_name:
            cached_embedding = CacheEmbedding.get_cached_query_embedding(provider, model_name, text)
            if cached_embedding is not None:
                return cached_embedding
        return self._ensure().embed_query(text)

    @override
    def embed_multimodal_query(self, multimodel_document: dict[str, Any]) -> list[float]:
        return self._ensure().embed_multimodal_query(multimodel_document)

    @override
    async def aembed_documents(self, texts: list[str]) -> list[list[float]]:
        return await self._ensure().aembed_documents(texts)

    @override
    async def aembed_query(self, text: str) -> list[float]:
        return await self._ensure().aembed_query(text)


class Vector:
    def __init__(
        self,
        dataset: Dataset,
        attributes: list | None = None,
        *,
        session: Session | None,
        vector_type: str | None = None,
    ):
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
        # never transitively trigger billing API calls during ``Vector(dataset, session=...)``
        # construction. The real embedding model is materialized only when an
        # ``embed_*`` method is actually invoked (i.e. create / search paths).
        self._embeddings: Embeddings = _LazyEmbeddings(dataset)
        self._attributes = attributes
        self._session = session
        if vector_type is not None:
            self._vector_processor = self.get_vector_factory(vector_type)().init_vector(
                dataset, self._attributes, self._embeddings, session=session
            )
        else:
            if session is None:
                raise ValueError("A resolved vector type is required without a database session")
            self._vector_processor = self._init_vector(session=session)

    @staticmethod
    def resolve_vector_type(dataset: Dataset, *, session: Session) -> str:
        from repositories.knowledge.dataset_read_repository import resolve_dataset_vector_type

        return resolve_dataset_vector_type(dataset, session=session)

    def _init_vector(self, *, session: Session) -> BaseVector:
        vector_type = self.resolve_vector_type(self._dataset, session=session)
        vector_factory_cls = self.get_vector_factory(vector_type)
        return vector_factory_cls().init_vector(self._dataset, self._attributes, self._embeddings, session=session)

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
            total_batches = (len(texts) + batch_size - 1) // batch_size
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

    def create_multimodal(
        self,
        file_documents: list | None = None,
        *,
        upload_file_keys: Mapping[str, str] | None = None,
        **kwargs,
    ):
        if file_documents:
            deduplicated_documents: list[Document] = []
            seen_attachment_ids: set[str] = set()
            for document in file_documents:
                attachment_id = str(document.metadata["doc_id"])
                if attachment_id in seen_attachment_ids:
                    continue
                seen_attachment_ids.add(attachment_id)
                deduplicated_documents.append(document)
            # Attachment vectors use the physical upload id as their
            # dataset-wide identity. A segment can therefore publish an id
            # that another segment (or a prior enable attempt) already wrote.
            # Reuse the backend existence check before embedding and inserting
            # so providers with insert-only create methods remain idempotent.
            file_documents = self._filter_duplicate_texts(deduplicated_documents)
            if not file_documents:
                return
            start = time.time()
            logger.info("start embedding %s files %s", len(file_documents), start)
            batch_size = 1000
            total_batches = (len(file_documents) + batch_size - 1) // batch_size
            for i in range(0, len(file_documents), batch_size):
                batch = file_documents[i : i + batch_size]
                batch_start = time.time()
                logger.info("Processing batch %s/%s (%s files)", i // batch_size + 1, total_batches, len(batch))

                # Batch query all upload files to avoid N+1 queries
                attachment_ids = [str(doc.metadata["doc_id"]) for doc in batch]
                file_keys: Mapping[str, str]
                if upload_file_keys is None:
                    if self._session is None:
                        raise ValueError("Upload files must be loaded before indexing without a database session")
                    stmt = select(UploadFile).where(
                        UploadFile.id.in_(attachment_ids), UploadFile.tenant_id == self._dataset.tenant_id
                    )
                    file_keys = {str(f.id): f.key for f in self._session.scalars(stmt).all()}
                else:
                    file_keys = upload_file_keys

                file_base64_list = []
                real_batch = []
                for document in batch:
                    attachment_id = str(document.metadata["doc_id"])
                    doc_type = document.metadata["doc_type"]
                    file_key = file_keys.get(attachment_id)
                    if file_key is not None:
                        blob = storage.load_once(file_key)
                        file_base64_str = base64.b64encode(blob).decode()
                        file_base64_list.append(
                            {
                                "content": file_base64_str,
                                "content_type": doc_type,
                                "file_id": attachment_id,
                            }
                        )
                        real_batch.append(document)
                if not real_batch:
                    continue
                batch_embeddings = self._embeddings.embed_multimodal_documents(file_base64_list)
                logger.info(
                    "Embedding batch %s/%s took %s s", i // batch_size + 1, total_batches, time.time() - batch_start
                )
                # Attachment vectors are physically shared by every current
                # binding in the dataset. Persist the physical attachment ID
                # as their canonical document identity instead of leaking the
                # logical document that happened to publish the vector first.
                backend_batch = [
                    document.model_copy(
                        update={
                            "metadata": {
                                **document.metadata,
                                "document_id": str(document.metadata["doc_id"]),
                            }
                        }
                    )
                    for document in real_batch
                ]
                self._vector_processor.create(texts=backend_batch, embeddings=batch_embeddings, **kwargs)
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
        return self._search_by_vector_traced(query_vector, **kwargs)

    @trace_span()
    def _search_by_vector_traced(self, query_vector: list[float], **kwargs) -> list[Document]:
        return self._vector_processor.search_by_vector(query_vector, **kwargs)

    def search_by_file(self, *, file_id: str, file_key: str, **kwargs: Any) -> list[Document]:
        """Search with an attachment resolved and authorized before provider I/O."""
        blob = storage.load_once(file_key)
        file_base64_str = base64.b64encode(blob).decode()
        multimodal_vector = self._embeddings.embed_multimodal_query(
            {
                "content": file_base64_str,
                "content_type": DocType.IMAGE,
                "file_id": file_id,
            }
        )
        return self._search_by_vector_traced(multimodal_vector, **kwargs)

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
