import json
import logging
from typing import Any
from uuid import uuid4

from opensearchpy import OpenSearch, Urllib3AWSV4SignerAuth, Urllib3HttpConnection, helpers
from opensearchpy.helpers import BulkIndexError
from pydantic import BaseModel, model_validator

from configs import dify_config
from configs.middleware.vdb.opensearch_config import AuthMethod
from core.rag.datasource.vdb.field import Field
from core.rag.datasource.vdb.vector_base import BaseVector
from core.rag.datasource.vdb.vector_factory import AbstractVectorFactory
from core.rag.datasource.vdb.vector_type import VectorType
from core.rag.embedding.embedding_base import Embeddings
from core.rag.models.document import Document
from extensions.ext_redis import redis_client
from models.dataset import Dataset

logger = logging.getLogger(__name__)


class OpenSearchConfig(BaseModel):
    host: str
    port: int
    secure: bool = False  # use_ssl
    verify_certs: bool = True
    auth_method: AuthMethod = AuthMethod.BASIC
    user: str | None = None
    password: str | None = None
    aws_region: str | None = None
    aws_service: str | None = None

    @model_validator(mode="before")
    @classmethod
    def validate_config(cls, values: dict):
        if not values.get("host"):
            raise ValueError("config OPENSEARCH_HOST is required")
        if not values.get("port"):
            raise ValueError("config OPENSEARCH_PORT is required")
        if values.get("auth_method") == "aws_managed_iam":
            if not values.get("aws_region"):
                raise ValueError("config OPENSEARCH_AWS_REGION is required for AWS_MANAGED_IAM auth method")
            if not values.get("aws_service"):
                raise ValueError("config OPENSEARCH_AWS_SERVICE is required for AWS_MANAGED_IAM auth method")
        if not values.get("OPENSEARCH_SECURE") and values.get("OPENSEARCH_VERIFY_CERTS"):
            raise ValueError("verify_certs=True requires secure (HTTPS) connection")
        return values

    def create_aws_managed_iam_auth(self) -> Urllib3AWSV4SignerAuth:
        import boto3

        return Urllib3AWSV4SignerAuth(
            credentials=boto3.Session().get_credentials(),
            region=self.aws_region,
            service=self.aws_service,  # type: ignore[arg-type]
        )

    def to_opensearch_params(self) -> dict[str, Any]:
        params = {
            "hosts": [{"host": self.host, "port": self.port}],
            "use_ssl": self.secure,
            "verify_certs": self.verify_certs,
            "connection_class": Urllib3HttpConnection,
            "pool_maxsize": 20,
        }

        if self.auth_method == "basic":
            logger.info("Using basic authentication for OpenSearch Vector DB")

            params["http_auth"] = (self.user, self.password)
        elif self.auth_method == "aws_managed_iam":
            logger.info("Using AWS managed IAM role for OpenSearch Vector DB")

            params["http_auth"] = self.create_aws_managed_iam_auth()

        return params


class OpenSearchVector(BaseVector):
    def __init__(self, collection_name: str, config: OpenSearchConfig):
        super().__init__(collection_name)
        self._client_config = config
        self._client = OpenSearch(**config.to_opensearch_params())

    def get_type(self) -> str:
        return VectorType.OPENSEARCH

    def create(self, texts: list[Document], embeddings: list[list[float]], **kwargs):
        metadatas = [d.metadata if d.metadata is not None else {} for d in texts]
        self.create_collection(embeddings, metadatas)
        self.add_texts(texts, embeddings)

    def add_texts(self, documents: list[Document], embeddings: list[list[float]], **kwargs):
        actions = []
        for i in range(len(documents)):
            action = {
                "_op_type": "index",
                "_index": self._collection_name.lower(),
                "_source": {
                    Field.CONTENT_KEY: documents[i].page_content,
                    Field.VECTOR: embeddings[i],  # Make sure you pass an array here
                    Field.METADATA_KEY: documents[i].metadata,
                },
            }
            # See https://github.com/langchain-ai/langchainjs/issues/4346#issuecomment-1935123377
            if self._client_config.aws_service != "aoss":
                action["_id"] = uuid4().hex
            actions.append(action)

        helpers.bulk(
            client=self._client,
            actions=actions,
            timeout=30,
            max_retries=3,
        )

    def get_ids_by_metadata_field(self, key: str, value: str):
        query = {"query": {"term": {f"{Field.METADATA_KEY}.{key}": value}}}
        response = self._client.search(index=self._collection_name.lower(), body=query)
        if response["hits"]["hits"]:
            return [hit["_id"] for hit in response["hits"]["hits"]]
        else:
            return None

    def delete_by_metadata_field(self, key: str, value: str):
        ids = self.get_ids_by_metadata_field(key, value)
        if ids:
            self.delete_by_ids(ids)

    def delete_by_ids(self, ids: list[str]):
        index_name = self._collection_name.lower()
        if not self._client.indices.exists(index=index_name):
            logger.warning("Index %s does not exist", index_name)
            return

        # Obtaining All Actual Documents_ID
        actual_ids = []

        for doc_id in ids:
            es_ids = self.get_ids_by_metadata_field("doc_id", doc_id)
            if es_ids:
                actual_ids.extend(es_ids)
            else:
                logger.warning("Document with metadata doc_id %s not found for deletion", doc_id)

        if actual_ids:
            actions = [{"_op_type": "delete", "_index": index_name, "_id": es_id} for es_id in actual_ids]
            try:
                helpers.bulk(self._client, actions)
            except BulkIndexError as e:
                for error in e.errors:
                    delete_error = error.get("delete", {})
                    status = delete_error.get("status")
                    doc_id = delete_error.get("_id")

                    if status == 404:
                        logger.warning("Document not found for deletion: %s", doc_id)
                    else:
                        logger.exception("Error deleting document: %s", error)

    def delete(self):
        self._client.indices.delete(index=self._collection_name.lower(), ignore_unavailable=True)

    def text_exists(self, id: str) -> bool:
        try:
            self._client.get(index=self._collection_name.lower(), id=id)
            return True
        except:
            return False

    def search_by_vector(self, query_vector: list[float], **kwargs: Any) -> list[Document]:
        # Make sure query_vector is a list
        if not isinstance(query_vector, list):
            raise ValueError("query_vector should be a list of floats")

        # Check whether query_vector is a floating-point number list
        if not all(isinstance(x, float) for x in query_vector):
            raise ValueError("All elements in query_vector should be floats")

        query = {
            "size": kwargs.get("top_k", 4),
            "query": {"knn": {Field.VECTOR: {Field.VECTOR: query_vector, "k": kwargs.get("top_k", 4)}}},
        }
        document_ids_filter = kwargs.get("document_ids_filter")
        if document_ids_filter:
            query["query"] = {
                "script_score": {
                    "query": {"bool": {"filter": [{"terms": {Field.DOCUMENT_ID: document_ids_filter}}]}},
                    "script": {
                        "source": "knn_score",
                        "lang": "knn",
                        "params": {"field": Field.VECTOR, "query_value": query_vector, "space_type": "l2"},
                    },
                }
            }

        try:
            response = self._client.search(index=self._collection_name.lower(), body=query)
        except Exception:
            logger.exception("Error executing vector search, query: %s", query)
            raise

        docs = []
        for hit in response["hits"]["hits"]:
            metadata = hit["_source"].get(Field.METADATA_KEY, {})

            # Make sure metadata is a dictionary
            if metadata is None:
                metadata = {}

            metadata["score"] = hit["_score"]
            score_threshold = float(kwargs.get("score_threshold") or 0.0)
            if hit["_score"] >= score_threshold:
                doc = Document(page_content=hit["_source"].get(Field.CONTENT_KEY), metadata=metadata)
                docs.append(doc)

        return docs

    def search_by_full_text(self, query: str, **kwargs: Any) -> list[Document]:
        full_text_query = {"query": {"bool": {"must": [{"match": {Field.CONTENT_KEY.value: query}}]}}}
        document_ids_filter = kwargs.get("document_ids_filter")
        if document_ids_filter:
            full_text_query["query"]["bool"]["filter"] = [{"terms": {"metadata.document_id": document_ids_filter}}]

        response = self._client.search(index=self._collection_name.lower(), body=full_text_query)

        docs = []
        for hit in response["hits"]["hits"]:
            metadata = hit["_source"].get(Field.METADATA_KEY)
            vector = hit["_source"].get(Field.VECTOR)
            page_content = hit["_source"].get(Field.CONTENT_KEY)
            doc = Document(page_content=page_content, vector=vector, metadata=metadata)
            docs.append(doc)

        return docs

    def create_collection(
        self, embeddings: list, metadatas: list[dict] | None = None, index_params: dict | None = None
    ):
        lock_name = f"vector_indexing_lock_{self._collection_name.lower()}"
        with redis_client.lock(lock_name, timeout=20):
            collection_exist_cache_key = f"vector_indexing_{self._collection_name.lower()}"
            if redis_client.get(collection_exist_cache_key):
                logger.info("Collection %s already exists.", self._collection_name.lower())
                return

            if not self._client.indices.exists(index=self._collection_name.lower()):
                index_body = {
                    "settings": {"index": {"knn": True}},
                    "mappings": {
                        "properties": {
                            Field.CONTENT_KEY: {"type": "text"},
                            Field.VECTOR: {
                                "type": "knn_vector",
                                "dimension": len(embeddings[0]),  # Make sure the dimension is correct here
                                "method": {
                                    "name": "hnsw",
                                    "space_type": "l2",
                                    "engine": "faiss",
                                    "parameters": {"ef_construction": 64, "m": 8},
                                },
                            },
                            Field.METADATA_KEY: {
                                "type": "object",
                                "properties": {
                                    "doc_id": {"type": "keyword"},  # Map doc_id to keyword type
                                    "document_id": {"type": "keyword"},
                                },
                            },
                        }
                    },
                }

                logger.info("Creating OpenSearch index %s", self._collection_name.lower())
                self._client.indices.create(index=self._collection_name.lower(), body=index_body)

            redis_client.set(collection_exist_cache_key, 1, ex=3600)


class OpenSearchVectorFactory(AbstractVectorFactory):
    def init_vector(self, dataset: Dataset, attributes: list, embeddings: Embeddings) -> OpenSearchVector:
        if dataset.index_struct_dict:
            class_prefix: str = dataset.index_struct_dict["vector_store"]["class_prefix"]
            collection_name = class_prefix.lower()
        else:
            dataset_id = dataset.id
            collection_name = Dataset.gen_collection_name_by_id(dataset_id).lower()
            dataset.index_struct = json.dumps(self.gen_index_struct_dict(VectorType.OPENSEARCH, collection_name))

        open_search_config = OpenSearchConfig(
            host=dify_config.OPENSEARCH_HOST or "localhost",
            port=dify_config.OPENSEARCH_PORT,
            secure=dify_config.OPENSEARCH_SECURE,
            verify_certs=dify_config.OPENSEARCH_VERIFY_CERTS,
            auth_method=dify_config.OPENSEARCH_AUTH_METHOD,
            user=dify_config.OPENSEARCH_USER,
            password=dify_config.OPENSEARCH_PASSWORD,
            aws_region=dify_config.OPENSEARCH_AWS_REGION,
            aws_service=dify_config.OPENSEARCH_AWS_SERVICE,
        )

        return OpenSearchVector(collection_name=collection_name, config=open_search_config)
