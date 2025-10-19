import json
import logging
import uuid
from collections.abc import Callable
from functools import wraps
from typing import Any, Concatenate, ParamSpec, TypeVar

from mo_vector.client import MoVectorClient  # type: ignore
from pydantic import BaseModel, model_validator

from configs import dify_config
from core.rag.datasource.vdb.vector_base import BaseVector
from core.rag.datasource.vdb.vector_factory import AbstractVectorFactory
from core.rag.datasource.vdb.vector_type import VectorType
from core.rag.embedding.embedding_base import Embeddings
from core.rag.models.document import Document
from extensions.ext_redis import redis_client
from models.dataset import Dataset

logger = logging.getLogger(__name__)

P = ParamSpec("P")
R = TypeVar("R")


class MatrixoneConfig(BaseModel):
    host: str = "localhost"
    port: int = 6001
    user: str = "dump"
    password: str = "111"
    database: str = "dify"
    metric: str = "l2"

    @model_validator(mode="before")
    @classmethod
    def validate_config(cls, values: dict):
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
        self.collection_name = collection_name.lower()
        self.client = None

    @property
    def collection_name(self):
        return self._collection_name

    @collection_name.setter
    def collection_name(self, value):
        self._collection_name = value

    def get_type(self) -> str:
        return VectorType.MATRIXONE

    def create(self, texts: list[Document], embeddings: list[list[float]], **kwargs):
        if self.client is None:
            self.client = self._get_client(len(embeddings[0]), True)
        return self.add_texts(texts, embeddings)

    def _get_client(self, dimension: int | None = None, create_table: bool = False) -> MoVectorClient:
        """
        Create a new client for the collection.

        The collection will be created if it doesn't exist.
        """
        lock_name = f"vector_indexing_lock_{self._collection_name}"
        with redis_client.lock(lock_name, timeout=20):
            client = MoVectorClient(
                connection_string=f"mysql+pymysql://{self.config.user}:{self.config.password}@{self.config.host}:{self.config.port}/{self.config.database}",
                table_name=self.collection_name,
                vector_dimension=dimension,
                create_table=create_table,
            )
            collection_exist_cache_key = f"vector_indexing_{self._collection_name}"
            if redis_client.get(collection_exist_cache_key):
                return client
            try:
                client.create_full_text_index()
                redis_client.set(collection_exist_cache_key, 1, ex=3600)
            except Exception:
                logger.exception("Failed to create full text index")
            return client

    def add_texts(self, documents: list[Document], embeddings: list[list[float]], **kwargs):
        if self.client is None:
            self.client = self._get_client(len(embeddings[0]), True)
        assert self.client is not None
        ids = []
        for doc in documents:
            if doc.metadata is not None:
                doc_id = doc.metadata.get("doc_id", str(uuid.uuid4()))
                ids.append(doc_id)
        self.client.insert(
            texts=[doc.page_content for doc in documents],
            embeddings=embeddings,
            metadatas=[doc.metadata for doc in documents],
            ids=ids,
        )
        return ids

    @ensure_client
    def text_exists(self, id: str) -> bool:
        assert self.client is not None
        result = self.client.get(ids=[id])
        return len(result) > 0

    @ensure_client
    def delete_by_ids(self, ids: list[str]):
        assert self.client is not None
        if not ids:
            return
        self.client.delete(ids=ids)

    @ensure_client
    def get_ids_by_metadata_field(self, key: str, value: str):
        assert self.client is not None
        results = self.client.query_by_metadata(filter={key: value})
        return [result.id for result in results]

    @ensure_client
    def delete_by_metadata_field(self, key: str, value: str):
        assert self.client is not None
        self.client.delete(filter={key: value})

    @ensure_client
    def search_by_vector(self, query_vector: list[float], **kwargs: Any) -> list[Document]:
        assert self.client is not None
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

    @ensure_client
    def search_by_full_text(self, query: str, **kwargs: Any) -> list[Document]:
        assert self.client is not None
        top_k = kwargs.get("top_k", 5)
        document_ids_filter = kwargs.get("document_ids_filter")
        filter = None
        if document_ids_filter:
            filter = {"document_id": {"$in": document_ids_filter}}
        score_threshold = float(kwargs.get("score_threshold", 0.0))

        results = self.client.full_text_query(
            keywords=[query],
            k=top_k,
            filter=filter,
        )

        docs = []
        for result in results:
            metadata = result.metadata
            if isinstance(metadata, str):
                import json

                metadata = json.loads(metadata)
            score = 1 - result.distance
            if score >= score_threshold:
                metadata["score"] = score
                docs.append(
                    Document(
                        page_content=result.document,
                        metadata=metadata,
                    )
                )
        return docs

    @ensure_client
    def delete(self):
        assert self.client is not None
        self.client.delete()


T = TypeVar("T", bound=MatrixoneVector)


def ensure_client(func: Callable[Concatenate[T, P], R]):
    @wraps(func)
    def wrapper(self: T, *args: P.args, **kwargs: P.kwargs):
        if self.client is None:
            self.client = self._get_client(None, False)
        return func(self, *args, **kwargs)

    return wrapper


class MatrixoneVectorFactory(AbstractVectorFactory):
    def init_vector(self, dataset: Dataset, attributes: list, embeddings: Embeddings) -> MatrixoneVector:
        if dataset.index_struct_dict:
            class_prefix: str = dataset.index_struct_dict["vector_store"]["class_prefix"]
            collection_name = class_prefix
        else:
            dataset_id = dataset.id
            collection_name = Dataset.gen_collection_name_by_id(dataset_id)
            dataset.index_struct = json.dumps(self.gen_index_struct_dict(VectorType.MATRIXONE, collection_name))

        config = MatrixoneConfig(
            host=dify_config.MATRIXONE_HOST or "localhost",
            port=dify_config.MATRIXONE_PORT or 6001,
            user=dify_config.MATRIXONE_USER or "dump",
            password=dify_config.MATRIXONE_PASSWORD or "111",
            database=dify_config.MATRIXONE_DATABASE or "dify",
            metric=dify_config.MATRIXONE_METRIC or "l2",
        )
        return MatrixoneVector(collection_name=collection_name, config=config)
