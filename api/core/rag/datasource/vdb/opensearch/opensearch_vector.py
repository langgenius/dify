import json
import logging
import ssl
from typing import Any, Optional
from uuid import uuid4

from opensearchpy import OpenSearch, helpers
from opensearchpy.helpers import BulkIndexError
from pydantic import BaseModel, model_validator

from configs import dify_config
from core.rag.datasource.entity.embedding import Embeddings
from core.rag.datasource.vdb.field import Field
from core.rag.datasource.vdb.vector_base import BaseVector
from core.rag.datasource.vdb.vector_factory import AbstractVectorFactory
from core.rag.datasource.vdb.vector_type import VectorType
from core.rag.models.document import Document
from extensions.ext_redis import redis_client
from models.dataset import Dataset

logger = logging.getLogger(__name__)


class OpenSearchConfig(BaseModel):
    host: str
    port: int
    user: Optional[str] = None
    password: Optional[str] = None
    secure: bool = False

    @model_validator(mode='before')
    def validate_config(cls, values: dict) -> dict:
        if not values.get('host'):
            raise ValueError("config OPENSEARCH_HOST is required")
        if not values.get('port'):
            raise ValueError("config OPENSEARCH_PORT is required")
        return values

    def create_ssl_context(self) -> ssl.SSLContext:
        ssl_context = ssl.create_default_context()
        ssl_context.check_hostname = False
        ssl_context.verify_mode = ssl.CERT_NONE  # Disable Certificate Validation
        return ssl_context

    def to_opensearch_params(self) -> dict[str, Any]:
        params = {
            'hosts': [{'host': self.host, 'port': self.port}],
            'use_ssl': self.secure,
            'verify_certs': self.secure,
        }
        if self.user and self.password:
            params['http_auth'] = (self.user, self.password)
        if self.secure:
            params['ssl_context'] = self.create_ssl_context()
        return params


class OpenSearchVector(BaseVector):

    def __init__(self, collection_name: str, config: OpenSearchConfig):
        super().__init__(collection_name)
        self._client_config = config
        self._client = OpenSearch(**config.to_opensearch_params())

    def get_type(self) -> str:
        return VectorType.OPENSEARCH

    def create(self, texts: list[Document], embeddings: list[list[float]], **kwargs):
        metadatas = [d.metadata for d in texts]
        self.create_collection(embeddings, metadatas)
        self.add_texts(texts, embeddings)

    def add_texts(self, documents: list[Document], embeddings: list[list[float]], **kwargs):
        actions = []
        for i in range(len(documents)):
            action = {
                "_op_type": "index",
                "_index": self._collection_name.lower(),
                "_id": uuid4().hex,
                "_source": {
                    Field.CONTENT_KEY.value: documents[i].page_content,
                    Field.VECTOR.value: embeddings[i],  # Make sure you pass an array here
                    Field.METADATA_KEY.value: documents[i].metadata,
                }
            }
            actions.append(action)

        helpers.bulk(self._client, actions)

    def get_ids_by_metadata_field(self, key: str, value: str):
        query = {"query": {"term": {f"{Field.METADATA_KEY.value}.{key}": value}}}
        response = self._client.search(index=self._collection_name.lower(), body=query)
        if response['hits']['hits']:
            return [hit['_id'] for hit in response['hits']['hits']]
        else:
            return None

    def delete_by_metadata_field(self, key: str, value: str):
        ids = self.get_ids_by_metadata_field(key, value)
        if ids:
            self.delete_by_ids(ids)

    def delete_by_ids(self, ids: list[str]) -> None:
        index_name = self._collection_name.lower()
        if not self._client.indices.exists(index=index_name):
            logger.warning(f"Index {index_name} does not exist")
            return

        # Obtaining All Actual Documents_ID
        actual_ids = []

        for doc_id in ids:
            es_ids = self.get_ids_by_metadata_field('doc_id', doc_id)
            if es_ids:
                actual_ids.extend(es_ids)
            else:
                logger.warning(f"Document with metadata doc_id {doc_id} not found for deletion")

        if actual_ids:
            actions = [{"_op_type": "delete", "_index": index_name, "_id": es_id} for es_id in actual_ids]
            try:
                helpers.bulk(self._client, actions)
            except BulkIndexError as e:
                for error in e.errors:
                    delete_error = error.get('delete', {})
                    status = delete_error.get('status')
                    doc_id = delete_error.get('_id')

                    if status == 404:
                        logger.warning(f"Document not found for deletion: {doc_id}")
                    else:
                        logger.error(f"Error deleting document: {error}")

    def delete(self) -> None:
        self._client.indices.delete(index=self._collection_name.lower())

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
            "size": kwargs.get('top_k', 4),
            "query": {
                "knn": {
                    Field.VECTOR.value: {
                        Field.VECTOR.value: query_vector,
                        "k": kwargs.get('top_k', 4)
                    }
                }
            }
        }

        try:
            response = self._client.search(index=self._collection_name.lower(), body=query)
        except Exception as e:
            logger.error(f"Error executing search: {e}")
            raise

        docs = []
        for hit in response['hits']['hits']:
            metadata = hit['_source'].get(Field.METADATA_KEY.value, {})

            # Make sure metadata is a dictionary
            if metadata is None:
                metadata = {}

            metadata['score'] = hit['_score']
            score_threshold = kwargs.get('score_threshold') if kwargs.get('score_threshold') else 0.0
            if hit['_score'] > score_threshold:
                doc = Document(page_content=hit['_source'].get(Field.CONTENT_KEY.value), metadata=metadata)
                docs.append(doc)

        return docs

    def search_by_full_text(self, query: str, **kwargs: Any) -> list[Document]:
        full_text_query = {"query": {"match": {Field.CONTENT_KEY.value: query}}}

        response = self._client.search(index=self._collection_name.lower(), body=full_text_query)

        docs = []
        for hit in response['hits']['hits']:
            metadata = hit['_source'].get(Field.METADATA_KEY.value)
            vector = hit['_source'].get(Field.VECTOR.value)
            page_content = hit['_source'].get(Field.CONTENT_KEY.value)
            doc = Document(page_content=page_content, vector=vector, metadata=metadata)
            docs.append(doc)

        return docs

    def create_collection(
            self, embeddings: list, metadatas: Optional[list[dict]] = None, index_params: Optional[dict] = None
    ):
        lock_name = f'vector_indexing_lock_{self._collection_name.lower()}'
        with redis_client.lock(lock_name, timeout=20):
            collection_exist_cache_key = f'vector_indexing_{self._collection_name.lower()}'
            if redis_client.get(collection_exist_cache_key):
                logger.info(f"Collection {self._collection_name.lower()} already exists.")
                return

            if not self._client.indices.exists(index=self._collection_name.lower()):
                index_body = {
                    "settings": {
                        "index": {
                            "knn": True
                        }
                    },
                    "mappings": {
                        "properties": {
                            Field.CONTENT_KEY.value: {"type": "text"},
                            Field.VECTOR.value: {
                                "type": "knn_vector",
                                "dimension": len(embeddings[0]),  # Make sure the dimension is correct here
                                "method": {
                                    "name": "hnsw",
                                    "space_type": "l2",
                                    "engine": "faiss",
                                    "parameters": {
                                        "ef_construction": 64,
                                        "m": 8
                                    }
                                }
                            },
                            Field.METADATA_KEY.value: {
                                "type": "object",
                                "properties": {
                                    "doc_id": {"type": "keyword"}  # Map doc_id to keyword type
                                }
                            }
                        }
                    }
                }

                self._client.indices.create(index=self._collection_name.lower(), body=index_body)

            redis_client.set(collection_exist_cache_key, 1, ex=3600)


class OpenSearchVectorFactory(AbstractVectorFactory):

    def init_vector(self, dataset: Dataset, attributes: list, embeddings: Embeddings) -> OpenSearchVector:
        if dataset.index_struct_dict:
            class_prefix: str = dataset.index_struct_dict['vector_store']['class_prefix']
            collection_name = class_prefix.lower()
        else:
            dataset_id = dataset.id
            collection_name = Dataset.gen_collection_name_by_id(dataset_id).lower()
            dataset.index_struct = json.dumps(
                self.gen_index_struct_dict(VectorType.OPENSEARCH, collection_name))


        open_search_config = OpenSearchConfig(
            host=dify_config.OPENSEARCH_HOST,
            port=dify_config.OPENSEARCH_PORT,
            user=dify_config.OPENSEARCH_USER,
            password=dify_config.OPENSEARCH_PASSWORD,
            secure=dify_config.OPENSEARCH_SECURE,
        )

        return OpenSearchVector(
            collection_name=collection_name,
            config=open_search_config
        )
