from dataclasses import dataclass, field, replace
from typing import TYPE_CHECKING, cast
from unittest.mock import patch

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

if TYPE_CHECKING:
    from elasticsearch import Elasticsearch
    from weaviate import WeaviateClient

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


def es_mapping():
    return {
        "mappings": {
            "properties": {
                "vector": {"type": "dense_vector", "dims": 2, "index": True, "similarity": "cosine"},
                "generation_id": {"type": "keyword"},
                "content_hash": {"type": "keyword"},
            }
        }
    }


@dataclass
class FakeElasticsearchIndices:
    """Serves stored mappings per index; a missing index raises Elasticsearch's 404 error."""

    mappings: dict[str, dict] = field(default_factory=dict)
    queued_get_mapping_results: list[dict | Exception] = field(default_factory=list)
    create_failure: Exception | None = None
    get_mapping_calls: list[str] = field(default_factory=list)
    create_calls: list[dict[str, object]] = field(default_factory=list)

    def get_mapping(self, *, index):
        self.get_mapping_calls.append(index)
        if self.queued_get_mapping_results:
            result = self.queued_get_mapping_results.pop(0)
            if isinstance(result, Exception):
                raise result
            return result
        if index not in self.mappings:
            raise es_error(404, "missing")
        return {index: self.mappings[index]}

    def create(self, *, index, mappings):
        self.create_calls.append({"index": index, "mappings": mappings})
        if self.create_failure is not None:
            raise self.create_failure


@dataclass
class FakeElasticsearch:
    indices: FakeElasticsearchIndices = field(default_factory=FakeElasticsearchIndices)
    bulk_result: dict = field(default_factory=lambda: {"items": [{"index": {"status": 201}}]})
    mget_result: dict = field(default_factory=lambda: {"docs": []})
    search_result: dict = field(default_factory=lambda: {"hits": {"hits": []}})
    bulk_calls: list[dict] = field(default_factory=list)
    mget_calls: list[dict] = field(default_factory=list)
    search_calls: list[dict] = field(default_factory=list)
    close_count: int = 0

    def bulk(self, *, operations, refresh):
        self.bulk_calls.append({"operations": operations, "refresh": refresh})
        return self.bulk_result

    def mget(self, *, index, ids):
        self.mget_calls.append({"index": index, "ids": ids})
        return self.mget_result

    def search(self, **kwargs):
        self.search_calls.append(kwargs)
        return self.search_result

    def close(self):
        self.close_count += 1


@pytest.fixture
def es():
    scope = VectorScope.model_validate(SCOPE)
    client = FakeElasticsearch()
    client.indices.mappings = {name: es_mapping() for name in (scope.collection_name, scope.legacy_collection_name)}
    return ElasticsearchVectorStore(cast("Elasticsearch", client)), client


def test_elasticsearch_retry_write_readback_filter_and_cosine(es):
    es, client = es
    for _ in range(2):
        execute_vector_request(es, request("upsert", points=[POINT]))
    write = client.bulk_calls[-1]
    assert write["operations"][0]["index"]["_id"] == A
    assert write["operations"][0]["index"]["_index"] == VectorScope.model_validate(SCOPE).collection_name
    assert write["operations"][1] == {key: val for key, val in POINT.items() if key != "id"}
    assert write["refresh"] == "wait_for"
    client.mget_result = {"docs": [{"_id": A, "found": True, "_source": write["operations"][1]}]}
    assert execute_vector_request(es, request("get", ids=[A]))["points"] == [POINT]
    client.search_result = {"hits": {"hits": [{"_id": A, "_score": 0.8}]}}
    matches = execute_vector_request(es, request("search", ids=[A], query_vector=[1, 0]))["matches"]
    assert matches[0]["score"] == pytest.approx(0.6)
    search = client.search_calls[-1]
    assert search["knn"]["filter"] == {"ids": {"values": [A]}}
    assert search["allow_partial_search_results"] is False


@pytest.mark.parametrize("operation", ["get", "search", "delete"])
@pytest.mark.parametrize("names", ["legacy", "current", "both"])
def test_elasticsearch_names_preserve_existing_vectors_and_cleanup(es, operation, names):
    es, client = es
    scope = VectorScope.model_validate(SCOPE)
    available = {
        name: mapping
        for name, mapping in client.indices.mappings.items()
        if names == "both" or name == (scope.legacy_collection_name if names == "legacy" else scope.collection_name)
    }
    client.indices.mappings = available
    client.mget_result = {
        "docs": [{"_id": A, "found": operation != "delete", "_source": {k: v for k, v in POINT.items() if k != "id"}}]
    }
    client.search_result = {"hits": {"hits": [{"_id": A, "_score": 1.0}]}}
    client.bulk_result = {"items": [{"delete": {"status": 200}}]}
    result = execute_vector_request(
        es, request(operation, ids=[A], **({"query_vector": [1, 0], "limit": 1} if operation == "search" else {}))
    )
    assert result == {
        "points": [POINT] if operation == "get" else [],
        "matches": [{"id": A, "score": 1.0}] if operation == "search" else [],
    }
    if operation == "delete":
        assert {call["operations"][0]["delete"]["_index"] for call in client.bulk_calls} == set(available)
    else:
        calls = client.mget_calls if operation == "get" else client.search_calls
        assert {call["index"] for call in calls} == set(available)
    assert client.indices.create_calls == []


@pytest.mark.parametrize("race", [False, True])
def test_elasticsearch_first_writer_or_compatible_creation_race(es, race):
    es, client = es
    mapping = dict(client.indices.mappings)
    client.indices.queued_get_mapping_results = [es_error(404, "index_not_found_exception"), mapping]
    if race:
        client.indices.create_failure = es_error(400, "resource_already_exists_exception")
    execute_vector_request(es, request("upsert", points=[POINT]))
    created = client.indices.create_calls[-1]["mappings"]
    assert created["properties"]["vector"]["index_options"] == {"type": "hnsw"}
    assert created["dynamic"] == "strict"


def test_elasticsearch_creation_error_does_not_hide_configuration_failure(es):
    es, client = es
    client.indices.mappings = {}
    client.indices.create_failure = es_error(400, "mapper_parsing_exception")
    with pytest.raises(BadRequestError):
        execute_vector_request(es, request("upsert", points=[POINT]))
    assert client.bulk_calls == []


@pytest.mark.parametrize("operation", ["search", "get", "delete"])
def test_elasticsearch_missing_index_is_explicit_for_search(es, operation):
    es, client = es
    client.indices.mappings = {}
    payload = request(operation, ids=[A], **({"query_vector": [1, 0]} if operation == "search" else {}))
    if operation == "search":
        with pytest.raises(VectorStoreUnavailableError, match="missing"):
            execute_vector_request(es, payload)
    else:
        assert execute_vector_request(es, payload) == {"points": [], "matches": []}
    assert client.indices.create_calls == []


@pytest.mark.parametrize("change", [{"dims": 3}, {"similarity": "l2_norm"}, {"index": False}, {"element_type": "byte"}])
def test_elasticsearch_incompatible_index_is_never_overwritten(es, change):
    es, client = es
    mapping = next(iter(client.indices.mappings.values()))["mappings"]
    mapping["properties"]["vector"].update(change)
    with pytest.raises(VectorStoreUnavailableError, match="incompatible"):
        execute_vector_request(es, request("upsert", points=[POINT]))
    assert client.bulk_calls == []
    assert client.indices.create_calls == []


def test_elasticsearch_dimension_cap_fails_before_native_io(es):
    es, client = es
    scope = {**SCOPE, "dimension": 4097}
    with pytest.raises(VectorStoreUnavailableError, match="4096"):
        execute_vector_request(es, VectorRequest(operation="get", scope=VectorScope(**scope), ids=[A]))
    assert client.indices.get_mapping_calls == []


@pytest.mark.parametrize("result", [{"items": []}, {"items": [{"index": {"status": 429}}]}])
def test_elasticsearch_partial_write_is_not_success(es, result):
    es, client = es
    client.bulk_result = result
    with pytest.raises(VectorStoreUnavailableError, match="acknowledged"):
        execute_vector_request(es, request("upsert", points=[POINT]))


@pytest.mark.parametrize("result", [{"docs": []}, {"docs": [{"error": "shard unavailable"}]}])
def test_elasticsearch_partial_read_is_not_missing_data(es, result):
    es, client = es
    client.mget_result = result
    with pytest.raises(VectorStoreUnavailableError, match="incomplete"):
        execute_vector_request(es, request("get", ids=[A]))


@pytest.mark.parametrize("failure", [{"timed_out": True}, {"_shards": {"failed": 1}}])
def test_elasticsearch_partial_search_is_not_success(es, failure):
    es, client = es
    client.search_result = failure
    with pytest.raises(VectorStoreUnavailableError, match="incomplete"):
        execute_vector_request(es, request("search", ids=[A], query_vector=[1, 0]))


@pytest.mark.parametrize("status", [200, 404])
def test_elasticsearch_deletion_requires_visible_absence(es, status):
    es, client = es
    client.bulk_result = {"items": [{"delete": {"status": status}}]}
    client.mget_result = {"docs": [{"_id": A, "found": False}]}
    execute_vector_request(es, request("delete", ids=[A]))
    client.mget_result = {"docs": [{"_id": A, "found": True, "_source": {k: v for k, v in POINT.items() if k != "id"}}]}
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


@dataclass
class WeaviateMetadata:
    distance: float | None = None


@dataclass
class WeaviateObject:
    uuid: str = A
    properties: dict[str, str] = field(default_factory=dict)
    vector: dict[str, list[float]] = field(default_factory=dict)
    metadata: WeaviateMetadata = field(default_factory=WeaviateMetadata)


@dataclass
class WeaviateQueryResult:
    objects: list[WeaviateObject] = field(default_factory=list)


@dataclass
class WeaviateInsertResult:
    has_errors: bool
    uuids: dict[int, str]


@dataclass
class WeaviateDeleteResult:
    failed: int = 0


@dataclass(frozen=True)
class WeaviateVectorIndexConfig:
    distance_metric: VectorDistances


@dataclass(frozen=True)
class WeaviateMultiTenancyConfig:
    enabled: bool


@dataclass(frozen=True)
class WeaviateProperty:
    name: str
    data_type: DataType


@dataclass(frozen=True)
class WeaviateCollectionConfig:
    description: str
    vectorizer: str
    vector_config: dict | None
    vector_index_config: WeaviateVectorIndexConfig | None
    multi_tenancy_config: WeaviateMultiTenancyConfig
    properties: list[WeaviateProperty]


@dataclass
class FakeWeaviateConfigAccessor:
    current: WeaviateCollectionConfig = field(
        default_factory=lambda: WeaviateCollectionConfig(
            description="KnowledgeFS v1; dimension=2; metric=cosine",
            vectorizer="none",
            vector_config=None,
            vector_index_config=WeaviateVectorIndexConfig(distance_metric=VectorDistances.COSINE),
            multi_tenancy_config=WeaviateMultiTenancyConfig(enabled=False),
            properties=[
                WeaviateProperty(name=name, data_type=DataType.TEXT) for name in ("generation_id", "content_hash")
            ],
        )
    )

    def get(self):
        return self.current


@dataclass
class FakeWeaviateData:
    insert_result: WeaviateInsertResult = field(
        default_factory=lambda: WeaviateInsertResult(has_errors=False, uuids={0: A})
    )
    delete_result: WeaviateDeleteResult = field(default_factory=WeaviateDeleteResult)
    insert_calls: list[list] = field(default_factory=list)
    delete_calls: list[object] = field(default_factory=list)

    def insert_many(self, objects):
        self.insert_calls.append(objects)
        return self.insert_result

    def delete_many(self, *, where):
        self.delete_calls.append(where)
        return self.delete_result


@dataclass
class FakeWeaviateQuery:
    fetch_result: WeaviateQueryResult = field(default_factory=WeaviateQueryResult)
    near_result: WeaviateQueryResult = field(default_factory=WeaviateQueryResult)
    fetch_calls: list[dict[str, object]] = field(default_factory=list)
    near_vector_calls: list[dict[str, object]] = field(default_factory=list)

    def fetch_objects(self, **kwargs):
        self.fetch_calls.append(kwargs)
        return self.fetch_result

    def near_vector(self, **kwargs):
        self.near_vector_calls.append(kwargs)
        return self.near_result


@dataclass
class FakeWeaviateCollection:
    config: FakeWeaviateConfigAccessor = field(default_factory=FakeWeaviateConfigAccessor)
    data: FakeWeaviateData = field(default_factory=FakeWeaviateData)
    query: FakeWeaviateQuery = field(default_factory=FakeWeaviateQuery)


@dataclass
class FakeWeaviateCollectionHandle:
    collection: FakeWeaviateCollection
    consistency_levels: list[ConsistencyLevel]

    def with_consistency_level(self, level):
        self.consistency_levels.append(level)
        return self.collection


@dataclass
class FakeWeaviateCollections:
    """Every collection exists unless `existing` or queued answers say otherwise."""

    collection: FakeWeaviateCollection = field(default_factory=FakeWeaviateCollection)
    existing: set[str] | None = None
    queued_exists: list[bool] = field(default_factory=list)
    create_failure: Exception | None = None
    exists_calls: list[str] = field(default_factory=list)
    create_calls: list[dict[str, object]] = field(default_factory=list)
    use_calls: list[str] = field(default_factory=list)
    consistency_levels: list[ConsistencyLevel] = field(default_factory=list)

    def exists(self, name):
        self.exists_calls.append(name)
        if self.queued_exists:
            return self.queued_exists.pop(0)
        return self.existing is None or name in self.existing

    def create(self, **kwargs):
        self.create_calls.append(kwargs)
        if self.create_failure is not None:
            raise self.create_failure

    def use(self, name):
        self.use_calls.append(name)
        return FakeWeaviateCollectionHandle(collection=self.collection, consistency_levels=self.consistency_levels)


@dataclass
class FakeWeaviateClient:
    collections: FakeWeaviateCollections = field(default_factory=FakeWeaviateCollections)
    close_count: int = 0

    def close(self):
        self.close_count += 1


@pytest.fixture
def weaviate():
    client = FakeWeaviateClient()
    return WeaviateVectorStore(cast("WeaviateClient", client)), client, client.collections.collection


def test_weaviate_retry_readback_authorized_search_and_cosine(weaviate):
    store, client, collection = weaviate
    for _ in range(2):
        execute_vector_request(store, request("upsert", points=[POINT]))
    name = VectorScope.model_validate(SCOPE).collection_name
    assert client.collections.use_calls[-1] == name[0].upper() + name[1:]
    assert store.collection_name(VectorScope.model_validate(SCOPE)) == client.collections.use_calls[-1]
    point = collection.data.insert_calls[-1][0]
    assert str(point.uuid) == A
    assert point.properties == {"generation_id": GENERATION, "content_hash": "a" * 64}
    obj = WeaviateObject(
        uuid=A, properties=point.properties, vector={"default": [3, 4]}, metadata=WeaviateMetadata(distance=0.4)
    )
    collection.query.fetch_result = WeaviateQueryResult(objects=[obj])
    assert execute_vector_request(store, request("get", ids=[A]))["points"] == [POINT]
    collection.query.near_result = WeaviateQueryResult(objects=[obj])
    result = execute_vector_request(store, request("search", ids=[A], query_vector=[1, 0]))
    assert result["matches"] == [{"id": A, "score": 0.6}]
    where = collection.query.near_vector_calls[-1]["filters"]
    assert where.target == "_id"
    assert where.value == [A]
    assert client.collections.consistency_levels[-1] == ConsistencyLevel.ALL
    assert client.collections.use_calls[-1].startswith("Knowledgefs_v1_")


@pytest.mark.parametrize("operation", ["get", "search", "delete"])
@pytest.mark.parametrize("names", ["legacy", "current", "both"])
def test_weaviate_names_preserve_existing_vectors_and_cleanup(weaviate, operation, names):
    store, client, collection = weaviate
    scope = VectorScope.model_validate(SCOPE)
    available = {
        name[0].upper() + name[1:]
        for name in (scope.collection_name, scope.legacy_collection_name)
        if names == "both" or name == (scope.legacy_collection_name if names == "legacy" else scope.collection_name)
    }
    client.collections.existing = available
    obj = WeaviateObject(
        uuid=A,
        properties={k: v for k, v in POINT.items() if k not in {"id", "vector"}},
        vector={"default": [3, 4]},
        metadata=WeaviateMetadata(distance=0.0),
    )
    collection.query.fetch_result = WeaviateQueryResult(objects=[] if operation == "delete" else [obj])
    collection.query.near_result = WeaviateQueryResult(objects=[obj])
    result = execute_vector_request(
        store, request(operation, ids=[A], **({"query_vector": [1, 0], "limit": 1} if operation == "search" else {}))
    )
    assert result == {
        "points": [POINT] if operation == "get" else [],
        "matches": [{"id": A, "score": 1.0}] if operation == "search" else [],
    }
    assert set(client.collections.use_calls) == available
    if operation == "delete":
        assert len(collection.data.delete_calls) == len(available)
    assert client.collections.create_calls == []


@pytest.mark.parametrize("race", [False, True])
def test_weaviate_create_or_compatible_race(weaviate, race):
    store, client, collection = weaviate
    client.collections.queued_exists = [False, True]
    if race:
        client.collections.create_failure = RuntimeError("concurrent create")
    execute_vector_request(store, request("upsert", points=[POINT]))
    description = client.collections.create_calls[-1]["description"]
    assert isinstance(description, str)
    assert description.endswith("dimension=2; metric=cosine")
    assert len(collection.data.insert_calls) == 1


def test_weaviate_failed_creation_is_not_hidden(weaviate):
    store, client, collection = weaviate
    client.collections.existing = set()
    client.collections.create_failure = RuntimeError("creation failed")
    with pytest.raises(RuntimeError):
        execute_vector_request(store, request("upsert", points=[POINT]))
    assert collection.data.insert_calls == []


@pytest.mark.parametrize("operation", ["search", "get", "delete"])
def test_weaviate_missing_collection_search_fails(weaviate, operation):
    store, client, collection = weaviate
    client.collections.existing = set()
    payload = request(operation, ids=[A], **({"query_vector": [1, 0]} if operation == "search" else {}))
    if operation == "search":
        with pytest.raises(VectorStoreUnavailableError, match="missing"):
            execute_vector_request(store, payload)
    else:
        assert execute_vector_request(store, payload) == {"points": [], "matches": []}
    assert collection.data.insert_calls == []


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
    store, client, collection = weaviate
    collection.config.current = replace(collection.config.current, **{field: value})
    with pytest.raises(VectorStoreUnavailableError, match="incompatible"):
        execute_vector_request(store, request("upsert", points=[POINT]))
    assert collection.data.insert_calls == []


@pytest.mark.parametrize(
    "result", [WeaviateInsertResult(has_errors=True, uuids={}), WeaviateInsertResult(has_errors=False, uuids={})]
)
def test_weaviate_partial_batch_is_not_success(weaviate, result):
    store, client, collection = weaviate
    collection.data.insert_result = result
    with pytest.raises(VectorStoreUnavailableError, match="acknowledged"):
        execute_vector_request(store, request("upsert", points=[POINT]))


def test_weaviate_search_missing_distance_is_not_success(weaviate):
    store, client, collection = weaviate
    collection.query.near_result = WeaviateQueryResult(
        objects=[WeaviateObject(metadata=WeaviateMetadata(distance=None))]
    )
    with pytest.raises(VectorStoreUnavailableError, match="omitted distance"):
        execute_vector_request(store, request("search", ids=[A], query_vector=[1, 0]))


def test_weaviate_delete_requires_ack_and_visible_absence(weaviate):
    store, client, collection = weaviate
    for _ in range(2):
        execute_vector_request(store, request("delete", ids=[A]))
    collection.data.delete_result.failed = 1
    with pytest.raises(VectorStoreUnavailableError, match="not yet visible"):
        execute_vector_request(store, request("delete", ids=[A]))
    collection.data.delete_result.failed = 0
    collection.query.fetch_result.objects = [WeaviateObject(uuid=A)]
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
