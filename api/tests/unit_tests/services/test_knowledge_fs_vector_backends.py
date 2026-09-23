from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from elastic_transport import ApiResponseMeta, NodeConfig
from elasticsearch import BadRequestError, NotFoundError
from weaviate.classes.config import ConsistencyLevel, DataType, VectorDistances

from services.knowledge_fs.vector_store import (
    VectorRequest,
    VectorScope,
    VectorStoreUnavailableError,
    configured_vector_client,
    execute_vector_request,
)
from services.knowledge_fs.vector_store_elasticsearch import ElasticsearchVectorStore
from services.knowledge_fs.vector_store_weaviate import WeaviateVectorStore

A, B, GENERATION = (f"00000000-0000-4000-8000-{n:012d}" for n in (1, 2, 3))
SCOPE = {"tenant_id": A, "knowledge_space_id": B, "vector_space_id": "test", "kind": "dense", "dimension": 2}
POINT = {"id": A, "generation_id": GENERATION, "content_hash": "a" * 64, "vector": [3, 4]}


def request(operation, **kwargs):
    return VectorRequest.model_validate({"operation": operation, "scope": SCOPE, **kwargs})


def fail_with_configured_store(expected):
    with configured_vector_client(A) as store:
        assert isinstance(store, expected)
        raise RuntimeError("failure")


def es_error(status, name):
    meta = ApiResponseMeta(status, "1.1", {}, 0, NodeConfig("http", "localhost", 9200))
    return (NotFoundError if status == 404 else BadRequestError)(name, meta, {"error": name})


@pytest.fixture
def es():
    client = MagicMock()
    client.indices.get_mapping.return_value = {
        VectorScope.model_validate(SCOPE).collection_name: {
            "mappings": {
                "properties": {
                    "vector": {"type": "dense_vector", "dims": 2, "index": True, "similarity": "cosine"},
                    "generation_id": {"type": "keyword"},
                    "content_hash": {"type": "keyword"},
                }
            }
        }
    }
    client.bulk.return_value = {"items": [{"index": {"status": 201}}]}
    return ElasticsearchVectorStore(client)


def test_elasticsearch_retry_write_readback_filter_and_cosine(es):
    for _ in range(2):
        execute_vector_request(es, request("upsert", points=[POINT]))
    write = es.client.bulk.call_args.kwargs
    assert write["operations"][0]["index"]["_id"] == A
    assert write["operations"][1] == {key: val for key, val in POINT.items() if key != "id"}
    assert write["refresh"] == "wait_for"
    es.client.mget.return_value = {"docs": [{"_id": A, "found": True, "_source": write["operations"][1]}]}
    assert execute_vector_request(es, request("get", ids=[A]))["points"] == [POINT]
    es.client.search.return_value = {"hits": {"hits": [{"_id": A, "_score": 0.8}]}}
    matches = execute_vector_request(es, request("search", ids=[A], query_vector=[1, 0]))["matches"]
    assert matches[0]["score"] == pytest.approx(0.6)
    search = es.client.search.call_args.kwargs
    assert search["knn"]["filter"] == {"ids": {"values": [A]}}
    assert search["allow_partial_search_results"] is False


@pytest.mark.parametrize("race", [False, True])
def test_elasticsearch_first_writer_or_compatible_creation_race(es, race):
    mapping = es.client.indices.get_mapping.return_value
    es.client.indices.get_mapping.side_effect = [es_error(404, "index_not_found_exception"), mapping]
    if race:
        es.client.indices.create.side_effect = es_error(400, "resource_already_exists_exception")
    execute_vector_request(es, request("upsert", points=[POINT]))
    created = es.client.indices.create.call_args.kwargs["mappings"]
    assert created["properties"]["vector"]["index_options"] == {"type": "hnsw"}
    assert created["dynamic"] == "strict"


def test_elasticsearch_creation_error_does_not_hide_configuration_failure(es):
    es.client.indices.get_mapping.side_effect = es_error(404, "missing")
    es.client.indices.create.side_effect = es_error(400, "mapper_parsing_exception")
    with pytest.raises(BadRequestError):
        execute_vector_request(es, request("upsert", points=[POINT]))
    es.client.bulk.assert_not_called()


@pytest.mark.parametrize("operation", ["search", "get", "delete"])
def test_elasticsearch_missing_index_is_explicit_for_search(es, operation):
    es.client.indices.get_mapping.side_effect = es_error(404, "missing")
    payload = request(operation, ids=[A], **({"query_vector": [1, 0]} if operation == "search" else {}))
    if operation == "search":
        with pytest.raises(VectorStoreUnavailableError, match="missing"):
            execute_vector_request(es, payload)
    else:
        assert execute_vector_request(es, payload) == {"points": [], "matches": []}
    es.client.indices.create.assert_not_called()


@pytest.mark.parametrize("change", [{"dims": 3}, {"similarity": "l2_norm"}, {"index": False}, {"element_type": "byte"}])
def test_elasticsearch_incompatible_index_is_never_overwritten(es, change):
    mapping = next(iter(es.client.indices.get_mapping.return_value.values()))["mappings"]
    mapping["properties"]["vector"].update(change)
    with pytest.raises(VectorStoreUnavailableError, match="incompatible"):
        execute_vector_request(es, request("upsert", points=[POINT]))
    es.client.bulk.assert_not_called()
    es.client.indices.create.assert_not_called()


def test_elasticsearch_dimension_cap_fails_before_native_io(es):
    scope = {**SCOPE, "dimension": 4097}
    with pytest.raises(VectorStoreUnavailableError, match="4096"):
        execute_vector_request(es, VectorRequest(operation="get", scope=VectorScope(**scope), ids=[A]))
    es.client.indices.get_mapping.assert_not_called()


@pytest.mark.parametrize("result", [{"items": []}, {"items": [{"index": {"status": 429}}]}])
def test_elasticsearch_partial_write_is_not_success(es, result):
    es.client.bulk.return_value = result
    with pytest.raises(VectorStoreUnavailableError, match="acknowledged"):
        execute_vector_request(es, request("upsert", points=[POINT]))


@pytest.mark.parametrize("result", [{"docs": []}, {"docs": [{"error": "shard unavailable"}]}])
def test_elasticsearch_partial_read_is_not_missing_data(es, result):
    es.client.mget.return_value = result
    with pytest.raises(VectorStoreUnavailableError, match="incomplete"):
        execute_vector_request(es, request("get", ids=[A]))


@pytest.mark.parametrize("failure", [{"timed_out": True}, {"_shards": {"failed": 1}}])
def test_elasticsearch_partial_search_is_not_success(es, failure):
    es.client.search.return_value = failure
    with pytest.raises(VectorStoreUnavailableError, match="incomplete"):
        execute_vector_request(es, request("search", ids=[A], query_vector=[1, 0]))


@pytest.mark.parametrize("status", [200, 404])
def test_elasticsearch_deletion_requires_visible_absence(es, status):
    es.client.bulk.return_value = {"items": [{"delete": {"status": status}}]}
    es.client.mget.return_value = {"docs": [{"_id": A, "found": False}]}
    execute_vector_request(es, request("delete", ids=[A]))
    es.client.mget.return_value = {
        "docs": [{"_id": A, "found": True, "_source": {k: v for k, v in POINT.items() if k != "id"}}]
    }
    with pytest.raises(VectorStoreUnavailableError, match="not yet visible"):
        execute_vector_request(es, request("delete", ids=[A]))


@pytest.mark.parametrize(
    ("host", "expected"),
    [
        ("elastic.internal", "http://elastic.internal:9200"),
        ("https://host:9243", "https://host:9243"),
        ("http://[::1]:9201", "http://[::1]:9201"),
    ],
)
def test_elasticsearch_uses_dify_config_and_closes_on_failure(config_overrides, host, expected):
    config_overrides(
        VECTOR_STORE="elasticsearch",
        ELASTICSEARCH_HOST=host,
        ELASTICSEARCH_USE_CLOUD=False,
        ELASTICSEARCH_CA_CERTS="/ca.pem",
        ELASTICSEARCH_VERIFY_CERTS=True,
    )
    with patch("elasticsearch.Elasticsearch") as native:
        with pytest.raises(RuntimeError):
            fail_with_configured_store(ElasticsearchVectorStore)
        assert native.call_args.kwargs["hosts"] == [expected]
        assert native.call_args.kwargs["request_timeout"] == 60
        assert native.call_args.kwargs["max_retries"] == 2
        if expected.startswith("https"):
            assert native.call_args.kwargs["ca_certs"] == "/ca.pem"
        native.return_value.close.assert_called_once()


def test_elasticsearch_cloud_key_and_missing_endpoints(config_overrides):
    config_overrides(
        VECTOR_STORE="elasticsearch",
        ELASTICSEARCH_USE_CLOUD=True,
        ELASTICSEARCH_CLOUD_URL="https://cloud:443",
        ELASTICSEARCH_API_KEY="secret",
    )
    with patch("elasticsearch.Elasticsearch") as native:
        with configured_vector_client(A):
            assert native.call_args.kwargs["api_key"] == "secret"
            assert "basic_auth" not in native.call_args.kwargs
    config_overrides(ELASTICSEARCH_CLOUD_URL="")
    with pytest.raises(VectorStoreUnavailableError, match="endpoint"):
        ElasticsearchVectorStore.from_config()
    config_overrides(ELASTICSEARCH_USE_CLOUD=False, ELASTICSEARCH_HOST="")
    with pytest.raises(VectorStoreUnavailableError, match="endpoint"):
        ElasticsearchVectorStore.from_config()


@pytest.fixture
def weaviate():
    client = MagicMock()
    collection = client.collections.use.return_value.with_consistency_level.return_value
    collection.config.get.return_value = SimpleNamespace(
        description="KnowledgeFS v1; dimension=2; metric=cosine",
        vectorizer="none",
        vector_config=None,
        vector_index_config=SimpleNamespace(distance_metric=VectorDistances.COSINE),
        multi_tenancy_config=SimpleNamespace(enabled=False),
        properties=[SimpleNamespace(name=name, data_type=DataType.TEXT) for name in ("generation_id", "content_hash")],
    )
    collection.data.insert_many.return_value = SimpleNamespace(has_errors=False, uuids={0: A})
    collection.data.delete_many.return_value = SimpleNamespace(failed=0)
    collection.query.fetch_objects.return_value = SimpleNamespace(objects=[])
    return WeaviateVectorStore(client), collection


def test_weaviate_retry_readback_authorized_search_and_cosine(weaviate):
    store, collection = weaviate
    for _ in range(2):
        execute_vector_request(store, request("upsert", points=[POINT]))
    point = collection.data.insert_many.call_args.args[0][0]
    assert str(point.uuid) == A
    assert point.properties == {"generation_id": GENERATION, "content_hash": "a" * 64}
    obj = SimpleNamespace(
        uuid=A, properties=point.properties, vector={"default": [3, 4]}, metadata=SimpleNamespace(distance=0.4)
    )
    collection.query.fetch_objects.return_value = SimpleNamespace(objects=[obj])
    assert execute_vector_request(store, request("get", ids=[A]))["points"] == [POINT]
    collection.query.near_vector.return_value = SimpleNamespace(objects=[obj])
    result = execute_vector_request(store, request("search", ids=[A], query_vector=[1, 0]))
    assert result["matches"] == [{"id": A, "score": 0.6}]
    where = collection.query.near_vector.call_args.kwargs["filters"]
    assert where.target == "_id"
    assert where.value == [A]
    store.client.collections.use.return_value.with_consistency_level.assert_called_with(ConsistencyLevel.ALL)
    assert store.client.collections.use.call_args.args[0].startswith("Knowledgefs_v1_")


@pytest.mark.parametrize("race", [False, True])
def test_weaviate_create_or_compatible_race(weaviate, race):
    store, collection = weaviate
    store.client.collections.exists.side_effect = [False, True]
    if race:
        store.client.collections.create.side_effect = RuntimeError("concurrent create")
    execute_vector_request(store, request("upsert", points=[POINT]))
    assert store.client.collections.create.call_args.kwargs["description"].endswith("dimension=2; metric=cosine")
    collection.data.insert_many.assert_called_once()


def test_weaviate_failed_creation_is_not_hidden(weaviate):
    store, collection = weaviate
    store.client.collections.exists.return_value = False
    store.client.collections.create.side_effect = RuntimeError("creation failed")
    with pytest.raises(RuntimeError):
        execute_vector_request(store, request("upsert", points=[POINT]))
    collection.data.insert_many.assert_not_called()


@pytest.mark.parametrize("operation", ["search", "get", "delete"])
def test_weaviate_missing_collection_search_fails(weaviate, operation):
    store, collection = weaviate
    store.client.collections.exists.return_value = False
    payload = request(operation, ids=[A], **({"query_vector": [1, 0]} if operation == "search" else {}))
    if operation == "search":
        with pytest.raises(VectorStoreUnavailableError, match="missing"):
            execute_vector_request(store, payload)
    else:
        assert execute_vector_request(store, payload) == {"points": [], "matches": []}
    collection.data.insert_many.assert_not_called()


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("description", "wrong dimensions"),
        ("vectorizer", "text2vec-openai"),
        ("vector_config", {"named": {}}),
        ("vector_index_config", None),
        ("properties", []),
    ],
)
def test_weaviate_incompatible_schema_is_never_written(weaviate, field, value):
    store, collection = weaviate
    setattr(collection.config.get.return_value, field, value)
    with pytest.raises(VectorStoreUnavailableError, match="incompatible"):
        execute_vector_request(store, request("upsert", points=[POINT]))
    collection.data.insert_many.assert_not_called()


@pytest.mark.parametrize(
    "result", [SimpleNamespace(has_errors=True, uuids={}), SimpleNamespace(has_errors=False, uuids={})]
)
def test_weaviate_partial_batch_is_not_success(weaviate, result):
    store, collection = weaviate
    collection.data.insert_many.return_value = result
    with pytest.raises(VectorStoreUnavailableError, match="acknowledged"):
        execute_vector_request(store, request("upsert", points=[POINT]))


def test_weaviate_search_missing_distance_is_not_success(weaviate):
    store, collection = weaviate
    collection.query.near_vector.return_value = SimpleNamespace(
        objects=[SimpleNamespace(metadata=SimpleNamespace(distance=None))]
    )
    with pytest.raises(VectorStoreUnavailableError, match="omitted distance"):
        execute_vector_request(store, request("search", ids=[A], query_vector=[1, 0]))


def test_weaviate_delete_requires_ack_and_visible_absence(weaviate):
    store, collection = weaviate
    for _ in range(2):
        execute_vector_request(store, request("delete", ids=[A]))
    collection.data.delete_many.return_value.failed = 1
    with pytest.raises(VectorStoreUnavailableError, match="not yet visible"):
        execute_vector_request(store, request("delete", ids=[A]))
    collection.data.delete_many.return_value.failed = 0
    collection.query.fetch_objects.return_value.objects = [SimpleNamespace(uuid=A)]
    with pytest.raises(VectorStoreUnavailableError, match="not yet visible"):
        execute_vector_request(store, request("delete", ids=[A]))


@pytest.mark.parametrize(
    ("endpoint", "grpc", "secure", "port"),
    [
        ("http://host:8080", None, False, 50051),
        ("https://cloud", None, True, 443),
        ("http://host", "grpcs://rpc:443", True, 443),
        ("host", "rpc:50052", False, 50052),
    ],
)
def test_weaviate_config_and_resource_cleanup(config_overrides, endpoint, grpc, secure, port):
    config_overrides(
        VECTOR_STORE="weaviate", WEAVIATE_ENDPOINT=endpoint, WEAVIATE_GRPC_ENDPOINT=grpc, WEAVIATE_API_KEY="secret"
    )
    with patch("weaviate.connect_to_custom") as connect:
        with pytest.raises(RuntimeError):
            fail_with_configured_store(WeaviateVectorStore)
        assert connect.call_args.kwargs["grpc_secure"] is secure
        assert connect.call_args.kwargs["grpc_port"] == port
        connect.return_value.close.assert_called_once()


def test_weaviate_missing_and_invalid_endpoints(config_overrides):
    config_overrides(VECTOR_STORE="weaviate", WEAVIATE_ENDPOINT="")
    with pytest.raises(VectorStoreUnavailableError, match="endpoint"):
        WeaviateVectorStore.from_config()
    config_overrides(WEAVIATE_ENDPOINT="http://host", WEAVIATE_GRPC_ENDPOINT="https://wrong")
    with pytest.raises(VectorStoreUnavailableError, match="gRPC"):
        WeaviateVectorStore.from_config()
