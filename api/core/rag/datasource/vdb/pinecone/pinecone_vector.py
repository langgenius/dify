import json
import time
from typing import Any

from pinecone import Pinecone, ServerlessSpec
from pydantic import BaseModel

from configs import dify_config
from core.rag.datasource.vdb.field import Field
from core.rag.datasource.vdb.vector_base import BaseVector
from core.rag.datasource.vdb.vector_factory import AbstractVectorFactory
from core.rag.datasource.vdb.vector_type import VectorType
from core.rag.embedding.embedding_base import Embeddings
from core.rag.models.document import Document
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models.dataset import Dataset, DatasetCollectionBinding


class PineconeConfig(BaseModel):
    """Pinecone configuration class"""

    api_key: str
    environment: str
    index_name: str | None = None
    timeout: float = 30
    batch_size: int = 100
    metric: str = "cosine"


class PineconeVector(BaseVector):
    """Pinecone vector database concrete implementation class"""

    def __init__(self, collection_name: str, group_id: str, config: PineconeConfig):
        super().__init__(collection_name)
        self._client_config = config
        self._group_id = group_id

        # Initialize Pinecone client with SSL configuration
        try:
            self._pc = Pinecone(
                api_key=config.api_key,
                # Configure SSL to handle connection issues
                ssl_ca_certs=None,  # Use system default CA certificates
            )
        except Exception as e:
            # Fallback to basic initialization if SSL config fails
            self._pc = Pinecone(api_key=config.api_key)

        # Normalize index name: lowercase, only a-z0-9- and <=45 chars
        import hashlib
        import re

        base_name = collection_name.lower()
        base_name = re.sub(r"[^a-z0-9-]+", "-", base_name)  # replace invalid chars with '-'
        base_name = re.sub(r"-+", "-", base_name).strip("-")
        # Use longer secure suffix to reduce collision risk
        suffix_len = 24  # 24 hex digits (96-bit entropy)
        if len(base_name) > 45:
            hash_suffix = hashlib.sha256(base_name.encode()).hexdigest()[:suffix_len]
            truncated_name = base_name[: 45 - (suffix_len + 1)].rstrip("-")
            self._index_name = f"{truncated_name}-{hash_suffix}"
        else:
            self._index_name = base_name
        # Guard empty name
        if not self._index_name:
            self._index_name = f"index-{hashlib.sha256(collection_name.encode()).hexdigest()[:suffix_len]}"
        # Pinecone index handle, lazily initialized
        self._index: Any | None = None

    def get_type(self) -> str:
        """Return vector database type identifier."""
        return VectorType.PINECONE

    def _ensure_index_initialized(self) -> None:
        """Ensure that self._index is attached to an existing Pinecone index."""
        if self._index is not None:
            return
        try:
            existing_indexes = self._pc.list_indexes().names()
            if self._index_name in existing_indexes:
                self._index = self._pc.Index(self._index_name)
            else:
                raise ValueError("Index not initialized. Please ingest documents to create index.")
        except Exception:
            raise

    def to_index_struct(self) -> dict:
        """Generate index structure dictionary"""
        return {"type": self.get_type(), "vector_store": {"class_prefix": self._collection_name}}

    def create(self, texts: list[Document], embeddings: list[list[float]], **kwargs):
        """Create vector index"""
        if texts:
            # Get vector dimension
            vector_size = len(embeddings[0])

            # Create Pinecone index
            self.create_index(vector_size)

            # Add vector data
            self.add_texts(texts, embeddings, **kwargs)

    def create_index(self, dimension: int):
        """Create Pinecone index"""
        lock_name = f"vector_indexing_lock_{self._index_name}"

        with redis_client.lock(lock_name, timeout=30):
            # Check Redis cache
            index_exist_cache_key = f"vector_indexing_{self._index_name}"
            if redis_client.get(index_exist_cache_key):
                self._index = self._pc.Index(self._index_name)
                return

            # Check if index already exists
            existing_indexes = self._pc.list_indexes().names()

            if self._index_name not in existing_indexes:
                # Create new index using ServerlessSpec
                self._pc.create_index(
                    name=self._index_name,
                    dimension=dimension,
                    metric=self._client_config.metric,
                    spec=ServerlessSpec(cloud="aws", region=self._client_config.environment),
                )

                # Wait for index creation to complete
                while not self._pc.describe_index(self._index_name).status["ready"]:
                    time.sleep(1)
            else:
                # Get index instance
                self._index = self._pc.Index(self._index_name)

            # Set cache
            redis_client.set(index_exist_cache_key, 1, ex=3600)

    def add_texts(self, documents: list[Document], embeddings: list[list[float]], **kwargs):
        """Batch add document vectors"""
        if not self._index:
            raise ValueError("Index not initialized. Call create() first.")

        total_docs = len(documents)

        uuids = self._get_uuids(documents)
        batch_size = self._client_config.batch_size
        added_ids = []

        # Batch processing
        total_batches = (total_docs + batch_size - 1) // batch_size  # Ceiling division
        for batch_idx, i in enumerate(range(0, len(documents), batch_size), 1):
            batch_documents = documents[i : i + batch_size]
            batch_embeddings = embeddings[i : i + batch_size]
            batch_uuids = uuids[i : i + batch_size]
            batch_size_actual = len(batch_documents)

            # Build Pinecone vector data (metadata must be primitives or list[str])
            vectors_to_upsert = []
            for doc, embedding, doc_id in zip(batch_documents, batch_embeddings, batch_uuids):
                raw_meta = doc.metadata or {}
                safe_meta: dict[str, Any] = {}
                # lift common identifiers to top-level fields for filtering
                for k, v in raw_meta.items():
                    if isinstance(v, (str, int, float, bool)) or (
                        isinstance(v, list) and all(isinstance(x, str) for x in v)
                    ):
                        safe_meta[k] = v
                    else:
                        safe_meta[k] = json.dumps(v, ensure_ascii=False)

                # keep content as string metadata if needed
                safe_meta[Field.CONTENT_KEY.value] = doc.page_content
                # group id as string
                safe_meta[Field.GROUP_KEY.value] = str(self._group_id)

                vectors_to_upsert.append({"id": doc_id, "values": embedding, "metadata": safe_meta})

            # Batch insert to Pinecone
            try:
                self._index.upsert(vectors=vectors_to_upsert)
                added_ids.extend(batch_uuids)
            except Exception as e:
                raise

        return added_ids

    def search_by_vector(self, query_vector: list[float], **kwargs) -> list[Document]:
        """Vector similarity search"""
        # Lazily attach to an existing index if needed
        self._ensure_index_initialized()

        top_k = kwargs.get("top_k", 4)
        score_threshold = float(kwargs.get("score_threshold", 0.0))

        # Build filter conditions
        filter_dict = {Field.GROUP_KEY.value: {"$eq": str(self._group_id)}}

        # Document scope filtering
        document_ids_filter = kwargs.get("document_ids_filter")
        if document_ids_filter:
            filter_dict["document_id"] = {"$in": document_ids_filter}

        # Execute search
        try:
            index = self._index
            assert index is not None
            response = index.query(vector=query_vector, top_k=top_k, include_metadata=True, filter=filter_dict)
        except Exception as e:
            raise

        # Convert results
        docs = []
        filtered_count = 0
        for match in response.matches:
            if match.score >= score_threshold:
                page_content = match.metadata.get(Field.CONTENT_KEY.value, "")
                metadata = dict(match.metadata or {})
                metadata.pop(Field.CONTENT_KEY.value, None)
                metadata.pop(Field.GROUP_KEY.value, None)
                metadata["score"] = match.score

                doc = Document(page_content=page_content, metadata=metadata)
                docs.append(doc)
            else:
                filtered_count += 1

        # Sort by similarity score in descending order
        docs.sort(key=lambda x: x.metadata.get("score", 0), reverse=True)

        return docs

    def search_by_full_text(self, query: str, **kwargs) -> list[Document]:
        """Full-text search - Pinecone does not natively support it, returns empty list"""
        return []

    def delete_by_metadata_field(self, key: str, value: str):
        """Delete by metadata field"""
        self._ensure_index_initialized()

        try:
            # Build filter conditions
            filter_dict = {
                Field.GROUP_KEY.value: {"$eq": self._group_id},
                f"{Field.METADATA_KEY.value}.{key}": {"$eq": value},
            }

            # Pinecone delete operation
            index = self._index
            assert index is not None
            index.delete(filter=filter_dict)
        except Exception as e:
            # Ignore delete errors
            pass

    def delete_by_ids(self, ids: list[str]) -> None:
        """Batch delete by ID list"""
        self._ensure_index_initialized()

        try:
            # Pinecone delete by ID
            index = self._index
            assert index is not None
            index.delete(ids=ids)
        except Exception as e:
            raise

    def delete(self) -> None:
        """Delete all vector data for the entire dataset"""
        self._ensure_index_initialized()

        try:
            # Delete all vectors by group_id
            filter_dict = {Field.GROUP_KEY.value: {"$eq": self._group_id}}
            index = self._index
            assert index is not None
            index.delete(filter=filter_dict)
        except Exception as e:
            raise

    def text_exists(self, id: str) -> bool:
        """Check if document exists"""
        try:
            self._ensure_index_initialized()
        except Exception:
            return False

        try:
            # Check if vector exists through query
            index = self._index
            assert index is not None
            response = index.fetch(ids=[id])
            exists = id in response.vectors
            return exists
        except Exception as e:
            return False


class PineconeVectorFactory(AbstractVectorFactory):
    """Pinecone vector database factory class"""

    def init_vector(self, dataset: Dataset, attributes: list, embeddings: Embeddings) -> PineconeVector:
        """Create PineconeVector instance"""

        # Determine index name
        if dataset.collection_binding_id:
            dataset_collection_binding = (
                db.session.query(DatasetCollectionBinding)
                .where(DatasetCollectionBinding.id == dataset.collection_binding_id)
                .one_or_none()
            )
            if dataset_collection_binding:
                collection_name = dataset_collection_binding.collection_name
            else:
                raise ValueError("Dataset Collection Bindings does not exist!")
        else:
            if dataset.index_struct_dict:
                class_prefix: str = dataset.index_struct_dict["vector_store"]["class_prefix"]
                collection_name = class_prefix
            else:
                dataset_id = dataset.id
                collection_name = Dataset.gen_collection_name_by_id(dataset_id)

        # Set index structure
        if not dataset.index_struct_dict:
            dataset.index_struct = json.dumps(self.gen_index_struct_dict(VectorType.PINECONE, collection_name))

        # Create PineconeVector instance
        return PineconeVector(
            collection_name=collection_name,
            group_id=dataset.id,
            config=PineconeConfig(
                api_key=dify_config.PINECONE_API_KEY or "",
                environment=dify_config.PINECONE_ENVIRONMENT or "",
                index_name=dify_config.PINECONE_INDEX_NAME,
                timeout=dify_config.PINECONE_CLIENT_TIMEOUT,
                batch_size=dify_config.PINECONE_BATCH_SIZE,
                metric=dify_config.PINECONE_METRIC,
            ),
        )
