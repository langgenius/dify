import copy
import json
import logging
from collections.abc import Iterable
from typing import Any, Optional

from opensearchpy import OpenSearch
from opensearchpy.helpers import bulk
from pydantic import BaseModel, model_validator
from tenacity import retry, stop_after_attempt, wait_fixed

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
        self.kwargs = kwargs

    def get_type(self) -> str:
        return VectorType.LINDORM

    def create(self, texts: list[Document], embeddings: list[list[float]], **kwargs):
        self.create_collection(len(embeddings[0]), **kwargs)
        self.add_texts(texts, embeddings)

    def refresh(self):
        self._client.indices.refresh(index=self._collection_name)

    def __filter_existed_ids(
        self,
        texts: list[str],
        metadatas: list[dict],
        ids: list[str],
        bulk_size: int = 1024,
    ) -> tuple[Iterable[str], Optional[list[dict]], Optional[list[str]]]:
        @retry(stop=stop_after_attempt(3), wait=wait_fixed(60))
        def __fetch_existing_ids(batch_ids: list[str]) -> set[str]:
            try:
                existing_docs = self._client.mget(index=self._collection_name, body={"ids": batch_ids}, _source=False)
                return {doc["_id"] for doc in existing_docs["docs"] if doc["found"]}
            except Exception as e:
                logger.exception(f"Error fetching batch {batch_ids}: {e}")
                return set()

        @retry(stop=stop_after_attempt(3), wait=wait_fixed(60))
        def __fetch_existing_routing_ids(batch_ids: list[str], route_ids: list[str]) -> set[str]:
            try:
                existing_docs = self._client.mget(
                    body={
                        "docs": [
                            {"_index": self._collection_name, "_id": id, "routing": routing}
                            for id, routing in zip(batch_ids, route_ids)
                        ]
                    },
                    _source=False,
                )
                return {doc["_id"] for doc in existing_docs["docs"] if doc["found"]}
            except Exception as e:
                logger.exception(f"Error fetching batch {batch_ids}: {e}")
                return set()

        if ids is None:
            return texts, metadatas, ids

        if len(texts) != len(ids):
            raise RuntimeError(f"texts {len(texts)} != {ids}")

        filtered_texts = []
        filtered_metadatas = []
        filtered_ids = []

        def batch(iterable, n):
            length = len(iterable)
            for idx in range(0, length, n):
                yield iterable[idx : min(idx + n, length)]

        for ids_batch, texts_batch, metadatas_batch in zip(
            batch(ids, bulk_size),
            batch(texts, bulk_size),
            batch(metadatas, bulk_size) if metadatas is not None else batch([None] * len(ids), bulk_size),
        ):
            existing_ids_set = __fetch_existing_ids(ids_batch)
            for text, metadata, doc_id in zip(texts_batch, metadatas_batch, ids_batch):
                if doc_id not in existing_ids_set:
                    filtered_texts.append(text)
                    filtered_ids.append(doc_id)
                    if metadatas is not None:
                        filtered_metadatas.append(metadata)

        return filtered_texts, metadatas if metadatas is None else filtered_metadatas, filtered_ids

    def add_texts(self, documents: list[Document], embeddings: list[list[float]], **kwargs):
        actions = []
        uuids = self._get_uuids(documents)
        for i in range(len(documents)):
            action = {
                "_op_type": "index",
                "_index": self._collection_name.lower(),
                "_id": uuids[i],
                "_source": {
                    Field.CONTENT_KEY.value: documents[i].page_content,
                    Field.VECTOR.value: embeddings[i],  # Make sure you pass an array here
                    Field.METADATA_KEY.value: documents[i].metadata,
                },
            }
            actions.append(action)
        bulk(self._client, actions)
        self.refresh()

    def get_ids_by_metadata_field(self, key: str, value: str):
        query = {"query": {"term": {f"{Field.METADATA_KEY.value}.{key}.keyword": value}}}
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
            if self._client.exists(index=self._collection_name, id=id):
                self._client.delete(index=self._collection_name, id=id)
            else:
                logger.warning(f"DELETE BY ID: ID {id} does not exist in the index.")

    def delete(self) -> None:
        try:
            if self._client.indices.exists(index=self._collection_name):
                self._client.indices.delete(index=self._collection_name, params={"timeout": 60})
                logger.info("Delete index success")
            else:
                logger.warning(f"Index '{self._collection_name}' does not exist. No deletion performed.")
        except Exception as e:
            logger.exception(f"Error occurred while deleting the index: {e}")
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
            logger.exception(f"Error executing search: {e}")
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
            score_threshold = kwargs.get("score_threshold", 0.0) or 0.0
            if score > score_threshold:
                doc.metadata["score"] = score
                docs.append(doc)

        return docs

    def search_by_full_text(self, query: str, **kwargs: Any) -> list[Document]:
        must = kwargs.get("must")
        must_not = kwargs.get("must_not")
        should = kwargs.get("should")
        minimum_should_match = kwargs.get("minimum_should_match", 0)
        top_k = kwargs.get("top_k", 10)
        filters = kwargs.get("filter")
        routing = kwargs.get("routing")
        full_text_query = default_text_search_query(
            query_text=query,
            k=top_k,
            text_field=Field.CONTENT_KEY.value,
            must=must,
            must_not=must_not,
            should=should,
            minimum_should_match=minimum_should_match,
            filters=filters,
            routing=routing,
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

    def create_collection(self, dimension: int, **kwargs):
        lock_name = f"vector_indexing_lock_{self._collection_name}"
        with redis_client.lock(lock_name, timeout=20):
            collection_exist_cache_key = f"vector_indexing_{self._collection_name}"
            if redis_client.get(collection_exist_cache_key):
                logger.info(f"Collection {self._collection_name} already exists.")
                return
            if self._client.indices.exists(index=self._collection_name):
                logger.info("{self._collection_name.lower()} already exists.")
                return
            if len(self.kwargs) == 0 and len(kwargs) != 0:
                self.kwargs = copy.deepcopy(kwargs)
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
                **kwargs,
            )
            self._client.indices.create(index=self._collection_name.lower(), body=mapping)
            redis_client.set(collection_exist_cache_key, 1, ex=3600)
            # logger.info(f"create index success: {self._collection_name}")


def default_text_mapping(dimension: int, method_name: str, **kwargs: Any) -> dict:
    routing_field = kwargs.get("routing_field")
    excludes_from_source = kwargs.get("excludes_from_source")
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
            "centroids_hnsw_ef_search": centroids_hnsw_ef_search,
        }
    elif method_name == "hnsw":
        neighbor = kwargs["hnsw_m"]
        ef_construction = kwargs["hnsw_ef_construction"]
        parameters = {"m": neighbor, "ef_construction": ef_construction}
    elif method_name == "flat":
        parameters = {}
    else:
        raise RuntimeError(f"unexpected method_name: {method_name}")

    mapping = {
        "settings": {"index": {"number_of_shards": shard, "knn": True}},
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
                        "parameters": parameters,
                    },
                },
                text_field: {"type": "text", "analyzer": analyzer},
            }
        },
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
    **kwargs,
) -> dict:
    if routing is not None:
        routing_field = kwargs.get("routing_field", "routing_field")
        query_clause = {
            "bool": {
                "must": [{"match": {text_field: query_text}}, {"term": {f"metadata.{routing_field}.keyword": routing}}]
            }
        }
    else:
        query_clause = {"match": {text_field: query_text}}
    # build the simplest search_query when only query_text is specified
    if not must and not must_not and not should and not filters:
        search_query = {"size": k, "query": query_clause}
        return search_query

    # build complex search_query when either of must/must_not/should/filter is specified
    if must:
        if not isinstance(must, list):
            raise RuntimeError(f"unexpected [must] clause with {type(filters)}")
        if query_clause not in must:
            must.append(query_clause)
    else:
        must = [query_clause]

    boolean_query = {"must": must}

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

    search_query = {"size": k, "query": {"bool": boolean_query}}
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
    filter_type: Optional[str] = None,
    **kwargs,
) -> dict:
    if filters is not None:
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
        "query": {"knn": {vector_field: {"vector": query_vector, "k": k}}},
    }

    if filters is not None:
        # when using filter, transform filter from List[Dict] to Dict as valid format
        filters = {"bool": {"must": filters}} if len(filters) > 1 else filters[0]
        search_query["query"]["knn"][vector_field]["filter"] = filters  # filter should be Dict
        if filter_type:
            final_ext["lvector"]["filter_type"] = filter_type

    if final_ext != {"lvector": {}}:
        search_query["ext"] = final_ext
    return search_query


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
