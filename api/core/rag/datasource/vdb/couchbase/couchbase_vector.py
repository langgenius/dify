import json
import logging
import time
import uuid
from datetime import timedelta
from typing import Any

from couchbase import search  # type: ignore
from couchbase.auth import PasswordAuthenticator  # type: ignore
from couchbase.cluster import Cluster  # type: ignore
from couchbase.management.search import SearchIndex  # type: ignore

# needed for options -- cluster, timeout, SQL++ (N1QL) query, etc.
from couchbase.options import ClusterOptions, SearchOptions  # type: ignore
from couchbase.vector_search import VectorQuery, VectorSearch  # type: ignore
from flask import current_app
from pydantic import BaseModel, model_validator

from core.rag.datasource.vdb.vector_base import BaseVector
from core.rag.datasource.vdb.vector_factory import AbstractVectorFactory
from core.rag.datasource.vdb.vector_type import VectorType
from core.rag.embedding.embedding_base import Embeddings
from core.rag.models.document import Document
from extensions.ext_redis import redis_client
from models.dataset import Dataset

logger = logging.getLogger(__name__)


class CouchbaseConfig(BaseModel):
    connection_string: str
    user: str
    password: str
    bucket_name: str
    scope_name: str

    @model_validator(mode="before")
    @classmethod
    def validate_config(cls, values: dict):
        if not values.get("connection_string"):
            raise ValueError("config COUCHBASE_CONNECTION_STRING is required")
        if not values.get("user"):
            raise ValueError("config COUCHBASE_USER is required")
        if not values.get("password"):
            raise ValueError("config COUCHBASE_PASSWORD is required")
        if not values.get("bucket_name"):
            raise ValueError("config COUCHBASE_PASSWORD is required")
        if not values.get("scope_name"):
            raise ValueError("config COUCHBASE_SCOPE_NAME is required")
        return values


class CouchbaseVector(BaseVector):
    def __init__(self, collection_name: str, config: CouchbaseConfig):
        super().__init__(collection_name)
        self._client_config = config

        """Connect to couchbase"""

        auth = PasswordAuthenticator(config.user, config.password)
        options = ClusterOptions(auth)
        self._cluster = Cluster(config.connection_string, options)
        self._bucket = self._cluster.bucket(config.bucket_name)
        self._scope = self._bucket.scope(config.scope_name)
        self._bucket_name = config.bucket_name
        self._scope_name = config.scope_name

        # Wait until the cluster is ready for use.
        self._cluster.wait_until_ready(timedelta(seconds=5))

    def create(self, texts: list[Document], embeddings: list[list[float]], **kwargs):
        index_id = str(uuid.uuid4()).replace("-", "")
        self._create_collection(uuid=index_id, vector_length=len(embeddings[0]))
        self.add_texts(texts, embeddings)

    def _create_collection(self, vector_length: int, uuid: str):
        lock_name = f"vector_indexing_lock_{self._collection_name}"
        with redis_client.lock(lock_name, timeout=20):
            collection_exist_cache_key = f"vector_indexing_{self._collection_name}"
            if redis_client.get(collection_exist_cache_key):
                return
            if self._collection_exists(self._collection_name):
                return
            manager = self._bucket.collections()
            manager.create_collection(self._client_config.scope_name, self._collection_name)

            index_manager = self._scope.search_indexes()

            index_definition = json.loads("""
{
    "type": "fulltext-index",
    "name": "Embeddings._default.Vector_Search",
    "uuid": "26d4db528e78b716",
    "sourceType": "gocbcore",
    "sourceName": "Embeddings",
    "sourceUUID": "2242e4a25b4decd6650c9c7b3afa1dbf",
    "planParams": {
      "maxPartitionsPerPIndex": 1024,
      "indexPartitions": 1
    },
    "params": {
      "doc_config": {
        "docid_prefix_delim": "",
        "docid_regexp": "",
        "mode": "scope.collection.type_field",
        "type_field": "type"
      },
      "mapping": {
        "analysis": { },
        "default_analyzer": "standard",
        "default_datetime_parser": "dateTimeOptional",
        "default_field": "_all",
        "default_mapping": {
          "dynamic": true,
          "enabled": true
        },
        "default_type": "_default",
        "docvalues_dynamic": false,
        "index_dynamic": true,
        "store_dynamic": true,
        "type_field": "_type",
        "types": {
          "collection_name": {
            "dynamic": true,
            "enabled": true,
            "properties": {
              "embedding": {
                "dynamic": false,
                "enabled": true,
                "fields": [
                  {
                    "dims": 1536,
                    "index": true,
                    "name": "embedding",
                    "similarity": "dot_product",
                    "type": "vector",
                    "vector_index_optimized_for": "recall"
                  }
                ]
              },
              "metadata": {
                "dynamic": true,
                "enabled": true
              },
              "text": {
                "dynamic": false,
                "enabled": true,
                "fields": [
                  {
                    "index": true,
                    "name": "text",
                    "store": true,
                    "type": "text"
                  }
                ]
              }
            }
          }
        }
      },
      "store": {
        "indexType": "scorch",
        "segmentVersion": 16
      }
    },
    "sourceParams": { }
  }
""")
            index_definition["name"] = self._collection_name + "_search"
            index_definition["uuid"] = uuid
            index_definition["params"]["mapping"]["types"]["collection_name"]["properties"]["embedding"]["fields"][0][
                "dims"
            ] = vector_length
            index_definition["params"]["mapping"]["types"][self._scope_name + "." + self._collection_name] = (
                index_definition["params"]["mapping"]["types"].pop("collection_name")
            )
            time.sleep(2)
            index_manager.upsert_index(
                SearchIndex(
                    index_definition["name"],
                    params=index_definition["params"],
                    source_name=self._bucket_name,
                ),
            )
            time.sleep(1)

            redis_client.set(collection_exist_cache_key, 1, ex=3600)

    def _collection_exists(self, name: str):
        scope_collection_map: dict[str, Any] = {}

        # Get a list of all scopes in the bucket
        for scope in self._bucket.collections().get_all_scopes():
            scope_collection_map[scope.name] = []

            # Get a list of all the collections in the scope
            for collection in scope.collections:
                scope_collection_map[scope.name].append(collection.name)

        # Check if the collection exists in the scope
        return self._collection_name in scope_collection_map[self._scope_name]

    def get_type(self) -> str:
        return VectorType.COUCHBASE

    def add_texts(self, documents: list[Document], embeddings: list[list[float]], **kwargs):
        uuids = self._get_uuids(documents)
        texts = [d.page_content for d in documents]
        metadatas = [d.metadata for d in documents]

        doc_ids = []

        documents_to_insert = [
            {"text": text, "embedding": vector, "metadata": metadata}
            for _, text, vector, metadata in zip(uuids, texts, embeddings, metadatas)
        ]
        for doc, id in zip(documents_to_insert, uuids):
            _ = self._scope.collection(self._collection_name).upsert(id, doc)

        doc_ids.extend(uuids)

        return doc_ids

    def text_exists(self, id: str) -> bool:
        # Use a parameterized query for safety and correctness
        query = f"""
                SELECT COUNT(1) AS count FROM
                `{self._client_config.bucket_name}`.{self._client_config.scope_name}.{self._collection_name}
                WHERE META().id = $doc_id
                """
        # Pass the id as a parameter to the query
        result = self._cluster.query(query, named_parameters={"doc_id": id}).execute()
        for row in result:
            return bool(row["count"] > 0)
        return False  # Return False if no rows are returned

    def delete_by_ids(self, ids: list[str]):
        query = f"""
            DELETE FROM `{self._bucket_name}`.{self._client_config.scope_name}.{self._collection_name}
            WHERE META().id IN $doc_ids;
            """
        try:
            self._cluster.query(query, named_parameters={"doc_ids": ids}).execute()
        except Exception:
            logger.exception("Failed to delete documents, ids: %s", ids)

    def delete_by_document_id(self, document_id: str):
        query = f"""
                DELETE FROM
                `{self._client_config.bucket_name}`.{self._client_config.scope_name}.{self._collection_name}
                WHERE META().id = $doc_id;
                """
        self._cluster.query(query, named_parameters={"doc_id": document_id}).execute()

    # def get_ids_by_metadata_field(self, key: str, value: str):
    #     query = f"""
    #         SELECT id FROM
    #         `{self._client_config.bucket_name}`.{self._client_config.scope_name}.{self._collection_name}
    #         WHERE `metadata.{key}` = $value;
    #         """
    #     result = self._cluster.query(query, named_parameters={'value':value})
    #     return [row['id'] for row in result.rows()]

    def delete_by_metadata_field(self, key: str, value: str):
        query = f"""
            DELETE FROM `{self._client_config.bucket_name}`.{self._client_config.scope_name}.{self._collection_name}
            WHERE metadata.{key} = $value;
            """
        self._cluster.query(query, named_parameters={"value": value}).execute()

    def search_by_vector(self, query_vector: list[float], **kwargs: Any) -> list[Document]:
        top_k = kwargs.get("top_k", 5)
        score_threshold = kwargs.get("score_threshold") or 0.0

        search_req = search.SearchRequest.create(
            VectorSearch.from_vector_query(
                VectorQuery(
                    "embedding",
                    query_vector,
                    top_k,
                )
            )
        )
        try:
            search_iter = self._scope.search(
                self._collection_name + "_search",
                search_req,
                SearchOptions(limit=top_k, collections=[self._collection_name], fields=["*"]),
            )

            docs = []
            # Parse the results
            for row in search_iter.rows():
                text = row.fields.pop("text")
                metadata = self._format_metadata(row.fields)
                score = row.score
                metadata["score"] = score
                doc = Document(page_content=text, metadata=metadata)
                if score >= score_threshold:
                    docs.append(doc)
        except Exception as e:
            raise ValueError(f"Search failed with error: {e}")

        return docs

    def search_by_full_text(self, query: str, **kwargs: Any) -> list[Document]:
        top_k = kwargs.get("top_k", 4)
        try:
            CBrequest = search.SearchRequest.create(search.QueryStringQuery("text:" + query))  # ty: ignore [too-many-positional-arguments]
            search_iter = self._scope.search(
                self._collection_name + "_search", CBrequest, SearchOptions(limit=top_k, fields=["*"])
            )

            docs = []
            for row in search_iter.rows():
                text = row.fields.pop("text")
                metadata = self._format_metadata(row.fields)
                score = row.score
                metadata["score"] = score
                doc = Document(page_content=text, metadata=metadata)
                docs.append(doc)

        except Exception as e:
            raise ValueError(f"Search failed with error: {e}")

        return docs

    def delete(self):
        manager = self._bucket.collections()
        scopes = manager.get_all_scopes()

        for scope in scopes:
            for collection in scope.collections:
                if collection.name == self._collection_name:
                    manager.drop_collection("_default", self._collection_name)

    def _format_metadata(self, row_fields: dict[str, Any]) -> dict[str, Any]:
        """Helper method to format the metadata from the Couchbase Search API.
        Args:
            row_fields (Dict[str, Any]): The fields to format.

        Returns:
            Dict[str, Any]: The formatted metadata.
        """
        metadata = {}
        for key, value in row_fields.items():
            # Couchbase Search returns the metadata key with a prefix
            # `metadata.` We remove it to get the original metadata key
            if key.startswith("metadata"):
                new_key = key.split("metadata" + ".")[-1]
                metadata[new_key] = value
            else:
                metadata[key] = value

        return metadata


class CouchbaseVectorFactory(AbstractVectorFactory):
    def init_vector(self, dataset: Dataset, attributes: list, embeddings: Embeddings) -> CouchbaseVector:
        if dataset.index_struct_dict:
            class_prefix: str = dataset.index_struct_dict["vector_store"]["class_prefix"]
            collection_name = class_prefix
        else:
            dataset_id = dataset.id
            collection_name = Dataset.gen_collection_name_by_id(dataset_id)
            dataset.index_struct = json.dumps(self.gen_index_struct_dict(VectorType.COUCHBASE, collection_name))

        config = current_app.config
        return CouchbaseVector(
            collection_name=collection_name,
            config=CouchbaseConfig(
                connection_string=config.get("COUCHBASE_CONNECTION_STRING", ""),
                user=config.get("COUCHBASE_USER", ""),
                password=config.get("COUCHBASE_PASSWORD", ""),
                bucket_name=config.get("COUCHBASE_BUCKET_NAME", ""),
                scope_name=config.get("COUCHBASE_SCOPE_NAME", ""),
            ),
        )
