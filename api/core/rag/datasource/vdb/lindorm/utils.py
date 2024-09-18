import logging
import uuid
from typing import List, Dict, Optional, Any, Iterable

from opensearchpy.helpers import bulk
from tenacity import stop_after_attempt, wait_fixed, retry
from core.rag.datasource.vdb.field import Field
from core.model_manager import logger

"""
default index create query mapping
"""


def default_text_mapping(
        dimension: int,
        method_name: str,
        **kwargs: Any
) -> Dict:
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
        must: Optional[List[Dict]] = None,
        must_not: Optional[List[Dict]] = None,
        should: Optional[List[Dict]] = None,
        minimum_should_match: int = 0,
        filter: Optional[List[Dict]] = None,
        routing: Optional[str] = None,
        **kwargs
) -> Dict:
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
    if not must and not must_not and not should and not filter:
        search_query = {
            "size": k,
            "query": query_clause
        }
        return search_query

    # build complex search_query when either of must/must_not/should/filter is specified
    if must:
        if not isinstance(must, list):
            raise RuntimeError(f"unexpected [must] clause with {type(filter)}")
        if query_clause not in must:
            must.append(query_clause)
    else:
        must = [query_clause]

    boolean_query = {
        "must": must
    }

    if must_not:
        if not isinstance(must_not, list):
            raise RuntimeError(f"unexpected [must_not] clause with {type(filter)}")
        boolean_query["must_not"] = must_not

    if should:
        if not isinstance(should, list):
            raise RuntimeError(f"unexpected [should] clause with {type(filter)}")
        boolean_query["should"] = should
        if minimum_should_match != 0:
            boolean_query["minimum_should_match"] = minimum_should_match

    if filter:
        if not isinstance(filter, list):
            raise RuntimeError(f"unexpected [filter] clause with {type(filter)}")
        boolean_query["filter"] = filter

    search_query = {
        "size": k,
        "query": {
            "bool": boolean_query
        }
    }

    return search_query

def default_vector_search_query(
        query_vector: List[float],
        k: int = 4,
        min_score: str = "0.0",
        ef_search: Optional[str] = None,  # only for hnsw
        nprobe: Optional[str] = None,  # "2000"
        reorder_factor: Optional[str] = None,  # "20"
        client_refactor: Optional[str] = None,  # "true"
        vector_field: str = Field.VECTOR.value,
        filter: Optional[List[Dict]] = None,
        filter_type: str = None,
        **kwargs
) -> Dict:
    if filter != None:
        filter_type = "post_filter" if filter_type is None else filter_type
        if not isinstance(filter, list):
            raise RuntimeError(f"unexpected filter with {type(filter)}")
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

    if filter != None:
        # when using filter, transform filter from List[Dict] to Dict as valid format
        filter = {"bool": {"must": filter}} if len(filter) > 1 else filter[0]
        search_query["query"]["knn"][vector_field]["filter"] = filter  # filter should be Dict
        if filter_type:
            final_ext["lvector"]["filter_type"] = filter_type

    if final_ext != {"lvector": {}}:
        search_query["ext"] = final_ext


def default_hybrid_search_query(
        query_vector: List[float],
        k: int = 4,
        vector_field: str = Field.VECTOR.value,
        text_field: str = Field.CONTENT_KEY.value,
        rrf_rank_constant: str = "60",
        match_text: str = "",
        filter: Optional[List[Dict]] = None,
        filter_type: str = None,
        min_score: str = "0.0",
        ef_search: Optional[str] = None,  # only for hnsw
        nprobe: Optional[str] = None,  # "2000"
        reorder_factor: Optional[str] = None,  # "20"
        client_refactor: Optional[str] = None,  # "true"
        rrf_window_size: Optional[str] = None,
        routing: Optional[str] = None,
        **kwargs
) -> Dict:
    must_clauses = [
        {"match": {text_field: match_text}}
    ]
    if routing is not None:
        routing_field = kwargs.get("routing_field", "routing_field")
        must_clauses.append({"term": {f"metadata.{routing_field}.keyword": routing}})

    if filter is not None:
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
                        "filter": filter  # filter should be List[Dict]
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
        embeddings: List[List[float]],
        texts: Iterable[str],
        metadatas: Optional[List[dict]] = None,
        ids: Optional[List[str]] = None,
        vector_field: str = "vector",
        text_field: str = "text",
        max_chunk_bytes: Optional[int] = 10 * 1024 * 1024,
        routing_field: Optional[str] = None,
) -> List[str]:
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
    def bulk_with_retry(client: Any, requests: List[dict], max_chunk_bytes: int):
        bulk(client, requests, max_chunk_bytes=max_chunk_bytes)

    try:
        bulk_with_retry(client, requests, max_chunk_bytes)
    except Exception as e:
        logger.error(f"RetryError in bulking:{e.last_attempt.exception()}")
    return return_ids
