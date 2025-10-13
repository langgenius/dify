import json
import logging
import math
from typing import Any, cast
from urllib.parse import urlparse

from elasticsearch import ConnectionError as ElasticsearchConnectionError
from elasticsearch import Elasticsearch
from flask import current_app
from packaging.version import parse as parse_version
from pydantic import BaseModel, model_validator

from core.rag.datasource.vdb.field import Field
from core.rag.datasource.vdb.vector_base import BaseVector
from core.rag.datasource.vdb.vector_factory import AbstractVectorFactory
from core.rag.datasource.vdb.vector_type import VectorType
from core.rag.embedding.embedding_base import Embeddings
from core.rag.models.document import Document
from extensions.ext_redis import redis_client
from models.dataset import Dataset

logger = logging.getLogger(__name__)


class ElasticSearchConfig(BaseModel):
    # Regular Elasticsearch config
    host: str | None = None
    port: int | None = None
    username: str | None = None
    password: str | None = None

    # Elastic Cloud specific config
    cloud_url: str | None = None  # Cloud URL for Elasticsearch Cloud
    api_key: str | None = None

    # Common config
    use_cloud: bool = False
    ca_certs: str | None = None
    verify_certs: bool = False
    request_timeout: int = 100000
    retry_on_timeout: bool = True
    max_retries: int = 10000

    @model_validator(mode="before")
    @classmethod
    def validate_config(cls, values: dict):
        use_cloud = values.get("use_cloud", False)
        cloud_url = values.get("cloud_url")

        if use_cloud:
            # Cloud configuration validation - requires cloud_url and api_key
            if not cloud_url:
                raise ValueError("cloud_url is required for Elastic Cloud")

            api_key = values.get("api_key")
            if not api_key:
                raise ValueError("api_key is required for Elastic Cloud")

        else:
            # Regular Elasticsearch validation
            if not values.get("host"):
                raise ValueError("config HOST is required for regular Elasticsearch")
            if not values.get("port"):
                raise ValueError("config PORT is required for regular Elasticsearch")
            if not values.get("username"):
                raise ValueError("config USERNAME is required for regular Elasticsearch")
            if not values.get("password"):
                raise ValueError("config PASSWORD is required for regular Elasticsearch")

        return values


class ElasticSearchVector(BaseVector):
    def __init__(self, index_name: str, config: ElasticSearchConfig, attributes: list):
        super().__init__(index_name.lower())
        self._client = self._init_client(config)
        self._version = self._get_version()
        self._check_version()
        self._attributes = attributes

    def _init_client(self, config: ElasticSearchConfig) -> Elasticsearch:
        """
        Initialize Elasticsearch client for both regular Elasticsearch and Elastic Cloud.
        """
        try:
            # Check if using Elastic Cloud
            client_config: dict[str, Any]
            if config.use_cloud and config.cloud_url:
                client_config = {
                    "request_timeout": config.request_timeout,
                    "retry_on_timeout": config.retry_on_timeout,
                    "max_retries": config.max_retries,
                    "verify_certs": config.verify_certs,
                }

                # Parse cloud URL and configure hosts
                parsed_url = urlparse(config.cloud_url)
                host = f"{parsed_url.scheme}://{parsed_url.hostname}"
                if parsed_url.port:
                    host += f":{parsed_url.port}"

                client_config["hosts"] = [host]

                # API key authentication for cloud
                client_config["api_key"] = config.api_key

                # SSL settings
                if config.ca_certs:
                    client_config["ca_certs"] = config.ca_certs

            else:
                # Regular Elasticsearch configuration
                parsed_url = urlparse(config.host or "")
                if parsed_url.scheme in {"http", "https"}:
                    hosts = f"{config.host}:{config.port}"
                    use_https = parsed_url.scheme == "https"
                else:
                    hosts = f"http://{config.host}:{config.port}"
                    use_https = False

                client_config = {
                    "hosts": [hosts],
                    "basic_auth": (config.username, config.password),
                    "request_timeout": config.request_timeout,
                    "retry_on_timeout": config.retry_on_timeout,
                    "max_retries": config.max_retries,
                }

                # Only add SSL settings if using HTTPS
                if use_https:
                    client_config["verify_certs"] = config.verify_certs
                    if config.ca_certs:
                        client_config["ca_certs"] = config.ca_certs

            client = Elasticsearch(**client_config)

            # Test connection
            if not client.ping():
                raise ConnectionError("Failed to connect to Elasticsearch")

        except ElasticsearchConnectionError as e:
            raise ConnectionError(f"Vector database connection error: {str(e)}")
        except Exception as e:
            raise ConnectionError(f"Elasticsearch client initialization failed: {str(e)}")

        return client

    def _get_version(self) -> str:
        info = self._client.info()
        return cast(str, info["version"]["number"])

    def _check_version(self):
        if parse_version(self._version) < parse_version("8.0.0"):
            raise ValueError("Elasticsearch vector database version must be greater than 8.0.0")

    def get_type(self) -> str:
        return VectorType.ELASTICSEARCH

    def add_texts(self, documents: list[Document], embeddings: list[list[float]], **kwargs):
        uuids = self._get_uuids(documents)
        for i in range(len(documents)):
            self._client.index(
                index=self._collection_name,
                id=uuids[i],
                document={
                    Field.CONTENT_KEY: documents[i].page_content,
                    Field.VECTOR: embeddings[i] or None,
                    Field.METADATA_KEY: documents[i].metadata or {},
                },
            )
        self._client.indices.refresh(index=self._collection_name)
        return uuids

    def text_exists(self, id: str) -> bool:
        return bool(self._client.exists(index=self._collection_name, id=id))

    def delete_by_ids(self, ids: list[str]):
        if not ids:
            return
        for id in ids:
            self._client.delete(index=self._collection_name, id=id)

    def delete_by_metadata_field(self, key: str, value: str):
        query_str = {"query": {"match": {f"metadata.{key}": f"{value}"}}}
        results = self._client.search(index=self._collection_name, body=query_str)
        ids = [hit["_id"] for hit in results["hits"]["hits"]]
        if ids:
            self.delete_by_ids(ids)

    def delete(self):
        self._client.indices.delete(index=self._collection_name)

    def search_by_vector(self, query_vector: list[float], **kwargs: Any) -> list[Document]:
        top_k = kwargs.get("top_k", 4)
        num_candidates = math.ceil(top_k * 1.5)
        knn = {"field": Field.VECTOR, "query_vector": query_vector, "k": top_k, "num_candidates": num_candidates}
        document_ids_filter = kwargs.get("document_ids_filter")
        if document_ids_filter:
            knn["filter"] = {"terms": {"metadata.document_id": document_ids_filter}}

        results = self._client.search(index=self._collection_name, knn=knn, size=top_k)

        docs_and_scores = []
        for hit in results["hits"]["hits"]:
            docs_and_scores.append(
                (
                    Document(
                        page_content=hit["_source"][Field.CONTENT_KEY],
                        vector=hit["_source"][Field.VECTOR],
                        metadata=hit["_source"][Field.METADATA_KEY],
                    ),
                    hit["_score"],
                )
            )

        docs = []
        for doc, score in docs_and_scores:
            score_threshold = float(kwargs.get("score_threshold") or 0.0)
            if score >= score_threshold:
                if doc.metadata is not None:
                    doc.metadata["score"] = score
                    docs.append(doc)

        return docs

    def search_by_full_text(self, query: str, **kwargs: Any) -> list[Document]:
        query_str: dict[str, Any] = {"match": {Field.CONTENT_KEY: query}}
        document_ids_filter = kwargs.get("document_ids_filter")

        if document_ids_filter:
            query_str = {
                "bool": {
                    "must": {"match": {Field.CONTENT_KEY: query}},
                    "filter": {"terms": {"metadata.document_id": document_ids_filter}},
                }
            }

        results = self._client.search(index=self._collection_name, query=query_str, size=kwargs.get("top_k", 4))
        docs = []
        for hit in results["hits"]["hits"]:
            docs.append(
                Document(
                    page_content=hit["_source"][Field.CONTENT_KEY],
                    vector=hit["_source"][Field.VECTOR],
                    metadata=hit["_source"][Field.METADATA_KEY],
                )
            )

        return docs

    def create(self, texts: list[Document], embeddings: list[list[float]], **kwargs):
        metadatas = [d.metadata if d.metadata is not None else {} for d in texts]
        self.create_collection(embeddings, metadatas)
        self.add_texts(texts, embeddings, **kwargs)

    def create_collection(
        self,
        embeddings: list[list[float]],
        metadatas: list[dict[Any, Any]] | None = None,
        index_params: dict | None = None,
    ):
        lock_name = f"vector_indexing_lock_{self._collection_name}"
        with redis_client.lock(lock_name, timeout=20):
            collection_exist_cache_key = f"vector_indexing_{self._collection_name}"
            if redis_client.get(collection_exist_cache_key):
                logger.info("Collection %s already exists.", self._collection_name)
                return

            if not self._client.indices.exists(index=self._collection_name):
                dim = len(embeddings[0])
                mappings = {
                    "properties": {
                        Field.CONTENT_KEY: {"type": "text"},
                        Field.VECTOR: {  # Make sure the dimension is correct here
                            "type": "dense_vector",
                            "dims": dim,
                            "index": True,
                            "similarity": "cosine",
                        },
                        Field.METADATA_KEY: {
                            "type": "object",
                            "properties": {
                                "doc_id": {"type": "keyword"},  # Map doc_id to keyword type
                                "document_id": {"type": "keyword"},  # Map doc_id to keyword type
                            },
                        },
                    }
                }

                self._client.indices.create(index=self._collection_name, mappings=mappings)
                logger.info("Created index %s with dimension %s", self._collection_name, dim)
            else:
                logger.info("Collection %s already exists.", self._collection_name)

            redis_client.set(collection_exist_cache_key, 1, ex=3600)


class ElasticSearchVectorFactory(AbstractVectorFactory):
    def init_vector(self, dataset: Dataset, attributes: list, embeddings: Embeddings) -> ElasticSearchVector:
        if dataset.index_struct_dict:
            class_prefix: str = dataset.index_struct_dict["vector_store"]["class_prefix"]
            collection_name = class_prefix
        else:
            dataset_id = dataset.id
            collection_name = Dataset.gen_collection_name_by_id(dataset_id)
            dataset.index_struct = json.dumps(self.gen_index_struct_dict(VectorType.ELASTICSEARCH, collection_name))

        config = current_app.config

        # Check if ELASTICSEARCH_USE_CLOUD is explicitly set to false (boolean)
        use_cloud_env = config.get("ELASTICSEARCH_USE_CLOUD", False)

        if use_cloud_env is False:
            # Use regular Elasticsearch with config values
            config_dict = {
                "use_cloud": False,
                "host": config.get("ELASTICSEARCH_HOST", "elasticsearch"),
                "port": config.get("ELASTICSEARCH_PORT", 9200),
                "username": config.get("ELASTICSEARCH_USERNAME", "elastic"),
                "password": config.get("ELASTICSEARCH_PASSWORD", "elastic"),
            }
        else:
            # Check for cloud configuration
            cloud_url = config.get("ELASTICSEARCH_CLOUD_URL")
            if cloud_url:
                config_dict = {
                    "use_cloud": True,
                    "cloud_url": cloud_url,
                    "api_key": config.get("ELASTICSEARCH_API_KEY"),
                }
            else:
                # Fallback to regular Elasticsearch
                config_dict = {
                    "use_cloud": False,
                    "host": config.get("ELASTICSEARCH_HOST", "localhost"),
                    "port": config.get("ELASTICSEARCH_PORT", 9200),
                    "username": config.get("ELASTICSEARCH_USERNAME", "elastic"),
                    "password": config.get("ELASTICSEARCH_PASSWORD", ""),
                }

        # Common configuration
        config_dict.update(
            {
                "ca_certs": str(config.get("ELASTICSEARCH_CA_CERTS")) if config.get("ELASTICSEARCH_CA_CERTS") else None,
                "verify_certs": bool(config.get("ELASTICSEARCH_VERIFY_CERTS", False)),
                "request_timeout": int(config.get("ELASTICSEARCH_REQUEST_TIMEOUT", 100000)),
                "retry_on_timeout": bool(config.get("ELASTICSEARCH_RETRY_ON_TIMEOUT", True)),
                "max_retries": int(config.get("ELASTICSEARCH_MAX_RETRIES", 10000)),
            }
        )

        return ElasticSearchVector(
            index_name=collection_name,
            config=ElasticSearchConfig(**config_dict),
            attributes=[],
        )
