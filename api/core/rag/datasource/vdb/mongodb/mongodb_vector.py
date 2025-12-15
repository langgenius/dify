import logging
import time
from typing import TYPE_CHECKING, Any

from pymongo import MongoClient
from pymongo.errors import OperationFailure
from pymongo.operations import SearchIndexModel

from configs import dify_config
from core.rag.datasource.vdb.vector_base import BaseVector
from core.rag.datasource.vdb.vector_factory import AbstractVectorFactory
from core.rag.datasource.vdb.vector_type import VectorType
from core.rag.models.document import Document
from models.dataset import Dataset

if TYPE_CHECKING:
    from core.rag.embedding.embedding_base import Embeddings

logger = logging.getLogger(__name__)


class MongoDBVector(BaseVector):
    def __init__(self, collection_name: str, group_id: str, config):
        super().__init__(collection_name)
        self._client = MongoClient(config.MONGODB_CONNECT_URI)
        self._db = self._client[config.MONGODB_DATABASE]
        self._collection = self._db[collection_name]
        self._index_name = config.MONGODB_VECTOR_INDEX_NAME
        self._group_id = group_id

    def get_type(self) -> str:
        return VectorType.MONGODB

    def create(self, texts: list[Document], embeddings: list[list[float]], **kwargs):
        self._create_collection()
        if texts:
            self._create_vector_index(len(embeddings[0]))
            self.add_texts(texts, embeddings, **kwargs)

    def _create_collection(self):
        if self._collection.name not in self._db.list_collection_names():
            self._db.create_collection(self._collection.name)

    def _create_vector_index(self, vector_size: int):
        model = SearchIndexModel(
            definition={
                "fields": [
                    {
                        "type": "vector",
                        "path": "embedding",
                        "numDimensions": vector_size,
                        "similarity": "cosine",
                    },
                    {"type": "filter", "path": "group_id"},
                    {"type": "filter", "path": "metadata.doc_id"},
                    {"type": "filter", "path": "metadata.document_id"},
                ]
            },
            name=self._index_name,
            type="vectorSearch",
        )

        try:
            self._collection.create_search_index(model=model)
        except OperationFailure as e:
            if "IndexAlreadyExists" in str(e) or "DuplicateIndexName" in str(e):
                logger.info(f"Index {self._index_name} already exists.")
            else:
                logger.error(f"Failed to create index {self._index_name}: {e}")
                raise e

        self._wait_for_index_ready()

    def _wait_for_index_ready(self, timeout: int = 300):
        start = time.time()
        while time.time() - start < timeout:
            cursor = self._collection.aggregate([{"$listSearchIndexes": {"name": self._index_name}}])
            for index in cursor:
                if index.get("queryable") is True and index.get("status") == "READY":
                    return
            time.sleep(2)
        
        raise TimeoutError(f"Index {self._index_name} not ready within {timeout} seconds.")

    def add_texts(self, documents: list[Document], embeddings: list[list[float]], **kwargs):
        docs = []
        for i, doc in enumerate(documents):
            docs.append(
                {
                    "text": doc.page_content,
                    "embedding": embeddings[i],
                    "metadata": doc.metadata,
                    "group_id": self._group_id,
                }
            )
        if docs:
            self._collection.insert_many(docs)

    def text_exists(self, id: str) -> bool:
        return self._collection.find_one({"metadata.doc_id": id, "group_id": self._group_id}) is not None

    def delete_by_ids(self, ids: list[str]):
        self._collection.delete_many({"metadata.doc_id": {"$in": ids}, "group_id": self._group_id})

    def delete_by_metadata_field(self, key: str, value: str):
        self._collection.delete_many({f"metadata.{key}": value, "group_id": self._group_id})

    def search_by_vector(self, query_vector: list[float], **kwargs: Any) -> list[Document]:
        pipeline = self._get_search_pipeline(query_vector, **kwargs)
        results = self._collection.aggregate(pipeline)
        return self._results_to_documents(results)

    def _get_search_pipeline(self, query_vector: list[float], **kwargs: Any) -> list[dict]:
        filter_dict = {"group_id": self._group_id}
        
        # Merge additional filters if provided
        if kwargs.get("filter"):
            # This is naive merging, real implementation might need to handle complex filters
            pass
            
        # Support common document_ids_filter from Dify
        document_ids_filter = kwargs.get("document_ids_filter")
        if document_ids_filter:
             filter_dict["metadata.document_id"] = {"$in": document_ids_filter}

        pipeline = [
            {
                "$vectorSearch": {
                    "index": self._index_name,
                    "path": "embedding",
                    "queryVector": query_vector,
                    "numCandidates": kwargs.get("top_k", 4) * 10,
                    "limit": kwargs.get("top_k", 4),
                    "filter": filter_dict,
                }
            },
            {"$project": {"text": 1, "metadata": 1, "score": {"$meta": "vectorSearchScore"}}},
        ]
        return pipeline

    def search_by_full_text(self, query: str, **kwargs: Any) -> list[Document]:
        """
        Search by full text.
        
        This method is currently a placeholder and not implemented for MongoDB vector store.
        Future implementations might leverage Atlas Search or text indexes.
        """
        logger.warning("search_by_full_text is not implemented for MongoDBVector. Returning empty results.")
        return []

    def delete(self):
        # Delete documents for this group_id
        self._collection.delete_many({"group_id": self._group_id})

    def close(self):
        if self._client:
            self._client.close()

    def __del__(self):
        self.close()

    def _results_to_documents(self, results) -> list[Document]:
        documents = []
        for res in results:
            metadata = res.get("metadata", {})
            metadata["score"] = res.get("score", 0.0)
            documents.append(
                Document(
                    page_content=res.get("text", ""),
                    metadata=metadata,
                )
            )
        return documents


class MongoDBVectorFactory(AbstractVectorFactory):
    def init_vector(self, dataset: Dataset, attributes: list, embeddings: "Embeddings") -> MongoDBVector:
        if dataset.index_struct_dict:
            class_prefix: str = dataset.index_struct_dict["vector_store"]["class_prefix"]
            collection_name = class_prefix
        else:
            dataset_id = dataset.id
            collection_name = Dataset.gen_collection_name_by_id(dataset_id)

        return MongoDBVector(
            collection_name=collection_name,
            group_id=dataset.id,
            config=dify_config
        )
