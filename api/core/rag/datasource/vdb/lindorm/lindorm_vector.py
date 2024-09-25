import copy
import json
import logging
import random
import time
import uuid
from collections.abc import Iterable
from typing import Any, Optional

from opensearchpy import OpenSearch
from opensearchpy.helpers import bulk
from pydantic import BaseModel, model_validator
from tenacity import retry, stop_after_attempt, wait_fixed

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


class LindormVectorStoreConfig(BaseModel):
    hosts: str
    username: Optional[str] = None
    password: Optional[str] = None

    @model_validator(mode="before")
    @classmethod
    def validate_config(cls, values: dict) -> dict:
        if not values["hosts"]:
            raise ValueError("config URL is required")
        if not values["username"]:
            raise ValueError("config USERNAME is required")
        if not values["password"]:
            raise ValueError("config PASSWORD is required")
        return values

    def to_opensearch_params(self) -> dict[str, Any]:
        params = {
            "hosts": self.hosts,
        }
        if self.username and self.password:
            params["http_auth"] = (self.username, self.password)
        return params


class LindormVectorStore(BaseVector):
    def __init__(self, collection_name: str, config: LindormVectorStoreConfig, **kwargs):
        super().__init__(collection_name.lower())
        self._client_config = config
        self._client = OpenSearch(**config.to_opensearch_params())
        if kwargs.get("routing_field") is not None:
            self._is_route_index = True
        else:
            self._is_route_index = False
        self._ivfpq_trained = True
        self.kwargs = kwargs

    def get_type(self) -> str:
        return VectorType.LINDORM

    def create(self, texts: list[Document], embeddings: list[list[float]], **kwargs):
        self.create_collection(len(embeddings[0]), **kwargs)
        self.add_texts(texts, embeddings)

    def refresh(self):
        self._client.indices.refresh(index=self._collection_name)

    def __filter_existed_ids(self,
                             texts: list[str],
                             metadatas: list[dict],
                             ids: list[str],
                             bulk_size: int = 1024,
                             ) -> tuple[Iterable[str], Optional[list[dict]], Optional[list[str]]]:
        @retry(stop=stop_after_attempt(3), wait=wait_fixed(60))
        def __fetch_existing_ids(batch_ids: list[str]) -> set[str]:
            try:
                existing_docs = self._client.mget(
                    index=self._collection_name,
                    body={"ids": batch_ids},
                    _source=False
                )
                return {doc['_id'] for doc in existing_docs['docs'] if doc['found']}
            except Exception as e:
                logger.error(f"Error fetching batch {batch_ids}: {e}")
                return set

        @retry(stop=stop_after_attempt(3), wait=wait_fixed(60))
        def __fetch_existing_routing_ids(batch_ids: list[str], route_ids: list[str]) -> set[str]:
            try:
                existing_docs = self._client.mget(
                    body={"docs": [
                        {
                            "_index": self._collection_name,
                            "_id": id,
                            "routing": routing
                        } for id, routing in zip(batch_ids, route_ids)
                    ]},
                    _source=False
                )
                return {doc['_id'] for doc in existing_docs['docs'] if doc['found']}
            except Exception as e:
                logger.error(f"Error fetching batch {batch_ids}: {e}")
                return set

        if ids is None:
            return texts, metadatas, ids

        if len(texts) != len(ids):
            raise RuntimeError(f"texts {len(texts)} != {ids}")

        if self._is_route_index and metadatas is None:
            raise RuntimeError("route_index need metadatas's routing field, but metadatas is None")

        filtered_texts = []
        filtered_metadatas = []
        filtered_ids = []

        def batch(iterable, n):
            length = len(iterable)
            for idx in range(0, length, n):
                yield iterable[idx:min(idx + n, length)]

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
        routing_field = self.kwargs.get("routing_field", None)
        bulk_size = kwargs.get("bulk_size", 500)
        texts = [d.page_content for d in documents]
        metadatas = [d.metadata for d in documents]
        ids = [d.metadata["doc_id"] for d in documents]
        if not self._ivfpq_trained:
            self.train_ivfpq_index_with_routing(texts=texts,
                                                metadatas=metadatas,
                                                embeddings=embeddings,
                                                ids=ids,
                                                bulk_size=bulk_size,
                                                **kwargs)
        self.__add_texts(texts=texts, embeddings=embeddings, metadatas=metadatas, ids=ids, max_chunk_bytes=bulk_size,
                         routing_field=routing_field)

    def __add_texts(self,
                    texts: Iterable[str],
                    embeddings: list[list[float]],
                    ids: Optional[list[str]] = None,
                    metadatas: Optional[list[dict]] = None,
                    max_chunk_bytes: Optional[int] = 10 * 1024 * 1024,
                    routing_field: Optional[str] = None,
                    ) -> list[str]:
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

        bulked_ids = bulk_ingest_embeddings(
            client=self._client,
            index_name=self._collection_name,
            texts=texts,
            embeddings=embeddings,
            ids=ids,
            metadatas=metadatas,
            max_chunk_bytes=max_chunk_bytes,
            routing_field=routing_field
        )
        self.refresh()
        return bulked_ids

    def check_allow_inherit(self, parent_index: str, mapping: dict):
        response = self._client.transport.perform_request(method="GET", url=f"/{parent_index}/_mapping?pretty")
        new_vector_field = mapping["mappings"]["properties"][Field.VECTOR.value]
        parent_vector_field = response[parent_index]["mappings"]["properties"][Field.VECTOR.value]
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
                                       texts: list[str],
                                       embeddings: list[list[float]],
                                       metadatas: Optional[list[dict]] = None,
                                       ids: Optional[list[str]] = None,
                                       bulk_size: int = 500,
                                       **kwargs) -> list[str]:
        logger.info("start train ivfpq ...")
        kwargs = kwargs or self.kwargs

        # insert train data
        kwargs["method_name"] = "ivfpq"
        # if not kwargs.get("routing_field"):
        #     raise RuntimeError("Using ivfpq, but routing field is not specified!")
        # logger.info(f"Init ivfpq index with routing field [{kwargs.get('routing_field')}]")

        least_data_num = self.kwargs.get("nlist", 1000) * 30

        if len(texts) <= least_data_num:
            self.delete()
            raise RuntimeError(f"train data [{len(texts)}] is too little, at least [{least_data_num}]")
        logger.info(f"ivfpq train data num: {least_data_num}")
        self.__add_texts(texts=texts[:least_data_num],
                         embeddings=embeddings[:least_data_num],
                         metadatas=metadatas[:least_data_num] if metadatas else None,
                         ids=ids[:least_data_num] if ids else None,
                         max_chunk_bytes=bulk_size,
                         routing_field=kwargs.get("routing_field"))

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

        index_name = kwargs.get("index_name", self._collection_name)
        field_name = kwargs.get("vector_field", Field.VECTOR.value)
        build_ivfpq_index(index_name, field_name)

        # check
        check_ivfpq_task(index_name, field_name)

        # reserve
        reserve_ivfpq_codebook(index_name)

        self._ivfpq_trained = True
        logger.info("finish train ivfpq ...")

    def get_ids_by_metadata_field(self, key: str, value: str):
        query = {"_source": True, "query": {"term": {f"{Field.METADATA_KEY.value}.{key}": value}}}
        response = self._client.search(index=self._collection_name, body=query)
        if response["hits"]["hits"]:
            return [hit["_id"] for hit in response["hits"]["hits"]]
        else:
            return None

    def delete_by_metadata_field(self, key: str, value: str):
        query_str = {"query": {"match": {f"metadata.{key}": f"{value}"}}}
        results = self._client.search(index=self._collection_name, body=query_str)
        ids = [hit["_id"] for hit in results["hits"]["hits"]]
        if ids:
            self.delete_by_ids(ids)

    def delete_by_ids(self, ids: list[str]) -> None:
        for id in ids:
            self._client.delete(index=self._collection_name, id=id)

    def delete(self) -> None:
        try:
            self._client.indices.delete(index=self._collection_name, params={"timeout": 60})
            print("delete index success")
        except Exception as e:
            raise e

    def text_exists(self, id: str) -> bool:
        try:
            self._client.get(index=self._collection_name, id=id)
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
        query = default_vector_search_query(query_vector=query_vector, k=top_k, **kwargs)
        try:
            response = self._client.search(index=self._collection_name, body=query)
        except Exception as e:
            logger.error(f"Error executing search: {e}")
            raise

        docs_and_scores = []
        for hit in response["hits"]["hits"]:
            docs_and_scores.append(
                (
                    Document(
                        page_content=hit["_source"][Field.CONTENT_KEY.value],
                        vector=hit["_source"][Field.VECTOR.value],
                        metadata=hit["_source"][Field.METADATA_KEY.value],
                    ),
                    hit["_score"],
                )
            )
        docs = []
        for doc, score in docs_and_scores:
            score_threshold = kwargs.get("score_threshold", 0.0) if kwargs.get("score_threshold", 0.0) else 0.0
            if score > score_threshold:
                doc.metadata["score"] = score
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
        response = self._client.search(index=self._collection_name, body=full_text_query)
        docs = []
        for hit in response["hits"]["hits"]:
            docs.append(
                Document(
                    page_content=hit["_source"][Field.CONTENT_KEY.value],
                    vector=hit["_source"][Field.VECTOR.value],
                    metadata=hit["_source"][Field.METADATA_KEY.value],
                )
            )

        return docs

    def search_by_hybrid(self, query_vector: list[float], query: str, **kwargs: Any) -> list[Document]:
        top_k = kwargs.get("top_k", 10)
        filter_ = kwargs.get("filter", None)
        match_text = kwargs.get("match_text", query)
        vector_field = kwargs.get("vector_field", Field.VECTOR.value)
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

        response = self._client.search(index=self._collection_name, body=search_query)
        docs_and_scores = []
        for hit in response["hits"]["hits"]:
            docs_and_scores.append(
                (
                    Document(
                        page_content=hit["_source"][Field.CONTENT_KEY.value],
                        vector=hit["_source"][Field.VECTOR.value],
                        metadata=hit["_source"][Field.METADATA_KEY.value],
                    ),
                    hit["_score"],
                )
            )
        docs = []
        for doc, score in docs_and_scores:
            score_threshold = kwargs.get("score_threshold", 0.0) if kwargs.get("score_threshold", 0.0) else 0.0
            if score > score_threshold:
                doc.metadata["score"] = score
            docs.append(doc)

        return docs

    def create_collection(
            self, dimension: int, **kwargs
    ):
        lock_name = f"vector_indexing_lock_{self._collection_name}"
        with redis_client.lock(lock_name, timeout=20):
            collection_exist_cache_key = f"vector_indexing_{self._collection_name}"
            if redis_client.get(collection_exist_cache_key):
                logger.info(f"Collection {self._collection_name} already exists.")
                return
            if self._client.indices.exists(index=self._collection_name):
                print("{self._collection_name.lower()} already exists.")
                return
            if len(self.kwargs) == 0 and len(kwargs) != 0:
                self.kwargs = copy.deepcopy(kwargs)
            routing_field = kwargs.get("routing_field", None)
            if routing_field is not None:
                self._is_route_index = True
            vector_field = kwargs.pop("vector_field", Field.VECTOR.value)
            shards = kwargs.pop("shards", 2)

            engine = kwargs.pop("engine", "lvector")
            method_name = kwargs.pop("method_name", "hnsw")
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
                if parent_index.lower() == self._collection_name:
                    raise RuntimeError(
                        f"not allow index inherit the same index: {parent_index.lower()} == {self._collection_name}")
                self.check_allow_inherit(parent_index, mapping)
                mapping["settings"]["index"]["knn.vector_codebook_inherit_from"] = parent_index
                mapping["settings"]["index"]["knn.offline.construction"] = True

            self._client.indices.create(index=self._collection_name.lower(), body=mapping)
            redis_client.set(collection_exist_cache_key, 1, ex=3600)
            print(f"create index success: {self._collection_name}")

            if parent_index is not None:
                # trigger new vector table
                routing_field = kwargs.get("routing_field", None)
                routing = "0"
                return_ids = bulk_ingest_embeddings(
                    self._client,
                    self._collection_name,
                    [[random.random() for _ in range(dimension)]],
                    ["demo"],
                    metadatas=None if routing_field is None else [{routing_field: routing}],
                    ids=["demo_id__"],
                    routing_field=routing_field
                )
                self.refresh()
                self.delete_by_ids(ids=return_ids)
                logger.info(f"id {return_ids}, del")
            elif method_name == "ivfpq":
                self._ivfpq_trained = False


def default_text_mapping(
        dimension: int,
        method_name: str,
        **kwargs: Any
) -> dict:
    routing_field = kwargs.get("routing_field", None)
    excludes_from_source = kwargs.get("excludes_from_source", None)
    analyzer = kwargs.get("analyzer", "ik_max_word")
    text_field = kwargs.get("text_field", Field.CONTENT_KEY.value)
    engine = kwargs["engine"]
    shard = kwargs["shards"]
    space_type = kwargs["space_type"]
    data_type = kwargs["data_type"]
    vector_field = kwargs.get("vector_field", Field.VECTOR.value)

    if method_name == "ivfpq":
        ivfpq_m = kwargs["ivfpq_m"]
        nlist = kwargs["nlist"]
        centroids_use_hnsw = True if nlist > 10000 else False
        centroids_hnsw_m = 24
        centroids_hnsw_ef_construct = 500
        centroids_hnsw_ef_search = 100
        parameters = {
            "m": ivfpq_m,
            "nlist": nlist,
            "centroids_use_hnsw": centroids_use_hnsw,
            "centroids_hnsw_m": centroids_hnsw_m,
            "centroids_hnsw_ef_construct": centroids_hnsw_ef_construct,
            "centroids_hnsw_ef_search": centroids_hnsw_ef_search
        }
    elif method_name == "hnsw":
        neighbor = kwargs["hnsw_m"]
        ef_construction = kwargs["hnsw_ef_construction"]
        parameters = {
            "m": neighbor,
            "ef_construction": ef_construction
        }
    elif method_name == "flat":
        parameters = {}
    else:
        raise RuntimeError(f"unexpected method_name: {method_name}")

    mapping = {
        "settings": {
            "index": {
                "number_of_shards": shard,
                "knn": True
            }
        },
        "mappings": {
            "properties": {
                vector_field: {
                    "type": "knn_vector",
                    "dimension": dimension,
                    "data_type": data_type,
                    "method": {
                        "engine": engine,
                        "name": method_name,
                        "space_type": space_type,
                        "parameters": parameters
                    }
                },
                text_field: {
                    "type": "text",
                    "analyzer": analyzer
                }
            }
        }
    }

    if excludes_from_source:
        mapping["mappings"]["_source"] = {"excludes": excludes_from_source}  # e.g. {"excludes": ["vector_field"]}

    if method_name == "ivfpq" and routing_field is not None:
        mapping["settings"]["index"]["knn_routing"] = True
        mapping["settings"]["index"]["knn.offline.construction"] = True

    if method_name == "flat" and routing_field is not None:
        mapping["settings"]["index"]["knn_routing"] = True

    return mapping


def default_text_search_query(
        query_text: str,
        k: int = 4,
        text_field: str = Field.CONTENT_KEY.value,
        must: Optional[list[dict]] = None,
        must_not: Optional[list[dict]] = None,
        should: Optional[list[dict]] = None,
        minimum_should_match: int = 0,
        filters: Optional[list[dict]] = None,
        routing: Optional[str] = None,
        **kwargs
) -> dict:
    if routing is not None:
        routing_field = kwargs.get("routing_field", "routing_field")
        query_clause = {
            "bool": {
                "must": [
                    {"match": {text_field: query_text}},
                    {"term": {f"metadata.{routing_field}.keyword": routing}}
                ]
            }
        }
    else:
        query_clause = {
            'match': {
                text_field: query_text
            }
        }
    # build the simplest search_query when only query_text is specified
    if not must and not must_not and not should and not filters:
        search_query = {
            "size": k,
            "query": query_clause
        }
        return search_query

    # build complex search_query when either of must/must_not/should/filter is specified
    if must:
        if not isinstance(must, list):
            raise RuntimeError(f"unexpected [must] clause with {type(filters)}")
        if query_clause not in must:
            must.append(query_clause)
    else:
        must = [query_clause]

    boolean_query = {
        "must": must
    }

    if must_not:
        if not isinstance(must_not, list):
            raise RuntimeError(f"unexpected [must_not] clause with {type(filters)}")
        boolean_query["must_not"] = must_not

    if should:
        if not isinstance(should, list):
            raise RuntimeError(f"unexpected [should] clause with {type(filters)}")
        boolean_query["should"] = should
        if minimum_should_match != 0:
            boolean_query["minimum_should_match"] = minimum_should_match

    if filters:
        if not isinstance(filters, list):
            raise RuntimeError(f"unexpected [filter] clause with {type(filters)}")
        boolean_query["filter"] = filters

    search_query = {
        "size": k,
        "query": {
            "bool": boolean_query
        }
    }
    return search_query


def default_vector_search_query(
        query_vector: list[float],
        k: int = 4,
        min_score: str = "0.0",
        ef_search: Optional[str] = None,  # only for hnsw
        nprobe: Optional[str] = None,  # "2000"
        reorder_factor: Optional[str] = None,  # "20"
        client_refactor: Optional[str] = None,  # "true"
        vector_field: str = Field.VECTOR.value,
        filters: Optional[list[dict]] = None,
        filter_type: str = None,
        **kwargs
) -> dict:
    if filters != None:
        filter_type = "post_filter" if filter_type is None else filter_type
        if not isinstance(filter, list):
            raise RuntimeError(f"unexpected filter with {type(filters)}")
    final_ext = {"lvector": {}}
    if min_score != "0.0":
        final_ext["lvector"]["min_score"] = min_score
    if ef_search:
        final_ext["lvector"]["ef_search"] = ef_search
    if nprobe:
        final_ext["lvector"]["nprobe"] = nprobe
    if reorder_factor:
        final_ext["lvector"]["reorder_factor"] = reorder_factor
    if client_refactor:
        final_ext["lvector"]["client_refactor"] = client_refactor

    search_query = {
        "size": k,
        "_source": True,  # force return '_source'
        "query": {
            "knn": {
                vector_field: {
                    "vector": query_vector,
                    "k": k
                }
            }
        }
    }

    if filters != None:
        # when using filter, transform filter from List[Dict] to Dict as valid format
        filters = {"bool": {"must": filters}} if len(filters) > 1 else filters[0]
        search_query["query"]["knn"][vector_field]["filter"] = filters  # filter should be Dict
        if filter_type:
            final_ext["lvector"]["filter_type"] = filter_type

    if final_ext != {"lvector": {}}:
        search_query["ext"] = final_ext
    return search_query


def default_hybrid_search_query(
        query_vector: list[float],
        k: int = 4,
        vector_field: str = Field.VECTOR.value,
        text_field: str = Field.CONTENT_KEY.value,
        rrf_rank_constant: str = "60",
        match_text: str = "",
        filters: Optional[list[dict]] = None,
        filter_type: str = None,
        min_score: str = "0.0",
        ef_search: Optional[str] = None,  # only for hnsw
        nprobe: Optional[str] = None,  # "2000"
        reorder_factor: Optional[str] = None,  # "20"
        client_refactor: Optional[str] = None,  # "true"
        rrf_window_size: Optional[str] = None,
        routing: Optional[str] = None,
        **kwargs
) -> dict:
    must_clauses = [
        {"match": {text_field: match_text}}
    ]
    if routing is not None:
        routing_field = kwargs.get("routing_field", "routing_field")
        must_clauses.append({"term": {f"metadata.{routing_field}.keyword": routing}})

    if filters is not None:
        # Doing rrf search with full text, vector and filter.
        # use two bool expression to do rrf and filter respectively
        final_filter = {
            "bool": {
                "must": [{
                    "bool": {
                        "must": must_clauses
                    }
                }, {
                    "bool": {
                        "filter": filters  # filter should be List[Dict]
                    }
                }]
            }
        }
        final_ext = {
            "lvector": {
                "filter_type": filter_type,
                "hybrid_search_type": "filter_rrf",
                "rrf_rank_constant": rrf_rank_constant,
            }
        }
    else:
        # Doing rrf search with full text and vector.
        final_filter = {
            "bool": {
                "must": must_clauses
            }
        }
        final_ext = {
            "lvector": {
                "hybrid_search_type": "filter_rrf",
                "rrf_rank_constant": rrf_rank_constant,
            }
        }
    if rrf_window_size:
        final_ext["lvector"]["rrf_window_size"] = rrf_window_size
    if min_score != "0.0":
        final_ext["lvector"]["min_score"] = min_score
    if ef_search:
        final_ext["lvector"]["ef_search"] = ef_search
    if nprobe:
        final_ext["lvector"]["nprobe"] = nprobe
    if reorder_factor:
        final_ext["lvector"]["reorder_factor"] = reorder_factor
    if client_refactor:
        final_ext["lvector"]["client_refactor"] = client_refactor

    search_query = {
        "size": k,
        "_source": True,
        "query": {
            "knn": {
                vector_field: {
                    "vector": query_vector,
                    "filter": final_filter,
                    "k": k
                }
            },
        },
        "ext": final_ext
    }
    return search_query


def bulk_ingest_embeddings(
        client: Any,
        index_name: str,
        embeddings: list[list[float]],
        texts: Iterable[str],
        metadatas: Optional[list[dict]] = None,
        ids: Optional[list[str]] = None,
        vector_field: str = Field.VECTOR.value,
        text_field: str = Field.CONTENT_KEY.value,
        max_chunk_bytes: Optional[int] = 10 * 1024 * 1024,
        routing_field: Optional[str] = None,
) -> list[str]:
    """Bulk Ingest Embeddings into given index."""
    requests = []
    return_ids = []

    for i, text in enumerate(texts):
        metadata = metadatas[i] if metadatas else {}
        _id = ids[i] if ids else str(uuid.uuid4())
        request = {
            "_op_type": "index",
            "_index": index_name,
            "_id": _id,
            vector_field: embeddings[i],
            text_field: text,
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
    def bulk_with_retry(client: Any, requests: list[dict], max_chunk_bytes: int):
        bulk(client, requests, max_chunk_bytes=max_chunk_bytes)

    try:
        bulk_with_retry(client, requests, max_chunk_bytes)
    except Exception as e:
        logger.error("RetryError in bulking")
    return return_ids


class LindormVectorStoreFactory(AbstractVectorFactory):
    def init_vector(self, dataset: Dataset, attributes: list, embeddings: Embeddings) -> LindormVectorStore:
        if dataset.index_struct_dict:
            class_prefix: str = dataset.index_struct_dict["vector_store"]["class_prefix"]
            collection_name = class_prefix
        else:
            dataset_id = dataset.id
            collection_name = Dataset.gen_collection_name_by_id(dataset_id)
            dataset.index_struct = json.dumps(self.gen_index_struct_dict(VectorType.LINDORM, collection_name))
        lindorm_config = LindormVectorStoreConfig(
            hosts=dify_config.LINDORM_URL,
            username=dify_config.LINDORM_USERNAME,
            password=dify_config.LINDORM_PASSWORD,
        )
        return LindormVectorStore(collection_name, lindorm_config)
