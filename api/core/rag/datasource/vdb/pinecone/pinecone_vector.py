import json
import time
import uuid
from typing import Any, Optional, Union

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
    index_name: Optional[str] = None
    timeout: float = 30
    batch_size: int = 100
    metric: str = "cosine"


class PineconeVector(BaseVector):
    """Pinecone vector database concrete implementation class"""
    
    def __init__(self, collection_name: str, group_id: str, config: PineconeConfig):
        super().__init__(collection_name)
        self._client_config = config
        self._group_id = group_id
        
        # Initialize Pinecone client
        self._pc = Pinecone(api_key=config.api_key)
        
        # Use collection_name as index name
        self._index_name = collection_name
        self._index = None
        
    def get_type(self) -> str:
        """Return vector database type identifier"""
        return "pinecone"
    
    def to_index_struct(self) -> dict:
        """Generate index structure dictionary"""
        return {
            "type": self.get_type(), 
            "vector_store": {"class_prefix": self._collection_name}
        }
    
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
                    spec=ServerlessSpec(
                        cloud='aws',
                        region=self._client_config.environment
                    )
                )
                
                # Wait for index creation to complete
                while not self._pc.describe_index(self._index_name).status['ready']:
                    time.sleep(1)
            
            # Get index instance
            self._index = self._pc.Index(self._index_name)
            
            # Set cache
            redis_client.set(index_exist_cache_key, 1, ex=3600)
    
    def add_texts(self, documents: list[Document], embeddings: list[list[float]], **kwargs):
        """Batch add document vectors"""
        if not self._index:
            raise ValueError("Index not initialized. Call create() first.")
        
        uuids = self._get_uuids(documents)
        batch_size = self._client_config.batch_size
        added_ids = []
        
        # Batch processing
        for i in range(0, len(documents), batch_size):
            batch_documents = documents[i:i + batch_size]
            batch_embeddings = embeddings[i:i + batch_size]
            batch_uuids = uuids[i:i + batch_size]
            
            # Build Pinecone vector data
            vectors_to_upsert = []
            for doc, embedding, doc_id in zip(batch_documents, batch_embeddings, batch_uuids):
                metadata = {
                    Field.CONTENT_KEY.value: doc.page_content,
                    Field.METADATA_KEY.value: doc.metadata or {},
                    Field.GROUP_KEY.value: self._group_id,
                }
                
                vectors_to_upsert.append({
                    "id": doc_id,
                    "values": embedding,
                    "metadata": metadata
                })
            
            # Batch insert to Pinecone
            self._index.upsert(vectors=vectors_to_upsert)
            added_ids.extend(batch_uuids)
        
        return added_ids
    
    def search_by_vector(self, query_vector: list[float], **kwargs) -> list[Document]:
        """Vector similarity search"""
        if not self._index:
            raise ValueError("Index not initialized.")
        
        top_k = kwargs.get("top_k", 4)
        score_threshold = float(kwargs.get("score_threshold", 0.0))
        
        # Build filter conditions
        filter_dict = {Field.GROUP_KEY.value: {"$eq": self._group_id}}
        
        # Document scope filtering
        document_ids_filter = kwargs.get("document_ids_filter")
        if document_ids_filter:
            filter_dict[f"{Field.METADATA_KEY.value}.document_id"] = {"$in": document_ids_filter}
        
        # Execute search
        response = self._index.query(
            vector=query_vector,
            top_k=top_k,
            include_metadata=True,
            filter=filter_dict
        )
        
        # Convert results
        docs = []
        for match in response.matches:
            if match.score >= score_threshold:
                metadata = match.metadata.get(Field.METADATA_KEY.value, {})
                metadata["score"] = match.score
                
                doc = Document(
                    page_content=match.metadata.get(Field.CONTENT_KEY.value, ""),
                    metadata=metadata,
                )
                docs.append(doc)
        
        # Sort by similarity score in descending order
        docs.sort(key=lambda x: x.metadata.get("score", 0), reverse=True)
        return docs
    
    def search_by_full_text(self, query: str, **kwargs) -> list[Document]:
        """Full-text search - Pinecone does not natively support it, returns empty list"""
        return []
    
    def delete_by_metadata_field(self, key: str, value: str):
        """Delete by metadata field"""
        if not self._index:
            return
        
        try:
            # Build filter conditions
            filter_dict = {
                Field.GROUP_KEY.value: {"$eq": self._group_id},
                f"{Field.METADATA_KEY.value}.{key}": {"$eq": value}
            }
            
            # Pinecone delete operation
            self._index.delete(filter=filter_dict)
        except Exception:
            # Ignore delete errors
            pass
    
    def delete_by_ids(self, ids: list[str]) -> None:
        """Batch delete by ID list"""
        if not self._index:
            return
        
        try:
            # Pinecone delete by ID
            self._index.delete(ids=ids)
        except Exception:
            # Ignore delete errors
            pass
    
    def delete(self) -> None:
        """Delete all vector data for the entire dataset"""
        if not self._index:
            return
        
        try:
            # Delete all vectors by group_id
            filter_dict = {Field.GROUP_KEY.value: {"$eq": self._group_id}}
            self._index.delete(filter=filter_dict)
        except Exception:
            # Ignore delete errors
            pass
    
    def text_exists(self, id: str) -> bool:
        """Check if document exists"""
        if not self._index:
            return False
        
        try:
            # Check if vector exists through query
            response = self._index.fetch(ids=[id])
            return id in response.vectors
        except Exception:
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
            dataset.index_struct = json.dumps(
                self.gen_index_struct_dict("pinecone", collection_name)
            )
        
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
