import json
import logging
import uuid
from collections.abc import Mapping, Sequence
from typing import Any, Optional

import pymongo
from pydantic import BaseModel, model_validator
from pymongo.collection import Collection
from pymongo.errors import OperationFailure

from configs import dify_config
from core.rag.datasource.vdb.vector_base import BaseVector
from core.rag.datasource.vdb.vector_factory import AbstractVectorFactory
from core.rag.datasource.vdb.vector_type import VectorType
from core.rag.embedding.embedding_base import Embeddings
from core.rag.models.document import Document
from extensions.ext_redis import redis_client
from models.dataset import Dataset

# Constants for MongoDB Atlas Search
DEFAULT_INDEX_NAME = "vector_search_index"
EMBEDDING_FIELD = "embedding"
TEXT_FIELD = "text"
METADATA_FIELD = "meta"


class MongoVectorConfig(BaseModel):
    mongo_uri: str
    database: str

    @model_validator(mode="before")
    @classmethod
    def validate_config(cls, values: dict) -> dict:
        if not values.get("mongo_uri"):
            raise ValueError("config MONGO_URI is required")
        if not values.get("database"):
            raise ValueError("config MONGO_DATABASE is required")
        return values


class MongoVector(BaseVector):
    client: pymongo.MongoClient
    db: pymongo.database.Database
    collection: Collection

    def __init__(self, collection_name: str, config: MongoVectorConfig):
        super().__init__(collection_name)
        self.config = config
        self.client = self._create_mongo_client()
        self.db = self.client[config.database]
        self.collection = self.db[collection_name]
        self.index_name = f"{collection_name}_{DEFAULT_INDEX_NAME}"

    def get_type(self) -> str:
        return VectorType.MONGODB

    def _create_mongo_client(self) -> pymongo.MongoClient:
        """Creates a MongoDB client from the provided connection URI."""
        try:
            client: pymongo.MongoClient = pymongo.MongoClient(self.config.mongo_uri)
            # The ismaster command is cheap and does not require auth.
            client.admin.command("ismaster")
            return client
        except Exception:
            logging.exception("Failed to connect to MongoDB.")
            raise

    def create(self, texts: list[Document], embeddings: list[list[float]], **kwargs):
        if not embeddings:
            return
        dimension = len(embeddings[0])
        self._create_collection(dimension)
        return self.add_texts(texts, embeddings)

    def add_texts(self, documents: list[Document], embeddings: list[list[float]], **kwargs):
        mongo_docs = []
        pks = []
        for i, doc in enumerate(documents):
            # Use doc_id from metadata or generate a new one.
            # Using a consistent ID is crucial for updates/deletes.
            doc_id = doc.metadata.get("doc_id", str(uuid.uuid4()))
            pks.append(doc_id)
            mongo_docs.append(
                {
                    "_id": doc_id,
                    TEXT_FIELD: doc.page_content,
                    METADATA_FIELD: doc.metadata,
                    EMBEDDING_FIELD: embeddings[i],
                }
            )
        if not mongo_docs:
            return []
        # `ordered=False` allows the operation to continue if some documents fail insertion.
        self.collection.insert_many(mongo_docs, ordered=False)
        return pks

    def text_exists(self, id: str) -> bool:
        return self.collection.count_documents({"_id": id}, limit=1) > 0

    def get_by_ids(self, ids: list[str]) -> list[Document]:
        if not ids:
            return []
        results = self.collection.find({"_id": {"$in": ids}})
        docs = []
        for record in results:
            docs.append(Document(page_content=record.get(TEXT_FIELD, ""), metadata=record.get(METADATA_FIELD, {})))
        return docs

    def get_ids_by_metadata_field(self, key: str, value: str) -> list[str]:
        """Gets document IDs based on a metadata field."""
        filter_query = {f"{METADATA_FIELD}.{key}": value}
        # Project only the _id field
        results = self.collection.find(filter_query, {"_id": 1})
        return [record["_id"] for record in results]

    def delete_by_ids(self, ids: list[str]) -> None:
        if not ids:
            return
        self.collection.delete_many({"_id": {"$in": ids}})

    def delete_by_metadata_field(self, key: str, value: str) -> None:
        # Use dot notation to query nested fields in the 'meta' document
        filter_query = {f"{METADATA_FIELD}.{key}": value}
        self.collection.delete_many(filter_query)

    def search_by_vector(self, query_vector: list[float], **kwargs: Any) -> list[Document]:
        top_k = kwargs.get("top_k", 5)
        if not isinstance(top_k, int) or top_k <= 0:
            raise ValueError("top_k must be a positive integer")

        document_ids_filter = kwargs.get("document_ids_filter")
        vector_search_stage: dict[str, Any] = {
            "$vectorSearch": {
                "index": self.index_name,
                "path": EMBEDDING_FIELD,
                "queryVector": query_vector,
                "numCandidates": top_k * 10,
                "limit": top_k,
            }
        }

        # Add filter if document_ids_filter is provided
        if document_ids_filter:
            vector_search_stage["$vectorSearch"]["filter"] = {
                f"{METADATA_FIELD}.document_id": {"$in": document_ids_filter}
            }

        pipeline: list[Mapping[str, Any]] = [
            vector_search_stage,
            {
                "$project": {
                    "_id": 0,
                    TEXT_FIELD: 1,
                    METADATA_FIELD: 1,
                    "score": {"$meta": "vectorSearchScore"},
                }
            },
        ]
        results = self.collection.aggregate(pipeline)
        docs = []
        score_threshold = float(kwargs.get("score_threshold") or 0.0)
        for record in results:
            score = record.get("score", 0.0)
            if score >= score_threshold:
                metadata = record.get(METADATA_FIELD, {})
                metadata["score"] = score
                docs.append(Document(page_content=record.get(TEXT_FIELD, ""), metadata=metadata))
        return docs

    def search_by_full_text(self, query: str, **kwargs: Any) -> list[Document]:
        """Performs a full-text search using Atlas Search."""
        top_k = kwargs.get("top_k", 5)
        if not isinstance(top_k, int) or top_k <= 0:
            raise ValueError("top_k must be a positive integer")

        document_ids_filter = kwargs.get("document_ids_filter")
        search_clause: dict[str, Any] = {"text": {"query": query, "path": {"wildcard": "*"}}}

        search_operator: dict[str, Any]
        # If a filter is provided, wrap the search clause in a compound operator
        if document_ids_filter:
            search_operator = {
                "compound": {
                    "must": [search_clause],
                    "filter": [{"in": {"path": f"{METADATA_FIELD}.document_id", "value": document_ids_filter}}],
                }
            }
        else:
            search_operator = search_clause

        pipeline: Sequence[Mapping[str, Any]] = [
            {"$search": {"index": self.index_name, **search_operator}},
            {"$limit": top_k},
            {
                "$project": {
                    "_id": 0,
                    TEXT_FIELD: 1,
                    METADATA_FIELD: 1,
                    "score": {"$meta": "searchScore"},
                }
            },
        ]
        results = self.collection.aggregate(pipeline)
        docs = []
        for record in results:
            metadata = record.get(METADATA_FIELD, {})
            metadata["score"] = record.get("score", 0.0)
            docs.append(Document(page_content=record.get(TEXT_FIELD, ""), metadata=metadata))
        return docs

    def delete(self) -> None:
        """Drops the entire collection from the database."""
        self.collection.drop()
        logging.info("Dropped collection: %s", self.collection.name)
        # Atlas Search indexes are dropped automatically with the collection.

    def _create_collection(self, dimension: int):
        """
        Creates an Atlas Search index for the collection if it doesn't exist.
        This compound index supports both vector search and full-text search.
        """
        cache_key = f"vector_indexing_{self._collection_name}"
        lock_name = f"{cache_key}_lock"
        with redis_client.lock(lock_name, timeout=180):  # Increased timeout for index creation
            if redis_client.get(cache_key):
                return

            try:
                existing_indexes = {idx["name"] for idx in self.collection.list_search_indexes()}
            except OperationFailure:
                # This can happen if the collection doesn't exist yet, which is fine.
                existing_indexes = set()

            if self.index_name in existing_indexes:
                redis_client.set(cache_key, 1, ex=3600)
                return

            # Define a single Atlas Search index for both vector and text search
            index_model: dict[str, Any] = {
                "name": self.index_name,
                "definition": {
                    "mappings": {
                        "dynamic": True,  # Allow dynamic indexing for flexibility
                        "fields": {
                            EMBEDDING_FIELD: {
                                "type": "vector",
                                "dimensions": dimension,
                                "similarity": "cosine",
                            }
                        },
                    }
                },
            }
            try:
                self.collection.create_search_index(model=index_model)
                logging.info("Atlas Search index '%s' creation started. This may take a few minutes.", self.index_name)
                # Note: Index creation is asynchronous. For production, you might want to
                # poll the index status before allowing operations.
            except OperationFailure as e:
                # Handle cases where index creation is already in progress
                if "already exists" in str(e).lower():
                    logging.warning("Index creation command failed because index '%s' already exists.", self.index_name)
                else:
                    logging.exception("Failed to create Atlas Search index.")
                    raise e

            redis_client.set(cache_key, 1, ex=3600)


class MongoVectorFactory(AbstractVectorFactory):
    def init_vector(self, dataset: Dataset, attributes: list, embeddings: Embeddings) -> MongoVector:
        if dataset.index_struct_dict:
            class_prefix: str = dataset.index_struct_dict["vector_store"]["class_prefix"]
            collection_name = class_prefix
        else:
            dataset_id = dataset.id
            collection_name = Dataset.gen_collection_name_by_id(dataset_id)
            dataset.index_struct = json.dumps(self.gen_index_struct_dict(VectorType.MONGODB, collection_name))

        mongo_uri: Optional[str] = dify_config.MONGO_URI
        mongo_database: Optional[str] = dify_config.MONGO_DATABASE

        if not mongo_uri:
            raise ValueError("MONGO_URI environment variable is not set.")
        if not mongo_database:
            raise ValueError("MONGO_DATABASE environment variable is not set.")

        return MongoVector(
            collection_name=collection_name,
            config=MongoVectorConfig(
                mongo_uri=mongo_uri,
                database=mongo_database,
            ),
        )
