import json
import ssl

from typing import Any, Optional, Tuple, Set
from uuid import uuid4
import time
from opensearchpy import OpenSearch, helpers
from opensearchpy.helpers import BulkIndexError
from pydantic import BaseModel, model_validator

from core.rag.datasource.vdb.field import Field
from core.rag.datasource.entity.embedding import Embeddings
from core.rag.datasource.vdb.vector_base import BaseVector
from core.rag.datasource.vdb.vector_factory import AbstractVectorFactory
from core.rag.datasource.vdb.vector_type import VectorType
from core.rag.models.document import Document

from configs import dify_config

from extensions.ext_redis import redis_client
from models.dataset import Dataset

from utils import *

logger = logging.getLogger(__name__)


class LindormVectorStoreConfig(BaseModel):
    host: str
    port: int
    user: Optional[str] = None
    password: Optional[str] = None
    secure: bool = False

    @model_validator(mode="before")
    @classmethod
    def validate_config(cls, values: dict) -> dict:
        if not values["host"]:
            raise ValueError("config HOST is required")
        if not values["port"]:
            raise ValueError("config PORT is required")
        if not values["username"]:
            raise ValueError("config USERNAME is required")
        if not values["password"]:
            raise ValueError("config PASSWORD is required")
        return values

    def create_ssl_context(self) -> ssl.SSLContext:
        ssl_context = ssl.create_default_context()
        ssl_context.check_hostname = False
        ssl_context.verify_mode = ssl.CERT_NONE  # Disable Certificate Validation
        return ssl_context

    def to_opensearch_params(self) -> dict[str, Any]:
        params = {
            "hosts": [{"host": self.host, "port": self.port}],
            "use_ssl": self.secure,
            "verify_certs": self.secure,
        }
        if self.user and self.password:
            params["http_auth"] = (self.user, self.password)
        if self.secure:
            params["ssl_context"] = self.create_ssl_context()
        return params


class LindormVectorStore(BaseVector):
    def __init__(self, collection_name: str, config: LindormVectorStoreConfig, **kwargs):
        super().__init__(collection_name)
        self._client_config = config
        self._client = OpenSearch(**config.to_opensearch_params())
        if kwargs.get("routing_field") is not None:
            self._is_route_index = True
        else:
            self._is_route_index = False
        self._ivfpq_trained = True
        self.kwargs = kwargs

    def get_type(self) -> str:
        return "Lindorm.VectorStore"

    def create(self, texts: list[Document], embeddings: list[list[float]], **kwargs):
        self.create_collection(embeddings)
        self.add_texts(texts, embeddings)

    def refresh(self):
        self._client.indices.refresh(index=self._collection_name)

    def __filter_existed_ids(self,
                             texts: list[str],
                             metadatas: list[dict],
                             ids: list[str],
                             bulk_size: int = 1024,
                             ) -> Tuple[Iterable[str], Optional[List[dict]], Optional[List[str]]]:
        @retry(stop=stop_after_attempt(3), wait=wait_fixed(60))
        def __fetch_existing_ids(batch_ids: List[str]) -> Set[str]:
            try:
                existing_docs = self._client.mget(
                    index=self.collection_name.lower(),
                    body={"ids": batch_ids},
                    _source=False
                )
                return {doc['_id'] for doc in existing_docs['docs'] if doc['found']}
            except Exception as e:
                logger.error(f"Error fetching batch {batch_ids}: {e}")
                return Set

        @retry(stop=stop_after_attempt(3), wait=wait_fixed(60))
        def __fetch_existing_routing_ids(batch_ids: List[str], route_ids: List[str]) -> Set[str]:
            try:
                existing_docs = self._client.mget(
                    body={"docs": [
                        {
                            "_index": self.collection_name.lower(),
                            "_id": id,
                            "routing": routing
                        } for id, routing in zip(batch_ids, route_ids)
                    ]},
                    _source=False
                )
                return {doc['_id'] for doc in existing_docs['docs'] if doc['found']}
            except Exception as e:
                logger.error(f"Error fetching batch {batch_ids}: {e}")
                return Set

        if ids is None:
            return texts, metadatas, ids

        if len(texts) != len(ids):
            raise RuntimeError(f"texts {len(texts)} != {ids}")

        if self._is_route_index and metadatas is None:
            raise RuntimeError(f"route_index need metadatas's routing field, but metadatas is None")

        filtered_texts = []
        filtered_metadatas = []
        filtered_ids = []

        def batch(iterable, n):
            l = len(iterable)
            for idx in range(0, l, n):
                yield iterable[idx:min(idx + n, l)]

        for ids_batch, texts_batch, metadatas_batch in zip(batch(ids, bulk_size), batch(texts, bulk_size),
                                                           batch(metadatas,
                                                                 bulk_size) if metadatas is not None else batch(
                                                               [None] * len(ids), bulk_size)):
            if self._is_route_index:
                routing = self.kwargs.get("routing_field")
                existing_ids_set = __fetch_existing_routing_ids(ids_batch, [meta[routing] for meta in metadatas_batch])
            else:
                existing_ids_set = __fetch_existing_ids(ids_batch)

            for text, metadata, doc_id in zip(texts_batch, metadatas_batch, ids_batch):
                if doc_id not in existing_ids_set:
                    filtered_texts.append(text)
                    filtered_ids.append(doc_id)
                    if metadatas is not None:
                        filtered_metadatas.append(metadata)

        return filtered_texts, metadatas if metadatas is None else filtered_metadatas, filtered_ids

    def add_texts(self, documents: list[Document], embeddings: list[list[float]], **kwargs):
        bulk_size = kwargs.get("bulk_size", 500)
        texts = [d.page_content for d in documents]
        metadatas = [d.metadata for d in documents]
        ids = [d.metadata["doc_id"] for d in documents]
        if not self._ivfpq_trained:
            self.train_ivfpq_index_with_routing(texts=texts,
                                                metadatas=metadatas,
                                                ids=ids,
                                                bulk_size=bulk_size,
                                                **kwargs)
        self.__add_texts(texts=texts, embeddings=embeddings, ids=ids, bulk_size=bulk_size, **kwargs)

    def __add_texts(self,
                    texts: Iterable[str],
                    embeddings: List[List[float]],
                    ids: Optional[List[str]] = None,
                    metadatas: Optional[List[dict]] = None,
                    max_chunk_bytes: Optional[int] = 10 * 1024 * 1024,
                    routing_field: Optional[str] = None,
                    **kwargs,
                    ) -> List[str]:
        total_items = len(texts)
        if total_items == 0:
            logger.warning("Texts size is zero!")
            return []

        if not self.kwargs.get("overwrite", False):
            texts, metadatas, ids = self.__filter_existed_ids(texts, metadatas, ids)
            logger.info(f"after _id filter, texts num change from {total_items} => {len(texts)}")

            if len(texts) == 0:
                logger.info("All texts existed, Finish")
                return ids

        requests = []
        return_ids = []
        for i, text in enumerate(texts):
            metadata = metadatas[i] if metadatas else {}
            _id = ids[i] if ids else str(uuid.uuid4())
            request = {
                "_op_type": "index",
                "_index": self.collection_name.lower(),
                "_id": _id,
                Field.VECTOR.value: embeddings[i],
                Field.CONTENT_KEY.value: text,
                "metadata": metadata,
            }
            if routing_field:
                # Get routing from metadata if it exists
                routing = metadata.get(routing_field, None)
                if not routing:
                    raise RuntimeError(f"routing field [{routing_field}] no found in metadata [{metadata}]")
                else:
                    request["routing"] = routing
            requests.append(request)
            return_ids.append(_id)

        @retry(stop=stop_after_attempt(3), wait=wait_fixed(60))
        def bulk_with_retry(client: Any, requests: List[dict], max_chunk_bytes: int):
            bulk(client, requests, max_chunk_bytes=max_chunk_bytes)

        try:
            bulk_with_retry(self._client, requests, max_chunk_bytes)
            self.refresh()
        except Exception as e:
            logger.error(f"RetryError in bulking:{e.last_attempt.exception()}")
        return return_ids

    def check_allow_inherit(self, parent_index: str, mapping: Dict):
        response = self._client.transport.perform_request(method="GET", url=f"/{parent_index}/_mapping?pretty")
        new_vector_field = mapping["mappings"]["properties"]["vector_field"]
        parent_vector_field = response[parent_index]["mappings"]["properties"]["vector_field"]
        if new_vector_field["type"] != parent_vector_field["type"]:
            raise RuntimeError(f"vector type {new_vector_field['type']} != {parent_vector_field['type']}")
        elif new_vector_field['dimension'] != parent_vector_field['dimension']:
            raise RuntimeError(f"dimension {new_vector_field['dimension']} != {parent_vector_field['dimension']}")
        elif new_vector_field["method"]["name"] != parent_vector_field["method"]["name"]:
            raise RuntimeError(
                f"method_name {new_vector_field['method']['name']} != {parent_vector_field['method']['name']}")
        elif new_vector_field['method']['space_type'] != parent_vector_field['method']['space_type']:
            raise RuntimeError(
                f"space_type {new_vector_field['method']['space_type']} != {parent_vector_field['method']['space_type']}")

        new_vector_parameters = new_vector_field["method"]["parameters"]
        parent_vector_parameters = parent_vector_field["method"]["parameters"]
        if new_vector_parameters["nlist"] != parent_vector_parameters["nlist"]:
            raise RuntimeError(f"nlist {new_vector_parameters['nlist']} != {parent_vector_parameters['nlist']}")
        elif new_vector_parameters["centroids_use_hnsw"] != parent_vector_parameters["centroids_use_hnsw"]:
            raise RuntimeError(
                f"nlist {new_vector_parameters['centroids_use_hnsw']} != {parent_vector_parameters['centroids_use_hnsw']}")
        elif new_vector_parameters["m"] != parent_vector_parameters["m"]:
            raise RuntimeError(f"nlist {new_vector_parameters['m']} != {parent_vector_parameters['m']}")
        elif new_vector_parameters["centroids_use_hnsw"]:
            if new_vector_parameters["centroids_hnsw_ef_construct"] != parent_vector_parameters[
                "centroids_hnsw_ef_construct"]:
                raise RuntimeError(
                    f"nlist {new_vector_parameters['centroids_hnsw_ef_construct']} != {parent_vector_parameters['centroids_hnsw_ef_construct']}")
            elif new_vector_parameters["centroids_hnsw_m"] != parent_vector_parameters["centroids_hnsw_m"]:
                raise RuntimeError(
                    f"nlist {new_vector_parameters['centroids_hnsw_m']} != {parent_vector_parameters['centroids_hnsw_m']}")

        response = self._client.transport.perform_request(method="GET", url=f"/{parent_index}/_settings?pretty")
        new_index_field = mapping["settings"]["index"]
        parent_index_field = response[parent_index]["settings"]["index"]
        if "knn_routing" in parent_index_field:
            parent_index_knn_routing = True if parent_index_field.get("knn_routing", "false") == "true" else False
            if parent_index_knn_routing != new_index_field.get("knn_routing", False):
                raise RuntimeError(f"knn_routing {new_index_field.get('knn_routing')} != {parent_index_knn_routing}")

    def train_ivfpq_index_with_routing(self,
                                       texts: List[str],
                                       embeddings: List[List[float]],
                                       metadatas: Optional[List[dict]] = None,
                                       ids: Optional[List[str]] = None,
                                       bulk_size: int = 500,
                                       **kwargs) -> List[str]:
        logger.info("start train ivfpq ...")
        kwargs = kwargs or self.kwargs

        # insert train data
        kwargs["method_name"] = "ivfpq"
        if not kwargs.get("routing_field"):
            raise RuntimeError("Using ivfpq, but routing field is not specified!")
        logger.info(f"Init ivfpq index with routing field [{kwargs.get('routing_field')}]")

        least_data_num = self.kwargs.get("nlist", 1000) * 30

        if len(texts) <= least_data_num:
            self.delete()
            raise RuntimeError(f"train data [{len(texts)}] is too little, at least [{least_data_num}]")
        logger.info(f"ivfpq train data num: {least_data_num}")
        self.__add_texts(texts=texts[:least_data_num],
                         embeddings=embeddings[:least_data_num],
                         metadatas=metadatas[:least_data_num] if metadatas else None,
                         ids=ids[:least_data_num] if ids else None,
                         bulk_size=bulk_size)

        def build_ivfpq_index(index_name, field_name):
            body = {
                "indexName": index_name,
                "fieldName": field_name,
                "removeOldIndex": "true",
                "ivf_train_only": "true"
            }

            response = self._client.transport.perform_request(
                method="POST",
                url="/_plugins/_vector/index/build",
                body=json.dumps(body)
            )
            # response = {'payload': ['default_vector_test1_my_vector']}
            return response

        def check_ivfpq_task(index_name, field_name):
            logger.info("start check ivfpq task ...")
            body = {
                "indexName": index_name,
                "fieldName": field_name,
                "taskIds": "[\"default_" + index_name + "_" + field_name + "\"]"
            }

            max_retries = kwargs.get("train_ivfpq_timeout", 600) / 10
            while True:
                max_retries -= 1
                if max_retries < 0:
                    self.delete()
                    raise RuntimeError("check ivfpq task terminated because of timeout!")

                response = self._client.transport.perform_request(
                    method="GET",
                    url="/_plugins/_vector/index/tasks",
                    body=json.dumps(body)
                )

                logger.info(response)
                # response: {'payload': ['task: default_vector_test1_my_vector, stage: FINISH, innerTasks: 619d9881c21bd7a8edb87db97d5cee73=default_vector_test1_619d9881c21bd7a8edb87db97d5cee73_my_vector_1.MANUAL_IVFPQ_TRAIN_TASK, info: finish building']}
                if "finish building" in response.get("payload", [""])[0]:
                    break
                time.sleep(10)
            logger.info("finish check ivfpq task ...")
            return response

        def reserve_ivfpq_codebook(index_name):
            logger.info("start reserve ivfpq codebook ...")
            response = self._client.transport.perform_request(
                method="POST",
                url="/_truncate/" + index_name,
                params={"reserve_codebook": "true"}
            )
            logger.info("finish reserve ivfpq codebook ...")
            return response

        index_name = kwargs.get("index_name") or self.collection_name.lower()
        field_name = kwargs.get("vector_field", "vector_field")
        build_ivfpq_index(index_name, field_name)

        # check
        check_ivfpq_task(index_name, field_name)

        # reserve
        reserve_ivfpq_codebook(index_name)

        self._ivfpq_trained = True
        logger.info("finish train ivfpq ...")

    def get_ids_by_metadata_field(self, key: str, value: str):
        query = {"query": {"term": {f"{Field.METADATA_KEY.value}.{key}": value}}}
        response = self._client.search(index=self._collection_name.lower(), body=query)
        if response["hits"]["hits"]:
            return [hit["_id"] for hit in response["hits"]["hits"]]
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
            es_ids = self.get_ids_by_metadata_field("doc_id", doc_id)
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
                    delete_error = error.get("delete", {})
                    status = delete_error.get("status")
                    doc_id = delete_error.get("_id")

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

        top_k = kwargs.get("top_k", 10)
        query = default_vector_search_query(query_vector=query_vector, k=top_k)

        try:
            response = self._client.search(index=self._collection_name.lower(), body=query)
        except Exception as e:
            logger.error(f"Error executing search: {e}")
            raise

        docs = []
        for hit in response["hits"]["hits"]:
            metadata = hit["_source"].get(Field.METADATA_KEY.value, {})

            # Make sure metadata is a dictionary
            if metadata is None:
                metadata = {}

            metadata["score"] = hit["_score"]
            score_threshold = kwargs.get("score_threshold") if kwargs.get("score_threshold") else 0.0
            if hit["_score"] > score_threshold:
                doc = Document(page_content=hit["_source"].get(Field.CONTENT_KEY.value), metadata=metadata)
                docs.append(doc)

        return docs

    def search_by_full_text(self, query: str, **kwargs: Any) -> list[Document]:
        must = kwargs.get("must", None)
        must_not = kwargs.get("must_not", None)
        should = kwargs.get("should", None)
        minimum_should_match = kwargs.get("minimum_should_match", 0)
        top_k = kwargs.get("top_k", 10)
        filter = kwargs.get("filter", None)
        routing = kwargs.get("routing", None)
        full_text_query = default_text_search_query(
            query_text=query,
            k=top_k,
            text_field=Field.CONTENT_KEY.value,
            must=must,
            must_not=must_not,
            should=should,
            minimum_should_match=minimum_should_match,
            filter=filter,
            routing=routing
        )
        response = self._client.search(index=self._collection_name.lower(), body=full_text_query)
        docs = []
        for hit in response["hits"]["hits"]:
            metadata = hit["_source"].get(Field.METADATA_KEY.value)
            vector = hit["_source"].get(Field.VECTOR.value)
            page_content = hit["_source"].get(Field.CONTENT_KEY.value)
            doc = Document(page_content=page_content, vector=vector, metadata=metadata)
            docs.append(doc)

        return docs

    def search_by_hybrid(self, query_vector: list[float], query: str, **kwargs: Any) -> list[Document]:
        top_k = kwargs.get("top_k", 10)
        filter_ = kwargs.get("filter", None)
        match_text = kwargs.get("match_text", query)
        vector_field = kwargs.get("vector_field", "vector_field")
        rrf_rank_constant = kwargs.get("rrf_rank_constant", "60")
        min_score = kwargs.get("min_score", "0.0")
        filter_type = kwargs.get("filter_type", None)
        ef_search = kwargs.get("ef_search", None)
        nprobe = kwargs.get("nprobe", None)
        reorder_factor = kwargs.get("reorder_factor", None)
        client_refactor = kwargs.get("client_refactor", None)
        rrf_window_size = kwargs.get("rrf_window_size", None)
        routing = kwargs.get("routing", None)

        search_query = default_hybrid_search_query(
            query_vector=query_vector,
            k=top_k,
            vector_field=vector_field,
            text_field=Field.CONTENT_KEY.value,
            hybrid=True,
            rrf_rank_constant=rrf_rank_constant,
            match_text=match_text,
            filter=filter_,
            filter_type=filter_type,
            min_score=min_score,
            ef_search=ef_search,
            nprobe=nprobe,
            reorder_factor=reorder_factor,
            client_refactor=client_refactor,
            rrf_window_size=rrf_window_size,
            routing=routing
        )

        response = self._client.search(index=self._collection_name.lower(), body=search_query)
        docs = []
        for hit in response["hits"]["hits"]:
            metadata = hit["_source"].get(Field.METADATA_KEY.value)
            vector = hit["_source"].get(Field.VECTOR.value)
            page_content = hit["_source"].get(Field.CONTENT_KEY.value)
            doc = Document(page_content=page_content, vector=vector, metadata=metadata)
            docs.append(doc)

        return docs

    def create_collection(
            self, embeddings: list, **kwargs
    ):
        lock_name = f"vector_indexing_lock_{self._collection_name.lower()}"
        with redis_client.lock(lock_name, timeout=20):
            collection_exist_cache_key = f"vector_indexing_{self._collection_name.lower()}"
            if redis_client.get(collection_exist_cache_key):
                logger.info(f"Collection {self._collection_name.lower()} already exists.")
                return

            if self._client.indices.exists(index=self._collection_name.lower()):
                print("{self._collection_name.lower()} already exists.")
                return

            dimension = len(embeddings[0])
            routing_field = kwargs.get("routing_field", None)
            if routing_field is not None:
                self._is_route_index = True
            vector_field = kwargs.pop("vector_field", Field.VECTOR.value)
            shards = kwargs.pop("shards", 2)

            engine = kwargs.pop("engine", "lvector")
            method_name = kwargs.pop("method_name", "ivfpq")
            data_type = kwargs.pop("data_type", "float")
            space_type = kwargs.pop("space_type", "cosinesimil")

            hnsw_m = kwargs.pop("hnsw_m", 24)
            hnsw_ef_construction = kwargs.pop("hnsw_ef_construction", 500)
            ivfpq_m = kwargs.pop("ivfpq_m", dimension)
            nlist = kwargs.pop("nlist", 1000)
            centroids_use_hnsw = kwargs.pop("centroids_use_hnsw", True if nlist >= 5000 else False)
            centroids_hnsw_m = kwargs.pop("centroids_hnsw_m", 24)
            centroids_hnsw_ef_construct = kwargs.pop("centroids_hnsw_ef_construct", 500)
            centroids_hnsw_ef_search = kwargs.pop("centroids_hnsw_ef_search", 100)
            mapping = default_text_mapping(
                dimension,
                method_name,
                shards=shards,
                engine=engine,
                data_type=data_type,
                space_type=space_type,
                vector_field=vector_field,
                hnsw_m=hnsw_m,
                hnsw_ef_construction=hnsw_ef_construction,
                nlist=nlist,
                ivfpq_m=ivfpq_m,
                centroids_use_hnsw=centroids_use_hnsw,
                centroids_hnsw_m=centroids_hnsw_m,
                centroids_hnsw_ef_construct=centroids_hnsw_ef_construct,
                centroids_hnsw_ef_search=centroids_hnsw_ef_search,
                **kwargs
            )
            parent_index = kwargs.pop("parent_index", None)
            if parent_index is not None:
                if parent_index.lower() == self._collection_name.lower():
                    raise RuntimeError(
                        f"not allow index inherit the same index: {parent_index.lower()} == {self._collection_name.lower()}")
                self.check_allow_inherit(parent_index, mapping)
                mapping["settings"]["index"]["knn.vector_codebook_inherit_from"] = parent_index
                mapping["settings"]["index"]["knn.offline.construction"] = True
            self._client.indices.create(index=self._collection_name.lower(), body=mapping)

            if parent_index is not None:
                # trigger new vector table
                routing_field = kwargs.get("routing_field", None)
                routing = "0"
                return_ids = bulk_ingest_embeddings(
                    self._client,
                    self._collection_name.lower(),
                    [embeddings[0]],
                    ["demo"],
                    metadatas=None if routing_field is None else [{routing_field: routing}],
                    ids=["demo_id__"],
                    routing_field=routing_field
                )
                self.refresh()
                self.delete_by_ids(ids=return_ids)
                logger.info(f"id {return_ids}, del")
            elif self._is_route_index and method_name == "ivfpq":
                self._ivfpq_trained = False

            redis_client.set(collection_exist_cache_key, 1, ex=3600)


class LindormVectorStoreFactory(AbstractVectorFactory):
    def init_vector(self, dataset: Dataset, attributes: list, embeddings: Embeddings) -> LindormVectorStore:
        if dataset.index_struct_dict:
            class_prefix: str = dataset.index_struct_dict["vector_store"]["class_prefix"]
            collection_name = class_prefix
        else:
            dataset_id = dataset.id
            collection_name = f"dify_dataset_{dataset_id}"
        config = LindormVectorStoreConfig(
            host=dify_config.vector_store.host,
            port=dify_config.vector_store.port,
            username=dify_config.vector_store.username,
            password=dify_config.vector_store.password,
        )
        return LindormVectorStore(collection_name, config)


