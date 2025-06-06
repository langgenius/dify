import json
import uuid
import logging
from typing import Any, List
from pydantic import BaseModel, model_validator

from configs import dify_config
from core.rag.datasource.vdb.vector_base import BaseVector
from core.rag.datasource.vdb.vector_factory import AbstractVectorFactory
from core.rag.datasource.vdb.vector_type import VectorType
from core.rag.embedding.embedding_base import Embeddings
from core.rag.models.document import Document
from extensions.ext_redis import redis_client
from models.dataset import Dataset

from mo_vector.client import MoVectorClient

logger = logging.getLogger(__name__)


class MatrixoneConfig(BaseModel):
    host: str = "localhost"
    port: int = 6001
    user: str = "dump"
    password: str = "111"
    database: str = "dify"
    metric: str = "l2"

    @model_validator(mode="before")
    @classmethod
    def validate_config(cls, values: dict) -> dict:
        if not values["host"]:
            raise ValueError("config host is required")
        if not values["port"]:
            raise ValueError("config port is required")
        if not values["user"]:
            raise ValueError("config user is required")
        if not values["password"]:
            raise ValueError("config password is required")
        if not values["database"]:
            raise ValueError("config database is required")
        return values


class MatrixoneVector(BaseVector):
    """
    Matrixone vector storage implementation.
    """

    def __init__(self, collection_name: str, config: MatrixoneConfig):
        super().__init__(collection_name)
        self.config = config
        self.collection_name = collection_name
        self.client = None

    @property
    def collection_name(self):
        return self._collection_name

    @collection_name.setter
    def collection_name(self, value):
        self._collection_name = value

    def get_type(self) -> str:
        return VectorType.MATRIXONE

    def create(self, texts: List[Document], embeddings: List[List[float]], **kwargs):
        if self.client is None:
            self.client = self._create_client(len(embeddings[0]))
        return self.add_texts(texts, embeddings)

    def _create_client(self, dimension: int) -> MoVectorClient:
        """
        Create a new client for the collection.

        The collection will be created if it doesn't exist.
        """
        lock_name = f"vector_indexing_lock_{self._collection_name}"
        with redis_client.lock(lock_name, timeout=20):
            logger.info(f"Creating client for collection: {self.collection_name}")
            client = MoVectorClient(
                connection_string=f"mysql+pymysql://{self.config.user}:{self.config.password}@{self.config.host}:{self.config.port}/{self.config.database}",
                table_name=self.collection_name,
                vector_dimension=dimension,
            )
            collection_exist_cache_key = f"vector_indexing_{self._collection_name}"
            if redis_client.get(collection_exist_cache_key):
                logger.info(f"Collection {self.collection_name} already exists")
                return client
            try:
                logger.info(f"Creating full text index for collection: {self.collection_name}")
                client.create_full_text_index()
                logger.info(f"Full text index created successfully for collection: {self.collection_name}")
            except Exception as e:
                logger.error(f"Failed to create full text index: {e}")
            redis_client.set(collection_exist_cache_key, 1, ex=3600)
            return client

    def add_texts(
        self, documents: List[Document], embeddings: List[List[float]], **kwargs
    ):
        if self.client is None:
            self.client = self._create_client(len(embeddings[0]))
        ids = []
        for _, doc in enumerate(documents):
            if doc.metadata is not None:
                doc_id = doc.metadata.get("doc_id", str(uuid.uuid4()))
                ids.append(doc_id)
        logger.info(f"Adding {len(documents)} documents to collection: {self.collection_name}")
        logger.info(f"First document content: {documents[0].page_content if documents else 'No documents'}")
        self.client.insert(
            texts=[doc.page_content for doc in documents],
            embeddings=embeddings,
            metadatas=[doc.metadata for doc in documents],
            ids=ids,
        )
        return ids

    def text_exists(self, id: str) -> bool:
        if self.client is None:
            return False
        result = self.client.get(ids=[id])
        return len(result) > 0

    def delete_by_ids(self, ids: List[str]) -> None:
        if self.client is None:
            return
        if not ids:
            return
        self.client.delete(ids=ids)

    def get_ids_by_metadata_field(self, key: str, value: str):
        if self.client is None:
            return []
        results = self.client.query_by_metadata(filter={key: value})
        return [result.id for result in results]

    def delete_by_metadata_field(self, key: str, value: str) -> None:
        if self.client is None:
            return
        self.client.delete(filter={key: value})

    def search_by_vector(
        self, query_vector: List[float], **kwargs: Any
    ) -> List[Document]:
        if self.client is None:
            return []
        top_k = kwargs.get("top_k", 5)
        document_ids_filter = kwargs.get("document_ids_filter")
        filter = None
        if document_ids_filter:
            filter = {"document_id": {"$in": document_ids_filter}}

        results = self.client.query(
            query_vector=query_vector,
            k=top_k,
            filter=filter,
        )

        docs = []
        # TODO: add the score threshold to the query
        for result in results:
            metadata = result.metadata
            docs.append(
                Document(
                    page_content=result.document,
                    metadata=metadata,
                )
            )
        return docs

    def search_by_full_text(self, query: str, **kwargs: Any) -> List[Document]:
        if self.client is None:
            return []
        top_k = kwargs.get("top_k", 5)
        document_ids_filter = kwargs.get("document_ids_filter")
        filter = None
        if document_ids_filter:
            filter = {"document_id": {"$in": document_ids_filter}}
        score_threshold = float(kwargs.get("score_threshold", 0.0))

        logger.info(f"Performing full text search with query: {query}")
        results = self.client.full_text_query(
            keywords=[query],
            k=top_k,
            filter=filter,
        )
        logger.info(f"Full text search returned {len(results)} results")

        docs = []
        for result in results:
            metadata = result.metadata
            if isinstance(metadata, str):
                import json
                metadata = json.loads(metadata)
            score = 1 - result.distance
            logger.info(f"Result score: {score}, threshold: {score_threshold}")
            if score >= score_threshold:
                metadata["score"] = score
                docs.append(
                    Document(
                        page_content=result.document,
                        metadata=metadata,
                    )
                )
        logger.info(f"Filtered results after score threshold: {len(docs)}")
        return docs

    def delete(self) -> None:
        if self.client is None:
            return
        self.client.delete()


class MatrixoneVectorFactory(AbstractVectorFactory):
    def init_vector(
        self, dataset: Dataset, attributes: List, embeddings: Embeddings
    ) -> MatrixoneVector:
        if dataset.index_struct_dict:
            class_prefix: str = dataset.index_struct_dict["vector_store"][
                "class_prefix"
            ]
            collection_name = class_prefix
        else:
            dataset_id = dataset.id
            collection_name = Dataset.gen_collection_name_by_id(dataset_id)
            dataset.index_struct = json.dumps(
                self.gen_index_struct_dict(VectorType.MATRIXONE, collection_name)
            )

        config = MatrixoneConfig(
            host=dify_config.MATRIXONE_HOST or "localhost",
            port=dify_config.MATRIXONE_PORT or 6001,
            user=dify_config.MATRIXONE_USER or "dump",
            password=dify_config.MATRIXONE_PASSWORD or "111",
            database=dify_config.MATRIXONE_DATABASE or "dify",
            metric=dify_config.MATRIXONE_METRIC or "l2",
        )
        return MatrixoneVector(collection_name=collection_name, config=config)
