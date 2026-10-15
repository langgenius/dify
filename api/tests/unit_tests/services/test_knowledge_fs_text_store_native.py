from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, cast

import pytest
from elastic_transport import ApiResponseMeta, HttpHeaders, NodeConfig
from elasticsearch import BadRequestError
from weaviate.classes.config import Configure, ConsistencyLevel, Tokenization

from services.knowledge_fs.text_store import TextScope, execute_text_request
from services.knowledge_fs.text_store_native import ElasticsearchTextStore, WeaviateTextStore
from services.knowledge_fs.vector_store import VectorStoreUnavailableError
from tests.unit_tests.services.test_knowledge_fs_text_store import SCOPE, A, point, request

if TYPE_CHECKING:
    from elasticsearch import Elasticsearch
    from weaviate import WeaviateClient

type FieldMappings = dict[str, dict[str, object]]
type IndexMapping = dict[str, dict[str, FieldMappings]]
type ElasticsearchBody = dict[str, object]


@dataclass
class FakeElasticsearchIndices:
    exists_result: bool = True
    mapping_result: dict[str, IndexMapping] = field(default_factory=dict)
    create_failure: Exception | None = None
    exists_calls: list[str] = field(default_factory=list)
    get_mapping_calls: list[str] = field(default_factory=list)
    create_calls: list[dict[str, object]] = field(default_factory=list)

    def exists(self, *, index: str) -> bool:
        self.exists_calls.append(index)
        return self.exists_result

    def create(self, *, index: str, mappings: dict[str, object]) -> None:
        self.create_calls.append({"index": index, "mappings": mappings})
        if self.create_failure is not None:
            raise self.create_failure

    def get_mapping(self, *, index: str) -> dict[str, IndexMapping]:
        self.get_mapping_calls.append(index)
        return self.mapping_result


@dataclass
class FakeElasticsearch:
    indices: FakeElasticsearchIndices = field(default_factory=FakeElasticsearchIndices)
    bulk_result: ElasticsearchBody = field(default_factory=dict)
    mget_result: ElasticsearchBody = field(default_factory=dict)
    search_result: ElasticsearchBody = field(default_factory=dict)
    bulk_calls: list[dict[str, object]] = field(default_factory=list)
    mget_calls: list[dict[str, object]] = field(default_factory=list)
    search_calls: list[dict[str, object]] = field(default_factory=list)

    def bulk(self, *, operations: list[dict[str, object]], refresh: str) -> ElasticsearchBody:
        self.bulk_calls.append({"operations": operations, "refresh": refresh})
        return self.bulk_result

    def mget(self, *, index: str, ids: list[str]) -> ElasticsearchBody:
        self.mget_calls.append({"index": index, "ids": ids})
        return self.mget_result

    def search(self, **kwargs: object) -> ElasticsearchBody:
        self.search_calls.append(kwargs)
        return self.search_result


@dataclass
class WeaviateMetadata:
    score: float | None = None


@dataclass
class WeaviateObject:
    uuid: str
    properties: Mapping[str, object] = field(default_factory=dict)
    metadata: WeaviateMetadata = field(default_factory=WeaviateMetadata)


@dataclass
class WeaviateQueryResult:
    objects: list[WeaviateObject] = field(default_factory=list)


@dataclass
class WeaviateInsertResult:
    has_errors: bool
    uuids: list[str]


@dataclass
class WeaviateDeleteResult:
    failed: int = 0


@dataclass
class WeaviateMultiTenancyConfig:
    enabled: bool


@dataclass
class WeaviateProperty:
    name: str
    tokenization: Tokenization


@dataclass
class WeaviateCollectionConfig:
    description: str
    multi_tenancy_config: WeaviateMultiTenancyConfig
    properties: list[WeaviateProperty]


@dataclass
class FakeWeaviateConfigAccessor:
    current: WeaviateCollectionConfig

    def get(self) -> WeaviateCollectionConfig:
        return self.current


@dataclass
class FakeWeaviateData:
    insert_result: WeaviateInsertResult
    delete_result: WeaviateDeleteResult = field(default_factory=WeaviateDeleteResult)
    insert_calls: list[list[object]] = field(default_factory=list)
    delete_calls: list[object] = field(default_factory=list)

    def insert_many(self, objects: list[object]) -> WeaviateInsertResult:
        self.insert_calls.append(objects)
        return self.insert_result

    def delete_many(self, *, where: object) -> WeaviateDeleteResult:
        self.delete_calls.append(where)
        return self.delete_result


@dataclass
class FakeWeaviateQuery:
    fetch_result: WeaviateQueryResult = field(default_factory=WeaviateQueryResult)
    bm25_result: WeaviateQueryResult = field(default_factory=WeaviateQueryResult)
    fetch_calls: list[dict[str, object]] = field(default_factory=list)
    bm25_calls: list[dict[str, object]] = field(default_factory=list)

    def fetch_objects(self, **kwargs: object) -> WeaviateQueryResult:
        self.fetch_calls.append(kwargs)
        return self.fetch_result

    def bm25(self, **kwargs: object) -> WeaviateQueryResult:
        self.bm25_calls.append(kwargs)
        return self.bm25_result


@dataclass
class FakeWeaviateCollection:
    config: FakeWeaviateConfigAccessor
    data: FakeWeaviateData
    query: FakeWeaviateQuery = field(default_factory=FakeWeaviateQuery)
    consistency_levels: list[ConsistencyLevel] = field(default_factory=list)

    def with_consistency_level(self, level: ConsistencyLevel) -> FakeWeaviateCollection:
        self.consistency_levels.append(level)
        return self


@dataclass
class FakeWeaviateCollections:
    """`exists` replays queued answers before falling back to `exists_result`."""

    collection: FakeWeaviateCollection
    exists_result: bool = True
    queued_exists: list[bool] = field(default_factory=list)
    create_failure: Exception | None = None
    exists_calls: list[str] = field(default_factory=list)
    create_calls: list[dict[str, object]] = field(default_factory=list)
    use_calls: list[str] = field(default_factory=list)

    def exists(self, name: str) -> bool:
        self.exists_calls.append(name)
        if self.queued_exists:
            return self.queued_exists.pop(0)
        return self.exists_result

    def create(self, **kwargs: object) -> None:
        self.create_calls.append(kwargs)
        if self.create_failure is not None:
            raise self.create_failure

    def use(self, name: str) -> FakeWeaviateCollection:
        self.use_calls.append(name)
        return self.collection


@dataclass
class FakeWeaviateClient:
    collections: FakeWeaviateCollections


type EsHarness = tuple[ElasticsearchTextStore, FakeElasticsearch]
type WeaviateHarness = tuple[WeaviateTextStore, FakeWeaviateClient, FakeWeaviateCollection]


@pytest.fixture
def es() -> EsHarness:
    client = FakeElasticsearch(
        indices=FakeElasticsearchIndices(
            mapping_result={
                TextScope.model_validate(SCOPE).collection_name: {
                    "mappings": {"properties": {"text": {"type": "text", "analyzer": "whitespace"}}}
                }
            }
        ),
        bulk_result={"items": [{"index": {"status": 201}}]},
        mget_result={"docs": [{"_id": A, "found": False}]},
        search_result={"hits": {"hits": [{"_id": A, "_score": 2.0}]}},
    )
    return ElasticsearchTextStore(cast("Elasticsearch", client)), client


def test_es_fulltext_uses_native_match_bm25_filtered_ids_and_refresh(es: EsHarness) -> None:
    store, client = es
    client.indices.exists_result = False
    execute_text_request(store, request("upsert", points=[point()]))
    client.indices.exists_result = True
    client.mget_result = {
        "docs": [{"_id": A, "found": True, "_source": {k: v for k, v in point().items() if k != "id"}}]
    }
    assert execute_text_request(store, request("get", ids=[A]))["points"] == [point()]
    assert execute_text_request(store, request("search", ids=[A], query="refund"))["matches"] == [
        {"id": A, "score": 2.0}
    ]
    args = client.search_calls[-1]
    assert args["query"] == {
        "bool": {
            "must": [{"match": {"text": {"query": "refund", "operator": "and"}}}],
            "filter": [{"ids": {"values": [A]}}],
        }
    }
    assert args["allow_partial_search_results"] is False
    assert client.bulk_calls[-1]["refresh"] == "wait_for"
    client.bulk_result = {"items": [{"delete": {"status": 200}}]}
    with pytest.raises(VectorStoreUnavailableError, match="not visible"):
        execute_text_request(store, request("delete", ids=[A]))
    client.mget_result = {"docs": [{"_id": A, "found": False}]}
    execute_text_request(store, request("delete", ids=[A]))


@pytest.mark.parametrize("problem", ["bulk", "schema", "read", "timed_out", "shards"])
def test_es_rejects_partial_results_and_wrong_schema(es: EsHarness, problem: str) -> None:
    store, client = es
    if problem == "bulk":
        client.bulk_result = {"items": [{"index": {"status": 500}}]}
        payload = request("upsert", points=[point()])
    elif problem == "schema":
        client.indices.mapping_result[TextScope.model_validate(SCOPE).collection_name]["mappings"]["properties"] = {}
        payload = request("get", ids=[A])
    elif problem == "read":
        client.mget_result = {"docs": [{"error": "unavailable"}]}
        payload = request("get", ids=[A])
    else:
        client.search_result.update({"timed_out": True} if problem == "timed_out" else {"_shards": {"failed": 1}})
        payload = request("search", ids=[A], query="refund")
    with pytest.raises(VectorStoreUnavailableError):
        execute_text_request(store, payload)


@pytest.mark.parametrize("name", ["resource_already_exists_exception", "denied"])
def test_es_creation_race_or_configuration_failure(es: EsHarness, name: str) -> None:
    store, client = es
    client.indices.exists_result = False
    client.indices.create_failure = BadRequestError(
        name, ApiResponseMeta(400, "1.1", HttpHeaders(), 0, NodeConfig("http", "localhost", 9200)), {"error": name}
    )
    if name == "denied":
        with pytest.raises(BadRequestError):
            execute_text_request(store, request("upsert", points=[point()]))
    else:
        execute_text_request(store, request("upsert", points=[point()]))


@pytest.fixture
def wv() -> WeaviateHarness:
    collection = FakeWeaviateCollection(
        config=FakeWeaviateConfigAccessor(
            current=WeaviateCollectionConfig(
                description="KnowledgeFS full-text v1; whitespace tokens; BM25",
                multi_tenancy_config=WeaviateMultiTenancyConfig(enabled=False),
                properties=[WeaviateProperty(name="text", tokenization=Tokenization.WHITESPACE)],
            )
        ),
        data=FakeWeaviateData(insert_result=WeaviateInsertResult(has_errors=False, uuids=[A])),
        query=FakeWeaviateQuery(
            bm25_result=WeaviateQueryResult(objects=[WeaviateObject(uuid=A, metadata=WeaviateMetadata(score=2.0))])
        ),
    )
    client = FakeWeaviateClient(collections=FakeWeaviateCollections(collection=collection))
    return WeaviateTextStore(cast("WeaviateClient", client)), client, collection


def test_weaviate_native_bm25_id_filter_retry_and_delete(wv: WeaviateHarness) -> None:
    store, client, collection = wv
    client.collections.exists_result = False
    execute_text_request(store, request("upsert", points=[point()]))
    assert client.collections.create_calls[-1]["vector_index_config"] == Configure.VectorIndex.none()
    client.collections.exists_result = True
    collection.query.fetch_result = WeaviateQueryResult(
        objects=[WeaviateObject(uuid=A, properties={k: v for k, v in point().items() if k != "id"})]
    )
    assert execute_text_request(store, request("get", ids=[A]))["points"] == [point()]
    assert execute_text_request(store, request("search", ids=[A], query="退 款"))["matches"] == [
        {"id": A, "score": 2.0}
    ]
    args = collection.query.bm25_calls[-1]
    assert args["query"] == "退 款"
    assert args["filters"] is not None
    with pytest.raises(VectorStoreUnavailableError, match="not visible"):
        execute_text_request(store, request("delete", ids=[A]))
    collection.query.fetch_result = WeaviateQueryResult(objects=[])
    execute_text_request(store, request("delete", ids=[A]))


@pytest.mark.parametrize("problem", ["schema", "insert", "score", "delete"])
def test_weaviate_rejects_incomplete_backend_results(wv: WeaviateHarness, problem: str) -> None:
    store, _client, collection = wv
    if problem == "schema":
        collection.config.current.description = "wrong"
        payload = request("get", ids=[A])
    elif problem == "insert":
        collection.data.insert_result.has_errors = True
        payload = request("upsert", points=[point()])
    elif problem == "score":
        collection.query.bm25_result.objects[0].metadata.score = None
        payload = request("search", ids=[A], query="refund")
    else:
        collection.data.delete_result.failed = 1
        payload = request("delete", ids=[A])
    with pytest.raises(VectorStoreUnavailableError):
        execute_text_request(store, payload)


@pytest.mark.parametrize("exists_after", [True, False])
def test_weaviate_creation_race(wv: WeaviateHarness, exists_after: bool) -> None:
    store, client, _collection = wv
    client.collections.queued_exists = [False, exists_after]
    client.collections.create_failure = RuntimeError("race")
    if exists_after:
        execute_text_request(store, request("upsert", points=[point()]))
    else:
        with pytest.raises(RuntimeError):
            execute_text_request(store, request("upsert", points=[point()]))


@pytest.mark.parametrize("backend", ["es", "wv"])
@pytest.mark.parametrize("operation", ["get", "delete", "search"])
def test_missing_native_fulltext_indexes_fail_closed_on_search(
    es: EsHarness, wv: WeaviateHarness, backend: str, operation: str
) -> None:
    if backend == "es":
        store, es_client = es
        es_client.indices.exists_result = False
    else:
        store, wv_client, _collection = wv
        wv_client.collections.exists_result = False
    payload = request(operation, ids=[A], **({"query": "refund"} if operation == "search" else {}))
    if operation == "search":
        with pytest.raises(VectorStoreUnavailableError, match="missing"):
            execute_text_request(store, payload)
    else:
        assert execute_text_request(store, payload) == {"points": [], "matches": []}
