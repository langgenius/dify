import json
import logging
from typing import Any, Optional

from packaging import version
from pydantic import BaseModel, model_validator
from pymilvus import MilvusClient, MilvusException  # type: ignore
from pymilvus.milvus_client import IndexParams  # type: ignore

from configs import dify_config
from core.rag.datasource.vdb.field import Field
from core.rag.datasource.vdb.vector_base import BaseVector
from core.rag.datasource.vdb.vector_factory import AbstractVectorFactory
from core.rag.datasource.vdb.vector_type import VectorType
from core.rag.embedding.embedding_base import Embeddings
from core.rag.models.document import Document
from extensions.ext_redis import redis_client
from models.dataset import Dataset

logger = logging.getLogger(__name__)


class MilvusConfig(BaseModel):
    """
    Configuration class for Milvus connection.
    """

    uri: str  # Milvus server URI
    token: Optional[str] = None  # Optional token for authentication
    user: str  # Username for authentication
    password: str  # Password for authentication
    batch_size: int = 100  # Batch size for operations
    database: str = "default"  # Database name
    enable_hybrid_search: bool = False  # Flag to enable hybrid search

    @model_validator(mode="before")
    @classmethod
    def validate_config(cls, values: dict) -> dict:
        """
        Validate the configuration values.
        Raises ValueError if required fields are missing.
        """
        if not values.get("uri"):
            raise ValueError("config MILVUS_URI is required")
        if not values.get("user"):
            raise ValueError("config MILVUS_USER is required")
        if not values.get("password"):
            raise ValueError("config MILVUS_PASSWORD is required")
        return values

    def to_milvus_params(self):
        """
        Convert the configuration to a dictionary of Milvus connection parameters.
        """
        return {
            "uri": self.uri,
            "token": self.token,
            "user": self.user,
            "password": self.password,
            "db_name": self.database,
        }


class MilvusVector(BaseVector):
    """
    Milvus vector storage implementation.
    """

    def __init__(self, collection_name: str, config: MilvusConfig):
        super().__init__(collection_name)
        self._client_config = config
        self._client = self._init_client(config)
        self._consistency_level = "Session"  # Consistency level for Milvus operations
        self._fields: list[str] = []  # List of fields in the collection
        self._hybrid_search_enabled = self._check_hybrid_search_support()  # Check if hybrid search is supported

    def _check_hybrid_search_support(self) -> bool:
        """
        Check if the current Milvus version supports hybrid search.
        Returns True if the version is >= 2.5.0, otherwise False.
        """
        if not self._client_config.enable_hybrid_search:
            return False

        try:
            milvus_version = self._client.get_server_version()
            return version.parse(milvus_version).base_version >= version.parse("2.5.0").base_version
        except Exception as e:
            logger.warning(f"Failed to check Milvus version: {str(e)}. Disabling hybrid search.")
            return False

    def get_type(self) -> str:
        """
        Get the type of vector storage (Milvus).
        """
        return VectorType.MILVUS

    def create(self, texts: list[Document], embeddings: list[list[float]], **kwargs):
        """
        Create a collection and add texts with embeddings.
        """
        index_params = {"metric_type": "IP", "index_type": "HNSW", "params": {"M": 8, "efConstruction": 64}}
        metadatas = [d.metadata if d.metadata is not None else {} for d in texts]
        self.create_collection(embeddings, metadatas, index_params)
        self.add_texts(texts, embeddings)

    def add_texts(self, documents: list[Document], embeddings: list[list[float]], **kwargs):
        """
        Add texts and their embeddings to the collection.
        """
        insert_dict_list = []
        for i in range(len(documents)):
            insert_dict = {
                # Do not need to insert the sparse_vector field separately, as the text_bm25_emb
                # function will automatically convert the native text into a sparse vector for us.
                Field.CONTENT_KEY.value: documents[i].page_content,
                Field.VECTOR.value: embeddings[i],
                Field.METADATA_KEY.value: documents[i].metadata,
            }
            insert_dict_list.append(insert_dict)
        # Total insert count
        total_count = len(insert_dict_list)
        pks: list[str] = []

        for i in range(0, total_count, 1000):
            # Insert into the collection.
            batch_insert_list = insert_dict_list[i : i + 1000]
            try:
                ids = self._client.insert(collection_name=self._collection_name, data=batch_insert_list)
                pks.extend(ids)
            except MilvusException as e:
                logger.exception("Failed to insert batch starting at entity: %s/%s", i, total_count)
                raise e
        return pks

    def get_ids_by_metadata_field(self, key: str, value: str):
        """
        Get document IDs by metadata field key and value.
        """
        result = self._client.query(
            collection_name=self._collection_name, filter=f'metadata["{key}"] == "{value}"', output_fields=["id"]
        )
        if result:
            return [item["id"] for item in result]
        else:
            return None

    def delete_by_metadata_field(self, key: str, value: str):
        """
        Delete documents by metadata field key and value.
        """
        if self._client.has_collection(self._collection_name):
            ids = self.get_ids_by_metadata_field(key, value)
            if ids:
                self._client.delete(collection_name=self._collection_name, pks=ids)

    def delete_by_ids(self, ids: list[str]) -> None:
        """
        Delete documents by their IDs.
        """
        if self._client.has_collection(self._collection_name):
            result = self._client.query(
                collection_name=self._collection_name, filter=f'metadata["doc_id"] in {ids}', output_fields=["id"]
            )
            if result:
                ids = [item["id"] for item in result]
                self._client.delete(collection_name=self._collection_name, pks=ids)

    def delete(self) -> None:
        """
        Delete the entire collection.
        """
        if self._client.has_collection(self._collection_name):
            self._client.drop_collection(self._collection_name, None)

    def text_exists(self, id: str) -> bool:
        """
        Check if a text with the given ID exists in the collection.
        """
        if not self._client.has_collection(self._collection_name):
            return False

        result = self._client.query(
            collection_name=self._collection_name, filter=f'metadata["doc_id"] == "{id}"', output_fields=["id"]
        )

        return len(result) > 0

    def field_exists(self, field: str) -> bool:
        """
        Check if a field exists in the collection.
        """
        return field in self._fields

    def _process_search_results(
        self, results: list[Any], output_fields: list[str], score_threshold: float = 0.0
    ) -> list[Document]:
        """
        Common method to process search results

        :param results: Search results
        :param output_fields: Fields to be output
        :param score_threshold: Score threshold for filtering
        :return: List of documents
        """
        docs = []
        for result in results[0]:
            metadata = result["entity"].get(output_fields[1], {})
            metadata["score"] = result["distance"]

            if result["distance"] > score_threshold:
                doc = Document(page_content=result["entity"].get(output_fields[0], ""), metadata=metadata)
                docs.append(doc)

        return docs

    def search_by_vector(self, query_vector: list[float], **kwargs: Any) -> list[Document]:
        """
        Search for documents by vector similarity.
        """
        results = self._client.search(
            collection_name=self._collection_name,
            data=[query_vector],
            anns_field=Field.VECTOR.value,
            limit=kwargs.get("top_k", 4),
            output_fields=[Field.CONTENT_KEY.value, Field.METADATA_KEY.value],
        )

        return self._process_search_results(
            results,
            output_fields=[Field.CONTENT_KEY.value, Field.METADATA_KEY.value],
            score_threshold=float(kwargs.get("score_threshold") or 0.0),
        )

    def search_by_full_text(self, query: str, **kwargs: Any) -> list[Document]:
        """
        Search for documents by full-text search (if hybrid search is enabled).
        """
        if not self._hybrid_search_enabled or not self.field_exists(Field.SPARSE_VECTOR.value):
            logger.warning("Full-text search is not supported in current Milvus version (requires >= 2.5.0)")
            return []

        results = self._client.search(
            collection_name=self._collection_name,
            data=[query],
            anns_field=Field.SPARSE_VECTOR.value,
            limit=kwargs.get("top_k", 4),
            output_fields=[Field.CONTENT_KEY.value, Field.METADATA_KEY.value],
        )

        return self._process_search_results(
            results,
            output_fields=[Field.CONTENT_KEY.value, Field.METADATA_KEY.value],
            score_threshold=float(kwargs.get("score_threshold") or 0.0),
        )

    def create_collection(
        self, embeddings: list, metadatas: Optional[list[dict]] = None, index_params: Optional[dict] = None
    ):
        """
        Create a new collection in Milvus with the specified schema and index parameters.
        """
        lock_name = "vector_indexing_lock_{}".format(self._collection_name)
        with redis_client.lock(lock_name, timeout=20):
            collection_exist_cache_key = "vector_indexing_{}".format(self._collection_name)
            if redis_client.get(collection_exist_cache_key):
                return
            # Grab the existing collection if it exists
            if not self._client.has_collection(self._collection_name):
                from pymilvus import CollectionSchema, DataType, FieldSchema, Function, FunctionType  # type: ignore
                from pymilvus.orm.types import infer_dtype_bydata  # type: ignore

                # Determine embedding dim
                dim = len(embeddings[0])
                fields = []
                if metadatas:
                    fields.append(FieldSchema(Field.METADATA_KEY.value, DataType.JSON, max_length=65_535))

                # Create the text field, enable_analyzer will be set True to support milvus automatically
                # transfer text to sparse_vector, reference: https://milvus.io/docs/full-text-search.md
                fields.append(
                    FieldSchema(
                        Field.CONTENT_KEY.value,
                        DataType.VARCHAR,
                        max_length=65_535,
                        enable_analyzer=self._hybrid_search_enabled,
                    )
                )
                # Create the primary key field
                fields.append(FieldSchema(Field.PRIMARY_KEY.value, DataType.INT64, is_primary=True, auto_id=True))
                # Create the vector field, supports binary or float vectors
                fields.append(FieldSchema(Field.VECTOR.value, infer_dtype_bydata(embeddings[0]), dim=dim))
                # Create Sparse Vector Index for the collection
                if self._hybrid_search_enabled:
                    fields.append(FieldSchema(Field.SPARSE_VECTOR.value, DataType.SPARSE_FLOAT_VECTOR))

                schema = CollectionSchema(fields)

                # Create custom function to support text to sparse vector by BM25
                if self._hybrid_search_enabled:
                    bm25_function = Function(
                        name="text_bm25_emb",
                        input_field_names=[Field.CONTENT_KEY.value],
                        output_field_names=[Field.SPARSE_VECTOR.value],
                        function_type=FunctionType.BM25,
                    )
                    schema.add_function(bm25_function)

                for x in schema.fields:
                    self._fields.append(x.name)
                # Since primary field is auto-id, no need to track it
                self._fields.remove(Field.PRIMARY_KEY.value)

                # Create Index params for the collection
                index_params_obj = IndexParams()
                index_params_obj.add_index(field_name=Field.VECTOR.value, **index_params)

                # Create Sparse Vector Index for the collection
                if self._hybrid_search_enabled:
                    index_params_obj.add_index(
                        field_name=Field.SPARSE_VECTOR.value, index_type="AUTOINDEX", metric_type="BM25"
                    )

                # Create the collection
                self._client.create_collection(
                    collection_name=self._collection_name,
                    schema=schema,
                    index_params=index_params_obj,
                    consistency_level=self._consistency_level,
                )
            redis_client.set(collection_exist_cache_key, 1, ex=3600)

    def _init_client(self, config) -> MilvusClient:
        """
        Initialize and return a Milvus client.
        """
        client = MilvusClient(uri=config.uri, user=config.user, password=config.password, db_name=config.database)
        return client


class MilvusVectorFactory(AbstractVectorFactory):
    """
    Factory class for creating MilvusVector instances.
    """

    def init_vector(self, dataset: Dataset, attributes: list, embeddings: Embeddings) -> MilvusVector:
        """
        Initialize a MilvusVector instance for the given dataset.
        """
        if dataset.index_struct_dict:
            class_prefix: str = dataset.index_struct_dict["vector_store"]["class_prefix"]
            collection_name = class_prefix
        else:
            dataset_id = dataset.id
            collection_name = Dataset.gen_collection_name_by_id(dataset_id)
            dataset.index_struct = json.dumps(self.gen_index_struct_dict(VectorType.MILVUS, collection_name))

        return MilvusVector(
            collection_name=collection_name,
            config=MilvusConfig(
                uri=dify_config.MILVUS_URI or "",
                token=dify_config.MILVUS_TOKEN or "",
                user=dify_config.MILVUS_USER or "",
                password=dify_config.MILVUS_PASSWORD or "",
                database=dify_config.MILVUS_DATABASE or "",
                enable_hybrid_search=dify_config.MILVUS_ENABLE_HYBRID_SEARCH or False,
            ),
        )
