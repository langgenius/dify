from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from elastic_transport import ApiResponseMeta, NodeConfig
from elasticsearch import BadRequestError
from weaviate.classes.config import Tokenization

from services.knowledge_fs.text_store import TextScope, execute_text_request
from services.knowledge_fs.text_store_native import ElasticsearchTextStore, WeaviateTextStore
from services.knowledge_fs.vector_store import VectorStoreUnavailableError
from tests.unit_tests.services.test_knowledge_fs_text_store import SCOPE, A, point, request


@pytest.fixture
def es():
    client = MagicMock()
    client.indices.exists.return_value = True
    client.indices.get_mapping.return_value = {
        TextScope(**SCOPE).collection_name: {
            "mappings": {"properties": {"text": {"type": "text", "analyzer": "whitespace"}}}
        }
    }
    client.bulk.return_value = {"items": [{"index": {"status": 201}}]}
    client.mget.return_value = {"docs": [{"_id": A, "found": False}]}
    client.search.return_value = {"hits": {"hits": [{"_id": A, "_score": 2.0}]}}
    return ElasticsearchTextStore(client)


def test_es_fulltext_uses_native_match_bm25_filtered_ids_and_refresh(es):
    es.client.indices.exists.return_value = False
    execute_text_request(es, request("upsert", points=[point()]))
    es.client.indices.exists.return_value = True
    es.client.mget.return_value = {
        "docs": [{"_id": A, "found": True, "_source": {k: v for k, v in point().items() if k != "id"}}]
    }
    assert execute_text_request(es, request("get", ids=[A]))["points"] == [point()]
    assert execute_text_request(es, request("search", ids=[A], query="refund"))["matches"] == [{"id": A, "score": 2.0}]
    args = es.client.search.call_args.kwargs
    assert args["query"] == {"bool": {"must": [{"match": {"text": "refund"}}], "filter": [{"ids": {"values": [A]}}]}}
    assert args["allow_partial_search_results"] is False
    assert es.client.bulk.call_args.kwargs["refresh"] == "wait_for"
    es.client.bulk.return_value = {"items": [{"delete": {"status": 200}}]}
    with pytest.raises(VectorStoreUnavailableError, match="not visible"):
        execute_text_request(es, request("delete", ids=[A]))
    es.client.mget.return_value = {"docs": [{"_id": A, "found": False}]}
    execute_text_request(es, request("delete", ids=[A]))


@pytest.mark.parametrize("problem", ["bulk", "schema", "read", "timed_out", "shards"])
def test_es_rejects_partial_results_and_wrong_schema(es, problem):
    if problem == "bulk":
        es.client.bulk.return_value = {"items": [{"index": {"status": 500}}]}
        payload = request("upsert", points=[point()])
    elif problem == "schema":
        es.client.indices.get_mapping.return_value[TextScope(**SCOPE).collection_name]["mappings"]["properties"] = {}
        payload = request("get", ids=[A])
    elif problem == "read":
        es.client.mget.return_value = {"docs": [{"error": "unavailable"}]}
        payload = request("get", ids=[A])
    else:
        es.client.search.return_value.update(
            {"timed_out": True} if problem == "timed_out" else {"_shards": {"failed": 1}}
        )
        payload = request("search", ids=[A], query="refund")
    with pytest.raises(VectorStoreUnavailableError):
        execute_text_request(es, payload)


@pytest.mark.parametrize("name", ["resource_already_exists_exception", "denied"])
def test_es_creation_race_or_configuration_failure(es, name):
    es.client.indices.exists.return_value = False
    es.client.indices.create.side_effect = BadRequestError(
        name, ApiResponseMeta(400, "1.1", {}, 0, NodeConfig("http", "localhost", 9200)), {"error": name}
    )
    if name == "denied":
        with pytest.raises(BadRequestError):
            execute_text_request(es, request("upsert", points=[point()]))
    else:
        execute_text_request(es, request("upsert", points=[point()]))


@pytest.fixture
def wv():
    client = MagicMock()
    client.collections.exists.return_value = True
    collection = client.collections.use.return_value.with_consistency_level.return_value
    collection.config.get.return_value = SimpleNamespace(
        description="KnowledgeFS full-text v1; whitespace tokens; BM25",
        multi_tenancy_config=SimpleNamespace(enabled=False),
        properties=[SimpleNamespace(name="text", tokenization=Tokenization.WHITESPACE)],
    )
    collection.data.insert_many.return_value = SimpleNamespace(has_errors=False, uuids=[A])
    collection.data.delete_many.return_value = SimpleNamespace(failed=0)
    collection.query.fetch_objects.return_value = SimpleNamespace(objects=[])
    collection.query.bm25.return_value = SimpleNamespace(
        objects=[SimpleNamespace(uuid=A, metadata=SimpleNamespace(score=2.0))]
    )
    return WeaviateTextStore(client), collection


def test_weaviate_native_bm25_id_filter_retry_and_delete(wv):
    store, collection = wv
    store.client.collections.exists.return_value = False
    execute_text_request(store, request("upsert", points=[point()]))
    assert store.client.collections.create.call_args.kwargs["vector_index_config"].skip
    store.client.collections.exists.return_value = True
    collection.query.fetch_objects.return_value = SimpleNamespace(
        objects=[SimpleNamespace(uuid=A, properties={k: v for k, v in point().items() if k != "id"})]
    )
    assert execute_text_request(store, request("get", ids=[A]))["points"] == [point()]
    assert execute_text_request(store, request("search", ids=[A], query="退 款"))["matches"] == [
        {"id": A, "score": 2.0}
    ]
    args = collection.query.bm25.call_args.kwargs
    assert args["query"] == "退 款"
    assert args["filters"] is not None
    with pytest.raises(VectorStoreUnavailableError, match="not visible"):
        execute_text_request(store, request("delete", ids=[A]))
    collection.query.fetch_objects.return_value = SimpleNamespace(objects=[])
    execute_text_request(store, request("delete", ids=[A]))


@pytest.mark.parametrize("problem", ["schema", "insert", "score", "delete"])
def test_weaviate_rejects_incomplete_backend_results(wv, problem):
    store, collection = wv
    if problem == "schema":
        collection.config.get.return_value.description = "wrong"
        payload = request("get", ids=[A])
    elif problem == "insert":
        collection.data.insert_many.return_value.has_errors = True
        payload = request("upsert", points=[point()])
    elif problem == "score":
        collection.query.bm25.return_value.objects[0].metadata.score = None
        payload = request("search", ids=[A], query="refund")
    else:
        collection.data.delete_many.return_value.failed = 1
        payload = request("delete", ids=[A])
    with pytest.raises(VectorStoreUnavailableError):
        execute_text_request(store, payload)


@pytest.mark.parametrize("exists_after", [True, False])
def test_weaviate_creation_race(wv, exists_after):
    store, _ = wv
    store.client.collections.exists.side_effect = [False, exists_after]
    store.client.collections.create.side_effect = RuntimeError("race")
    if exists_after:
        execute_text_request(store, request("upsert", points=[point()]))
    else:
        with pytest.raises(RuntimeError):
            execute_text_request(store, request("upsert", points=[point()]))


@pytest.mark.parametrize("backend", ["es", "wv"])
@pytest.mark.parametrize("operation", ["get", "delete", "search"])
def test_missing_native_fulltext_indexes_fail_closed_on_search(es, wv, backend, operation):
    store = es if backend == "es" else wv[0]
    if backend == "es":
        store.client.indices.exists.return_value = False
    else:
        store.client.collections.exists.return_value = False
    payload = request(operation, ids=[A], **({"query": "refund"} if operation == "search" else {}))
    if operation == "search":
        with pytest.raises(VectorStoreUnavailableError, match="missing"):
            execute_text_request(store, payload)
    else:
        assert execute_text_request(store, payload) == {"points": [], "matches": []}
