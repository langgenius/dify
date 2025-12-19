import json
import logging
import time
from typing import Any

from opensearchpy import OpenSearch, helpers
from opensearchpy.helpers import BulkIndexError
from pydantic import BaseModel, model_validator
from tenacity import retry, stop_after_attempt, wait_exponential

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
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logging.getLogger("lindorm").setLevel(logging.WARN)

ROUTING_FIELD = "routing_field"
UGC_INDEX_PREFIX = "ugc_index"


class LindormVectorStoreConfig(BaseModel):
    hosts: str | None
    username: str | None = None
    password: str | None = None
    using_ugc: bool | None = False
    request_timeout: float | None = 1.0  # timeout units: s

    @model_validator(mode="before")
    @classmethod
    def validate_config(cls, values: dict):
        if not values["hosts"]:
            raise ValueError("config URL is required")
        if not values["username"]:
            raise ValueError("config USERNAME is required")
        if not values["password"]:
            raise ValueError("config PASSWORD is required")
        return values

    def to_opensearch_params(self) -> dict[str, Any]:
        params: dict[str, Any] = {
            "hosts": self.hosts,
            "use_ssl": False,
            "pool_maxsize": 128,
            "timeout": 30,
        }
        if self.username and self.password:
            params["http_auth"] = (self.username, self.password)
        return params


class LindormVectorStore(BaseVector):
    def __init__(self, collection_name: str, config: LindormVectorStoreConfig, using_ugc: bool, **kwargs):
        self._routing: str | None = None
        if using_ugc:
            routing_value: str | None = kwargs.get("routing_value")
            if routing_value is None:
                raise ValueError("UGC index should init vector with valid 'routing_value' parameter value")
            self._routing = routing_value.lower()
        super().__init__(collection_name.lower())
        self._client_config = config
        self._client = OpenSearch(**config.to_opensearch_params())
        self._using_ugc = using_ugc
        self.kwargs = kwargs

    def get_type(self) -> str:
        return VectorType.LINDORM

    def create(self, texts: list[Document], embeddings: list[list[float]], **kwargs):
        metadatas = [d.metadata if d.metadata is not None else {} for d in texts]
        self.create_collection(embeddings, metadatas)
        self.add_texts(texts, embeddings)

    def refresh(self):
        self._client.indices.refresh(index=self._collection_name)

    def add_texts(
        self,
        documents: list[Document],
        embeddings: list[list[float]],
        batch_size: int = 64,
        timeout: int = 60,
        **kwargs,
    ):
        logger.info("Total documents to add: %s", len(documents))
        uuids = self._get_uuids(documents)

        total_docs = len(documents)
        num_batches = (total_docs + batch_size - 1) // batch_size

        @retry(
            stop=stop_after_attempt(3),
            wait=wait_exponential(multiplier=1, min=4, max=10),
        )
        def _bulk_with_retry(actions):
            try:
                response = self._client.bulk(actions, timeout=timeout)
                if response["errors"]:
                    error_items = [item for item in response["items"] if "error" in item["index"]]
                    error_msg = f"Bulk indexing had {len(error_items)} errors"
                    logger.exception(error_msg)
                    raise Exception(error_msg)
                return response
            except Exception:
                logger.exception("Bulk indexing error")
                raise

        for batch_num in range(num_batches):
            start_idx = batch_num * batch_size
            end_idx = min((batch_num + 1) * batch_size, total_docs)

            actions = []
            for i in range(start_idx, end_idx):
                action_header = {
                    "index": {
                        "_index": self.collection_name,
                        "_id": uuids[i],
                    }
                }
                action_values: dict[str, Any] = {
                    Field.CONTENT_KEY: documents[i].page_content,
                    Field.VECTOR: embeddings[i],
                    Field.METADATA_KEY: documents[i].metadata,
                }
                if self._using_ugc:
                    action_header["index"]["routing"] = self._routing
                    action_values[ROUTING_FIELD] = self._routing

                actions.append(action_header)
                actions.append(action_values)

            try:
                _bulk_with_retry(actions)
                # logger.info(f"Successfully processed batch {batch_num + 1}")
                # simple latency to avoid too many requests in a short time
                if batch_num < num_batches - 1:
                    time.sleep(0.5)

            except Exception:
                logger.exception("Failed to process batch %s", batch_num + 1)
                raise

    def get_ids_by_metadata_field(self, key: str, value: str):
        query: dict[str, Any] = {
            "query": {"bool": {"must": [{"term": {f"{Field.METADATA_KEY}.{key}.keyword": value}}]}}
        }
        if self._using_ugc:
            query["query"]["bool"]["must"].append({"term": {f"{ROUTING_FIELD}.keyword": self._routing}})
        response = self._client.search(index=self._collection_name, body=query)
        if response["hits"]["hits"]:
            return [hit["_id"] for hit in response["hits"]["hits"]]
        else:
            return None

    def delete_by_metadata_field(self, key: str, value: str):
        ids = self.get_ids_by_metadata_field(key, value)
        if ids:
            self.delete_by_ids(ids)

    def delete_by_ids(self, ids: list[str]):
        """Delete documents by their IDs in batch.

        Args:
            ids: List of document IDs to delete
        """
        if not ids:
            return

        params = {"routing": self._routing} if self._using_ugc else {}

        # 1. First check if collection exists
        if not self._client.indices.exists(index=self._collection_name):
            logger.warning("Collection %s does not exist", self._collection_name)
            return

        # 2. Batch process deletions
        actions = []
        for id in ids:
            if self._client.exists(index=self._collection_name, id=id, params=params):
                actions.append(
                    {
                        "_op_type": "delete",
                        "_index": self._collection_name,
                        "_id": id,
                        **params,  # Include routing if using UGC
                    }
                )
            else:
                logger.warning("DELETE BY ID: ID %s does not exist in the index.", id)

        # 3. Perform bulk deletion if there are valid documents to delete
        if actions:
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
        if self._using_ugc:
            routing_filter_query = {
                "query": {"bool": {"must": [{"term": {f"{ROUTING_FIELD}.keyword": self._routing}}]}}
            }
            self._client.delete_by_query(self._collection_name, body=routing_filter_query)
            self.refresh()
        else:
            if self._client.indices.exists(index=self._collection_name):
                self._client.indices.delete(index=self._collection_name, params={"timeout": 60})
                logger.info("Delete index success")
            else:
                logger.warning("Index '%s' does not exist. No deletion performed.", self._collection_name)

    def text_exists(self, id: str) -> bool:
        try:
            params: dict[str, Any] = {}
            if self._using_ugc:
                params["routing"] = self._routing
            self._client.get(index=self._collection_name, id=id, params=params)
            return True
        except:
            return False

    def search_by_vector(self, query_vector: list[float], **kwargs: Any) -> list[Document]:
        if not isinstance(query_vector, list):
            raise ValueError("query_vector should be a list of floats")

        if not all(isinstance(x, float) for x in query_vector):
            raise ValueError("All elements in query_vector should be floats")

        filters = []
        document_ids_filter = kwargs.get("document_ids_filter")
        if document_ids_filter:
            filters.append({"terms": {"metadata.document_id.keyword": document_ids_filter}})
        if self._using_ugc:
            filters.append({"term": {f"{ROUTING_FIELD}.keyword": self._routing}})

        top_k = kwargs.get("top_k", 5)
        search_query: dict[str, Any] = {
            "size": top_k,
            "_source": True,
            "query": {"knn": {Field.VECTOR: {"vector": query_vector, "k": top_k}}},
        }

        final_ext: dict[str, Any] = {"lvector": {}}
        if filters is not None and len(filters) > 0:
            # when using filter, transform filter from List[Dict] to Dict as valid format
            filter_dict = {"bool": {"must": filters}} if len(filters) > 1 else filters[0]
            search_query["query"]["knn"][Field.VECTOR]["filter"] = filter_dict  # filter should be Dict
            final_ext["lvector"]["filter_type"] = "pre_filter"

        if final_ext != {"lvector": {}}:
            search_query["ext"] = final_ext

        try:
            params = {"timeout": self._client_config.request_timeout}
            if self._using_ugc:
                params["routing"] = self._routing  # type: ignore
            response = self._client.search(index=self._collection_name, body=search_query, params=params)
        except Exception:
            logger.exception("Error executing vector search, query: %s", search_query)
            raise

        docs_and_scores = []
        for hit in response["hits"]["hits"]:
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
            score_threshold = kwargs.get("score_threshold", 0.0) or 0.0
            if score >= score_threshold:
                if doc.metadata is not None:
                    doc.metadata["score"] = score
                docs.append(doc)

        return docs

    def search_by_full_text(self, query: str, **kwargs: Any) -> list[Document]:
        full_text_query = {"query": {"bool": {"must": [{"match": {Field.CONTENT_KEY.value: query}}]}}}
        filters = []
        document_ids_filter = kwargs.get("document_ids_filter")
        if document_ids_filter:
            filters.append({"terms": {"metadata.document_id.keyword": document_ids_filter}})
        if self._using_ugc:
            filters.append({"term": {f"{ROUTING_FIELD}.keyword": self._routing}})
        if filters:
            full_text_query["query"]["bool"]["filter"] = filters

        try:
            params: dict[str, Any] = {"timeout": self._client_config.request_timeout}
            if self._using_ugc:
                params["routing"] = self._routing
            response = self._client.search(index=self._collection_name, body=full_text_query, params=params)
        except Exception:
            logger.exception("Error executing vector search, query: %s", full_text_query)
            raise

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
        if not embeddings:
            raise ValueError(f"Embeddings list cannot be empty for collection create '{self._collection_name}'")
        lock_name = f"vector_indexing_lock_{self._collection_name}"
        with redis_client.lock(lock_name, timeout=20):
            collection_exist_cache_key = f"vector_indexing_{self._collection_name}"
            if redis_client.get(collection_exist_cache_key):
                logger.info("Collection %s already exists.", self._collection_name)
                return
            if not self._client.indices.exists(index=self._collection_name):
                index_body = {
                    "settings": {"index": {"knn": True, "knn_routing": self._using_ugc}},
                    "mappings": {
                        "properties": {
                            Field.CONTENT_KEY: {"type": "text"},
                            Field.VECTOR: {
                                "type": "knn_vector",
                                "dimension": len(embeddings[0]),  # Make sure the dimension is correct here
                                "method": {
                                    "name": index_params.get("index_type", "hnsw")
                                    if index_params
                                    else dify_config.LINDORM_INDEX_TYPE,
                                    "space_type": index_params.get("space_type", "l2")
                                    if index_params
                                    else dify_config.LINDORM_DISTANCE_TYPE,
                                    "engine": "lvector",
                                },
                            },
                        }
                    },
                }
                logger.info("Creating Lindorm Search index %s", self._collection_name)
                self._client.indices.create(index=self._collection_name, body=index_body)
            redis_client.set(collection_exist_cache_key, 1, ex=3600)


class LindormVectorStoreFactory(AbstractVectorFactory):
    def init_vector(self, dataset: Dataset, attributes: list, embeddings: Embeddings) -> LindormVectorStore:
        lindorm_config = LindormVectorStoreConfig(
            hosts=dify_config.LINDORM_URL,
            username=dify_config.LINDORM_USERNAME,
            password=dify_config.LINDORM_PASSWORD,
            using_ugc=dify_config.LINDORM_USING_UGC,
            request_timeout=dify_config.LINDORM_QUERY_TIMEOUT,
        )
        using_ugc = dify_config.LINDORM_USING_UGC
        if using_ugc is None:
            raise ValueError("LINDORM_USING_UGC is not set")
        routing_value = None
        if dataset.index_struct:
            # if an existed record's index_struct_dict doesn't contain using_ugc field,
            # it actually stores in the normal index format
            stored_in_ugc: bool = dataset.index_struct_dict.get("using_ugc", False)
            using_ugc = stored_in_ugc
            if stored_in_ugc:
                dimension = dataset.index_struct_dict["dimension"]
                index_type = dataset.index_struct_dict["index_type"]
                distance_type = dataset.index_struct_dict["distance_type"]
                routing_value = dataset.index_struct_dict["vector_store"]["class_prefix"]
                index_name = f"{UGC_INDEX_PREFIX}_{dimension}_{index_type}_{distance_type}".lower()
            else:
                index_name = dataset.index_struct_dict["vector_store"]["class_prefix"].lower()
        else:
            embedding_vector = embeddings.embed_query("hello word")
            dimension = len(embedding_vector)
            class_prefix = Dataset.gen_collection_name_by_id(dataset.id)
            index_struct_dict = {
                "type": VectorType.LINDORM,
                "vector_store": {"class_prefix": class_prefix},
                "index_type": dify_config.LINDORM_INDEX_TYPE,
                "dimension": dimension,
                "distance_type": dify_config.LINDORM_DISTANCE_TYPE,
                "using_ugc": using_ugc,
            }
            dataset.index_struct = json.dumps(index_struct_dict)
            if using_ugc:
                index_type = dify_config.LINDORM_INDEX_TYPE
                distance_type = dify_config.LINDORM_DISTANCE_TYPE
                index_name = f"{UGC_INDEX_PREFIX}_{dimension}_{index_type}_{distance_type}".lower()
                routing_value = class_prefix.lower()
            else:
                index_name = class_prefix.lower()
        return LindormVectorStore(index_name, lindorm_config, routing_value=routing_value, using_ugc=using_ugc)
