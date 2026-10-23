from __future__ import annotations

from collections.abc import Callable, Iterator, Mapping
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, cast
from unittest.mock import patch

import pytest
from elastic_transport import ApiResponseMeta, HttpHeaders, NodeConfig
from elasticsearch import BadRequestError, NotFoundError
from pydantic import ValidationError
from weaviate.classes.config import ConsistencyLevel, DataType, VectorDistances
from weaviate.classes.data import DataObject
from weaviate.classes.query import Filter

from models.dataset import TidbAuthBinding
from models.enums import TidbAuthBindingStatus
from services.knowledge_fs.vector_store import (
    TIDB_POINT_ID_FIELD,
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

_KNOWLEDGE_FS_VECTOR_BACKENDS_A, _KNOWLEDGE_FS_VECTOR_BACKENDS_B, _KNOWLEDGE_FS_VECTOR_BACKENDS_GENERATION = (
    f"00000000-0000-4000-8000-{n:012d}" for n in (1, 2, 3)
)
_KNOWLEDGE_FS_VECTOR_BACKENDS_SCOPE: dict[str, object] = {
    "tenant_id": _KNOWLEDGE_FS_VECTOR_BACKENDS_A,
    "knowledge_space_id": _KNOWLEDGE_FS_VECTOR_BACKENDS_B,
    "vector_space_id": "test",
    "kind": "dense",
    "dimension": 2,
}
POINT: dict[str, object] = {
    "id": _KNOWLEDGE_FS_VECTOR_BACKENDS_A,
    "generation_id": _KNOWLEDGE_FS_VECTOR_BACKENDS_GENERATION,
    "content_hash": "a" * 64,
    "vector": [3, 4],
}

type FieldMappings = dict[str, dict[str, object]]
type IndexMapping = dict[str, dict[str, FieldMappings]]
type ElasticsearchBody = dict[str, object]
type WeaviatePoint = DataObject[dict[str, str], None]


def _knowledge_fs_vector_backends_request(operation: str, **kwargs: object) -> VectorRequest:
    return VectorRequest.model_validate(
        {"operation": operation, "scope": _KNOWLEDGE_FS_VECTOR_BACKENDS_SCOPE, **kwargs}
    )


def fail_with_configured_store(expected: type[ElasticsearchVectorStore] | type[WeaviateVectorStore]) -> None:
    with configured_vector_client(_KNOWLEDGE_FS_VECTOR_BACKENDS_A) as store:
        assert isinstance(store, expected)
        raise RuntimeError("failure")


def es_error(status: int, name: str) -> NotFoundError | BadRequestError:
    meta = ApiResponseMeta(status, "1.1", HttpHeaders(), 0, NodeConfig("http", "localhost", 9200))
    return (NotFoundError if status == 404 else BadRequestError)(name, meta, {"error": name})


def es_mapping() -> IndexMapping:
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

    mappings: dict[str, IndexMapping] = field(default_factory=dict)
    queued_get_mapping_results: list[dict[str, IndexMapping] | Exception] = field(default_factory=list)
    create_failure: Exception | None = None
    get_mapping_calls: list[str] = field(default_factory=list)
    created_indexes: list[str] = field(default_factory=list)
    created_mappings: list[dict[str, object]] = field(default_factory=list)

    def get_mapping(self, *, index: str) -> dict[str, IndexMapping]:
        self.get_mapping_calls.append(index)
        if self.queued_get_mapping_results:
            result = self.queued_get_mapping_results.pop(0)
            if isinstance(result, Exception):
                raise result
            return result
        if index not in self.mappings:
            raise es_error(404, "missing")
        return {index: self.mappings[index]}

    def create(self, *, index: str, mappings: dict[str, object]) -> None:
        self.created_indexes.append(index)
        self.created_mappings.append(mappings)
        if self.create_failure is not None:
            raise self.create_failure


@dataclass(frozen=True)
class BulkCall:
    operations: list[dict[str, object]]
    refresh: str

    def target_indexes(self, action: str) -> set[object]:
        """Return the `_index` of every bulk action line of the given kind."""
        indexes: set[object] = set()
        for operation in self.operations:
            target = operation.get(action)
            if isinstance(target, dict):
                indexes.add(target.get("_index"))
        return indexes


@dataclass
class FakeElasticsearch:
    indices: FakeElasticsearchIndices = field(default_factory=FakeElasticsearchIndices)
    bulk_result: ElasticsearchBody = field(default_factory=lambda: {"items": [{"index": {"status": 201}}]})
    mget_result: ElasticsearchBody = field(default_factory=lambda: {"docs": list[object]()})
    search_result: ElasticsearchBody = field(default_factory=lambda: {"hits": {"hits": list[object]()}})
    bulk_calls: list[BulkCall] = field(default_factory=list)
    mget_calls: list[dict[str, object]] = field(default_factory=list)
    search_calls: list[dict[str, object]] = field(default_factory=list)
    close_count: int = 0

    def bulk(self, *, operations: list[dict[str, object]], refresh: str) -> ElasticsearchBody:
        self.bulk_calls.append(BulkCall(operations=operations, refresh=refresh))
        return self.bulk_result

    def mget(self, *, index: str, ids: list[str]) -> ElasticsearchBody:
        self.mget_calls.append({"index": index, "ids": ids})
        return self.mget_result

    def search(self, **kwargs: object) -> ElasticsearchBody:
        self.search_calls.append(kwargs)
        return self.search_result

    def close(self) -> None:
        self.close_count += 1


type EsHarness = tuple[ElasticsearchVectorStore, FakeElasticsearch]


@dataclass
class WeaviateMetadata:
    distance: float | None = None


@dataclass
class WeaviateObject:
    uuid: str = _KNOWLEDGE_FS_VECTOR_BACKENDS_A
    properties: Mapping[str, object] = field(default_factory=dict)
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


@dataclass
class WeaviateCollectionConfig:
    description: str
    vectorizer: str
    vector_config: dict[str, object] | None
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

    def get(self) -> WeaviateCollectionConfig:
        return self.current


@dataclass
class FakeWeaviateData:
    insert_result: WeaviateInsertResult = field(
        default_factory=lambda: WeaviateInsertResult(has_errors=False, uuids={0: _KNOWLEDGE_FS_VECTOR_BACKENDS_A})
    )
    delete_result: WeaviateDeleteResult = field(default_factory=WeaviateDeleteResult)
    insert_calls: list[list[WeaviatePoint]] = field(default_factory=list)
    delete_calls: list[object] = field(default_factory=list)

    def insert_many(self, objects: list[WeaviatePoint]) -> WeaviateInsertResult:
        self.insert_calls.append(objects)
        return self.insert_result

    def delete_many(self, *, where: object) -> WeaviateDeleteResult:
        self.delete_calls.append(where)
        return self.delete_result


@dataclass
class FakeWeaviateQuery:
    fetch_result: WeaviateQueryResult = field(default_factory=WeaviateQueryResult)
    near_result: WeaviateQueryResult = field(default_factory=WeaviateQueryResult)
    fetch_calls: list[dict[str, object]] = field(default_factory=list)
    near_vector_calls: list[dict[str, object]] = field(default_factory=list)

    def fetch_objects(self, **kwargs: object) -> WeaviateQueryResult:
        self.fetch_calls.append(kwargs)
        return self.fetch_result

    def near_vector(self, **kwargs: object) -> WeaviateQueryResult:
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

    def with_consistency_level(self, level: ConsistencyLevel) -> FakeWeaviateCollection:
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

    def exists(self, name: str) -> bool:
        self.exists_calls.append(name)
        if self.queued_exists:
            return self.queued_exists.pop(0)
        return self.existing is None or name in self.existing

    def create(self, **kwargs: object) -> None:
        self.create_calls.append(kwargs)
        if self.create_failure is not None:
            raise self.create_failure

    def use(self, name: str) -> FakeWeaviateCollectionHandle:
        self.use_calls.append(name)
        return FakeWeaviateCollectionHandle(collection=self.collection, consistency_levels=self.consistency_levels)


@dataclass
class FakeWeaviateClient:
    collections: FakeWeaviateCollections = field(default_factory=FakeWeaviateCollections)
    close_count: int = 0

    def close(self) -> None:
        self.close_count += 1


type WeaviateHarness = tuple[WeaviateVectorStore, FakeWeaviateClient, FakeWeaviateCollection]


class TestKnowledgeFsVectorBackendsCases:
    @staticmethod
    @pytest.fixture
    def es() -> EsHarness:
        scope = VectorScope.model_validate(_KNOWLEDGE_FS_VECTOR_BACKENDS_SCOPE)
        client = FakeElasticsearch()
        client.indices.mappings = {name: es_mapping() for name in (scope.collection_name, scope.legacy_collection_name)}
        return ElasticsearchVectorStore(cast("Elasticsearch", client)), client

    @staticmethod
    def test_elasticsearch_retry_write_readback_filter_and_cosine(es: EsHarness) -> None:
        store, client = es
        for _ in range(2):
            execute_vector_request(store, _knowledge_fs_vector_backends_request("upsert", points=[POINT]))
        write = client.bulk_calls[-1]
        assert write.operations[0] == {
            "index": {
                "_index": VectorScope.model_validate(_KNOWLEDGE_FS_VECTOR_BACKENDS_SCOPE).collection_name,
                "_id": _KNOWLEDGE_FS_VECTOR_BACKENDS_A,
            }
        }
        assert write.operations[1] == {key: val for key, val in POINT.items() if key != "id"}
        assert write.refresh == "wait_for"
        client.mget_result = {
            "docs": [{"_id": _KNOWLEDGE_FS_VECTOR_BACKENDS_A, "found": True, "_source": write.operations[1]}]
        }
        assert execute_vector_request(
            store, _knowledge_fs_vector_backends_request("get", ids=[_KNOWLEDGE_FS_VECTOR_BACKENDS_A])
        )["points"] == [POINT]
        client.search_result = {"hits": {"hits": [{"_id": _KNOWLEDGE_FS_VECTOR_BACKENDS_A, "_score": 0.8}]}}
        matches = execute_vector_request(
            store,
            _knowledge_fs_vector_backends_request("search", ids=[_KNOWLEDGE_FS_VECTOR_BACKENDS_A], query_vector=[1, 0]),
        )["matches"]
        assert matches[0]["score"] == pytest.approx(0.6)
        search = client.search_calls[-1]
        knn = search["knn"]
        assert isinstance(knn, dict)
        assert knn["filter"] == {"ids": {"values": [_KNOWLEDGE_FS_VECTOR_BACKENDS_A]}}
        assert search["allow_partial_search_results"] is False

    @staticmethod
    @pytest.mark.parametrize("operation", ["get", "search", "delete"])
    @pytest.mark.parametrize("names", ["legacy", "current", "both"])
    def test_elasticsearch_names_preserve_existing_vectors_and_cleanup(
        es: EsHarness, operation: str, names: str
    ) -> None:
        store, client = es
        scope = VectorScope.model_validate(_KNOWLEDGE_FS_VECTOR_BACKENDS_SCOPE)
        available = {
            name: mapping
            for name, mapping in client.indices.mappings.items()
            if names == "both" or name == (scope.legacy_collection_name if names == "legacy" else scope.collection_name)
        }
        client.indices.mappings = available
        client.mget_result = {
            "docs": [
                {
                    "_id": _KNOWLEDGE_FS_VECTOR_BACKENDS_A,
                    "found": operation != "delete",
                    "_source": {k: v for k, v in POINT.items() if k != "id"},
                }
            ]
        }
        client.search_result = {"hits": {"hits": [{"_id": _KNOWLEDGE_FS_VECTOR_BACKENDS_A, "_score": 1.0}]}}
        client.bulk_result = {"items": [{"delete": {"status": 200}}]}
        result = execute_vector_request(
            store,
            _knowledge_fs_vector_backends_request(
                operation,
                ids=[_KNOWLEDGE_FS_VECTOR_BACKENDS_A],
                **({"query_vector": [1, 0], "limit": 1} if operation == "search" else {}),
            ),
        )
        assert result == {
            "points": [POINT] if operation == "get" else [],
            "matches": [{"id": _KNOWLEDGE_FS_VECTOR_BACKENDS_A, "score": 1.0}] if operation == "search" else [],
        }
        if operation == "delete":
            assert set().union(*(call.target_indexes("delete") for call in client.bulk_calls)) == set(available)
        else:
            calls = client.mget_calls if operation == "get" else client.search_calls
            assert {call["index"] for call in calls} == set(available)
        assert client.indices.created_indexes == []

    @staticmethod
    @pytest.mark.parametrize("race", [False, True])
    def test_elasticsearch_first_writer_or_compatible_creation_race(es: EsHarness, race: bool) -> None:
        store, client = es
        mapping = dict(client.indices.mappings)
        client.indices.queued_get_mapping_results = [es_error(404, "index_not_found_exception"), mapping]
        if race:
            client.indices.create_failure = es_error(400, "resource_already_exists_exception")
        execute_vector_request(store, _knowledge_fs_vector_backends_request("upsert", points=[POINT]))
        created = client.indices.created_mappings[-1]
        properties = created["properties"]
        assert isinstance(properties, dict)
        assert properties["vector"]["index_options"] == {"type": "hnsw"}
        assert created["dynamic"] == "strict"

    @staticmethod
    def test_elasticsearch_creation_error_does_not_hide_configuration_failure(es: EsHarness) -> None:
        store, client = es
        client.indices.mappings = {}
        client.indices.create_failure = es_error(400, "mapper_parsing_exception")
        with pytest.raises(BadRequestError):
            execute_vector_request(store, _knowledge_fs_vector_backends_request("upsert", points=[POINT]))
        assert client.bulk_calls == []

    @staticmethod
    @pytest.mark.parametrize("operation", ["search", "get", "delete"])
    def test_elasticsearch_missing_index_is_explicit_for_search(es: EsHarness, operation: str) -> None:
        store, client = es
        client.indices.mappings = {}
        payload = _knowledge_fs_vector_backends_request(
            operation,
            ids=[_KNOWLEDGE_FS_VECTOR_BACKENDS_A],
            **({"query_vector": [1, 0]} if operation == "search" else {}),
        )
        if operation == "search":
            with pytest.raises(VectorStoreUnavailableError, match="missing"):
                execute_vector_request(store, payload)
        else:
            assert execute_vector_request(store, payload) == {"points": [], "matches": []}
        assert client.indices.created_indexes == []

    @staticmethod
    @pytest.mark.parametrize(
        "change", [{"dims": 3}, {"similarity": "l2_norm"}, {"index": False}, {"element_type": "byte"}]
    )
    def test_elasticsearch_incompatible_index_is_never_overwritten(es: EsHarness, change: dict[str, object]) -> None:
        store, client = es
        mapping = next(iter(client.indices.mappings.values()))["mappings"]
        mapping["properties"]["vector"].update(change)
        with pytest.raises(VectorStoreUnavailableError, match="incompatible"):
            execute_vector_request(store, _knowledge_fs_vector_backends_request("upsert", points=[POINT]))
        assert client.bulk_calls == []
        assert client.indices.created_indexes == []

    @staticmethod
    def test_elasticsearch_dimension_cap_fails_before_native_io(es: EsHarness) -> None:
        store, client = es
        scope = {**_KNOWLEDGE_FS_VECTOR_BACKENDS_SCOPE, "dimension": 4097}
        with pytest.raises(VectorStoreUnavailableError, match="4096"):
            execute_vector_request(
                store,
                VectorRequest(
                    operation="get", scope=VectorScope.model_validate(scope), ids=[_KNOWLEDGE_FS_VECTOR_BACKENDS_A]
                ),
            )
        assert client.indices.get_mapping_calls == []

    @staticmethod
    @pytest.mark.parametrize("result", [{"items": []}, {"items": [{"index": {"status": 429}}]}])
    def test_elasticsearch_partial_write_is_not_success(es: EsHarness, result: dict[str, object]) -> None:
        store, client = es
        client.bulk_result = result
        with pytest.raises(VectorStoreUnavailableError, match="acknowledged"):
            execute_vector_request(store, _knowledge_fs_vector_backends_request("upsert", points=[POINT]))

    @staticmethod
    @pytest.mark.parametrize("result", [{"docs": []}, {"docs": [{"error": "shard unavailable"}]}])
    def test_elasticsearch_partial_read_is_not_missing_data(es: EsHarness, result: dict[str, object]) -> None:
        store, client = es
        client.mget_result = result
        with pytest.raises(VectorStoreUnavailableError, match="incomplete"):
            execute_vector_request(
                store, _knowledge_fs_vector_backends_request("get", ids=[_KNOWLEDGE_FS_VECTOR_BACKENDS_A])
            )

    @staticmethod
    @pytest.mark.parametrize("failure", [{"timed_out": True}, {"_shards": {"failed": 1}}])
    def test_elasticsearch_partial_search_is_not_success(es: EsHarness, failure: dict[str, object]) -> None:
        store, client = es
        client.search_result = failure
        with pytest.raises(VectorStoreUnavailableError, match="incomplete"):
            execute_vector_request(
                store,
                _knowledge_fs_vector_backends_request(
                    "search", ids=[_KNOWLEDGE_FS_VECTOR_BACKENDS_A], query_vector=[1, 0]
                ),
            )

    @staticmethod
    @pytest.mark.parametrize("status", [200, 404])
    def test_elasticsearch_deletion_requires_visible_absence(es: EsHarness, status: int) -> None:
        store, client = es
        client.bulk_result = {"items": [{"delete": {"status": status}}]}
        client.mget_result = {"docs": [{"_id": _KNOWLEDGE_FS_VECTOR_BACKENDS_A, "found": False}]}
        execute_vector_request(
            store, _knowledge_fs_vector_backends_request("delete", ids=[_KNOWLEDGE_FS_VECTOR_BACKENDS_A])
        )
        client.mget_result = {
            "docs": [
                {
                    "_id": _KNOWLEDGE_FS_VECTOR_BACKENDS_A,
                    "found": True,
                    "_source": {k: v for k, v in POINT.items() if k != "id"},
                }
            ]
        }
        with pytest.raises(VectorStoreUnavailableError, match="not yet visible"):
            execute_vector_request(
                store, _knowledge_fs_vector_backends_request("delete", ids=[_KNOWLEDGE_FS_VECTOR_BACKENDS_A])
            )

    @staticmethod
    @pytest.mark.parametrize(
        ("host", "expected"),
        [
            ("elastic.internal", "http://elastic.internal:9200"),
            ("https://host:9243", "https://host:9243"),
            ("http://[::1]:9201", "http://[::1]:9201"),
        ],
    )
    def test_elasticsearch_uses_dify_config_and_closes_on_failure(
        config_overrides: Callable[..., None], host: str, expected: str
    ) -> None:
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

    @staticmethod
    def test_elasticsearch_cloud_key_and_missing_endpoints(config_overrides: Callable[..., None]) -> None:
        config_overrides(
            VECTOR_STORE="elasticsearch",
            ELASTICSEARCH_USE_CLOUD=True,
            ELASTICSEARCH_CLOUD_URL="https://cloud:443",
            ELASTICSEARCH_API_KEY="secret",
        )
        with patch("elasticsearch.Elasticsearch") as native:
            with configured_vector_client(_KNOWLEDGE_FS_VECTOR_BACKENDS_A):
                assert native.call_args.kwargs["api_key"] == "secret"
                assert "basic_auth" not in native.call_args.kwargs
        config_overrides(ELASTICSEARCH_CLOUD_URL="")
        with pytest.raises(VectorStoreUnavailableError, match="endpoint"):
            ElasticsearchVectorStore.from_config()
        config_overrides(ELASTICSEARCH_USE_CLOUD=False, ELASTICSEARCH_HOST="")
        with pytest.raises(VectorStoreUnavailableError, match="endpoint"):
            ElasticsearchVectorStore.from_config()

    @staticmethod
    @pytest.fixture
    def weaviate() -> WeaviateHarness:
        client = FakeWeaviateClient()
        return WeaviateVectorStore(cast("WeaviateClient", client)), client, client.collections.collection

    @staticmethod
    def test_weaviate_retry_readback_authorized_search_and_cosine(weaviate: WeaviateHarness) -> None:
        store, client, collection = weaviate
        for _ in range(2):
            execute_vector_request(store, _knowledge_fs_vector_backends_request("upsert", points=[POINT]))
        name = VectorScope.model_validate(_KNOWLEDGE_FS_VECTOR_BACKENDS_SCOPE).collection_name
        assert client.collections.use_calls[-1] == name[0].upper() + name[1:]
        assert (
            store.collection_name(VectorScope.model_validate(_KNOWLEDGE_FS_VECTOR_BACKENDS_SCOPE))
            == client.collections.use_calls[-1]
        )
        point = collection.data.insert_calls[-1][0]
        assert str(point.uuid) == _KNOWLEDGE_FS_VECTOR_BACKENDS_A
        assert point.properties == {"generation_id": _KNOWLEDGE_FS_VECTOR_BACKENDS_GENERATION, "content_hash": "a" * 64}
        obj = WeaviateObject(
            uuid=_KNOWLEDGE_FS_VECTOR_BACKENDS_A,
            properties=point.properties,
            vector={"default": [3, 4]},
            metadata=WeaviateMetadata(distance=0.4),
        )
        collection.query.fetch_result = WeaviateQueryResult(objects=[obj])
        assert execute_vector_request(
            store, _knowledge_fs_vector_backends_request("get", ids=[_KNOWLEDGE_FS_VECTOR_BACKENDS_A])
        )["points"] == [POINT]
        collection.query.near_result = WeaviateQueryResult(objects=[obj])
        result = execute_vector_request(
            store,
            _knowledge_fs_vector_backends_request("search", ids=[_KNOWLEDGE_FS_VECTOR_BACKENDS_A], query_vector=[1, 0]),
        )
        assert result["matches"] == [{"id": _KNOWLEDGE_FS_VECTOR_BACKENDS_A, "score": 0.6}]
        assert collection.query.near_vector_calls[-1]["filters"] == Filter.by_id().contains_any(
            [_KNOWLEDGE_FS_VECTOR_BACKENDS_A]
        )
        assert client.collections.consistency_levels[-1] == ConsistencyLevel.ALL
        assert client.collections.use_calls[-1].startswith("Knowledgefs_v1_")

    @staticmethod
    @pytest.mark.parametrize("operation", ["get", "search", "delete"])
    @pytest.mark.parametrize("names", ["legacy", "current", "both"])
    def test_weaviate_names_preserve_existing_vectors_and_cleanup(
        weaviate: WeaviateHarness, operation: str, names: str
    ) -> None:
        store, client, collection = weaviate
        scope = VectorScope.model_validate(_KNOWLEDGE_FS_VECTOR_BACKENDS_SCOPE)
        available = {
            name[0].upper() + name[1:]
            for name in (scope.collection_name, scope.legacy_collection_name)
            if names == "both" or name == (scope.legacy_collection_name if names == "legacy" else scope.collection_name)
        }
        client.collections.existing = available
        obj = WeaviateObject(
            uuid=_KNOWLEDGE_FS_VECTOR_BACKENDS_A,
            properties={k: v for k, v in POINT.items() if k not in {"id", "vector"}},
            vector={"default": [3, 4]},
            metadata=WeaviateMetadata(distance=0.0),
        )
        collection.query.fetch_result = WeaviateQueryResult(objects=[] if operation == "delete" else [obj])
        collection.query.near_result = WeaviateQueryResult(objects=[obj])
        result = execute_vector_request(
            store,
            _knowledge_fs_vector_backends_request(
                operation,
                ids=[_KNOWLEDGE_FS_VECTOR_BACKENDS_A],
                **({"query_vector": [1, 0], "limit": 1} if operation == "search" else {}),
            ),
        )
        assert result == {
            "points": [POINT] if operation == "get" else [],
            "matches": [{"id": _KNOWLEDGE_FS_VECTOR_BACKENDS_A, "score": 1.0}] if operation == "search" else [],
        }
        assert set(client.collections.use_calls) == available
        if operation == "delete":
            assert len(collection.data.delete_calls) == len(available)
        assert client.collections.create_calls == []

    @staticmethod
    @pytest.mark.parametrize("race", [False, True])
    def test_weaviate_create_or_compatible_race(weaviate: WeaviateHarness, race: bool) -> None:
        store, client, collection = weaviate
        client.collections.queued_exists = [False, True]
        if race:
            client.collections.create_failure = RuntimeError("concurrent create")
        execute_vector_request(store, _knowledge_fs_vector_backends_request("upsert", points=[POINT]))
        description = client.collections.create_calls[-1]["description"]
        assert isinstance(description, str)
        assert description.endswith("dimension=2; metric=cosine")
        assert len(collection.data.insert_calls) == 1

    @staticmethod
    def test_weaviate_failed_creation_is_not_hidden(weaviate: WeaviateHarness) -> None:
        store, client, collection = weaviate
        client.collections.existing = set()
        client.collections.create_failure = RuntimeError("creation failed")
        with pytest.raises(RuntimeError):
            execute_vector_request(store, _knowledge_fs_vector_backends_request("upsert", points=[POINT]))
        assert collection.data.insert_calls == []

    @staticmethod
    @pytest.mark.parametrize("operation", ["search", "get", "delete"])
    def test_weaviate_missing_collection_search_fails(weaviate: WeaviateHarness, operation: str) -> None:
        store, client, collection = weaviate
        client.collections.existing = set()
        payload = _knowledge_fs_vector_backends_request(
            operation,
            ids=[_KNOWLEDGE_FS_VECTOR_BACKENDS_A],
            **({"query_vector": [1, 0]} if operation == "search" else {}),
        )
        if operation == "search":
            with pytest.raises(VectorStoreUnavailableError, match="missing"):
                execute_vector_request(store, payload)
        else:
            assert execute_vector_request(store, payload) == {"points": [], "matches": []}
        assert collection.data.insert_calls == []

    @staticmethod
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
    def test_weaviate_incompatible_schema_is_never_written(
        weaviate: WeaviateHarness, field: str, value: object
    ) -> None:
        store, client, collection = weaviate
        setattr(collection.config.current, field, value)
        with pytest.raises(VectorStoreUnavailableError, match="incompatible"):
            execute_vector_request(store, _knowledge_fs_vector_backends_request("upsert", points=[POINT]))
        assert collection.data.insert_calls == []

    @staticmethod
    @pytest.mark.parametrize(
        "result", [WeaviateInsertResult(has_errors=True, uuids={}), WeaviateInsertResult(has_errors=False, uuids={})]
    )
    def test_weaviate_partial_batch_is_not_success(weaviate: WeaviateHarness, result: WeaviateInsertResult) -> None:
        store, client, collection = weaviate
        collection.data.insert_result = result
        with pytest.raises(VectorStoreUnavailableError, match="acknowledged"):
            execute_vector_request(store, _knowledge_fs_vector_backends_request("upsert", points=[POINT]))

    @staticmethod
    def test_weaviate_search_missing_distance_is_not_success(weaviate: WeaviateHarness) -> None:
        store, client, collection = weaviate
        collection.query.near_result = WeaviateQueryResult(
            objects=[WeaviateObject(metadata=WeaviateMetadata(distance=None))]
        )
        with pytest.raises(VectorStoreUnavailableError, match="omitted distance"):
            execute_vector_request(
                store,
                _knowledge_fs_vector_backends_request(
                    "search", ids=[_KNOWLEDGE_FS_VECTOR_BACKENDS_A], query_vector=[1, 0]
                ),
            )

    @staticmethod
    def test_weaviate_delete_requires_ack_and_visible_absence(weaviate: WeaviateHarness) -> None:
        store, client, collection = weaviate
        for _ in range(2):
            execute_vector_request(
                store, _knowledge_fs_vector_backends_request("delete", ids=[_KNOWLEDGE_FS_VECTOR_BACKENDS_A])
            )
        collection.data.delete_result.failed = 1
        with pytest.raises(VectorStoreUnavailableError, match="not yet visible"):
            execute_vector_request(
                store, _knowledge_fs_vector_backends_request("delete", ids=[_KNOWLEDGE_FS_VECTOR_BACKENDS_A])
            )
        collection.data.delete_result.failed = 0
        collection.query.fetch_result.objects = [WeaviateObject(uuid=_KNOWLEDGE_FS_VECTOR_BACKENDS_A)]
        with pytest.raises(VectorStoreUnavailableError, match="not yet visible"):
            execute_vector_request(
                store, _knowledge_fs_vector_backends_request("delete", ids=[_KNOWLEDGE_FS_VECTOR_BACKENDS_A])
            )

    @staticmethod
    @pytest.mark.parametrize(
        ("endpoint", "grpc", "secure", "port"),
        [
            ("http://host:8080", None, False, 50051),
            ("https://cloud", None, True, 443),
            ("http://host", "grpcs://rpc:443", True, 443),
            ("host", "rpc:50052", False, 50052),
        ],
    )
    def test_weaviate_config_and_resource_cleanup(
        config_overrides: Callable[..., None], endpoint: str, grpc: str | None, secure: bool, port: int
    ) -> None:
        config_overrides(
            VECTOR_STORE="weaviate", WEAVIATE_ENDPOINT=endpoint, WEAVIATE_GRPC_ENDPOINT=grpc, WEAVIATE_API_KEY="secret"
        )
        with patch("weaviate.connect_to_custom") as connect:
            with pytest.raises(RuntimeError):
                fail_with_configured_store(WeaviateVectorStore)
            assert connect.call_args.kwargs["grpc_secure"] is secure
            assert connect.call_args.kwargs["grpc_port"] == port
            connect.return_value.close.assert_called_once()

    @staticmethod
    def test_weaviate_missing_and_invalid_endpoints(config_overrides: Callable[..., None]) -> None:
        config_overrides(VECTOR_STORE="weaviate", WEAVIATE_ENDPOINT="")
        with pytest.raises(VectorStoreUnavailableError, match="endpoint"):
            WeaviateVectorStore.from_config()
        config_overrides(WEAVIATE_ENDPOINT="http://host", WEAVIATE_GRPC_ENDPOINT="https://wrong")
        with pytest.raises(VectorStoreUnavailableError, match="gRPC"):
            WeaviateVectorStore.from_config()


if TYPE_CHECKING:
    from qdrant_client import QdrantClient as QdrantClientType
    from qdrant_client.http.models import CollectionInfo, FilterSelector, PointIdsList, PointStruct

    from services.knowledge_fs.vector_store import VectorResult

QdrantClient = pytest.importorskip("qdrant_client").QdrantClient
models = pytest.importorskip("qdrant_client.http.models")
UnexpectedResponse = pytest.importorskip("qdrant_client.http.exceptions").UnexpectedResponse

TENANT = "018f0d60-7a49-7cc2-9c1b-5b36f18f0001"
SPACE = "018f0d60-7a49-7cc2-9c1b-5b36f18f0002"
_KNOWLEDGE_FS_VECTOR_STORE_GENERATION = "018f0d60-7a49-7cc2-9c1b-5b36f18f0003"
_KNOWLEDGE_FS_VECTOR_STORE_A = "018f0d60-7a49-7cc2-9c1b-5b36f18f0004"
_KNOWLEDGE_FS_VECTOR_STORE_B = "018f0d60-7a49-7cc2-9c1b-5b36f18f0005"
_KNOWLEDGE_FS_VECTOR_STORE_SCOPE: dict[str, object] = {
    "tenant_id": TENANT,
    "knowledge_space_id": SPACE,
    "vector_space_id": "embedding-v1",
    "kind": "dense",
    "dimension": 2,
}


@dataclass
class FakeQdrant:
    """Qdrant client surface used by the bridge; unknown collections raise the remote 404 contract."""

    collections: dict[str, CollectionInfo] = field(default_factory=dict)
    search_result: list[object] = field(default_factory=list)
    retrieve_result: list[object] = field(default_factory=list)
    retrieve_hook: Callable[..., list[object]] | None = None
    retrieve_failure: Exception | None = None
    delete_failure: Exception | None = None
    create_payload_index_hook: Callable[..., None] | None = None
    get_collection_calls: list[str] = field(default_factory=list)
    create_collection_calls: list[dict[str, object]] = field(default_factory=list)
    create_payload_index_calls: list[dict[str, object]] = field(default_factory=list)
    upsert_calls: list[dict[str, object]] = field(default_factory=list)
    upserted_points: list[list[PointStruct]] = field(default_factory=list)
    search_calls: list[dict[str, object]] = field(default_factory=list)
    retrieve_calls: list[dict[str, object]] = field(default_factory=list)
    delete_calls: list[dict[str, object]] = field(default_factory=list)
    delete_selectors: list[PointIdsList | FilterSelector] = field(default_factory=list)
    close_count: int = 0

    def execute(self, payload: VectorRequest) -> VectorResult:
        """Run the bridge against this fake through the Qdrant client contract."""
        return execute_vector_request(cast("QdrantClientType", self), payload)

    def get_collection(self, name: str) -> CollectionInfo:
        self.get_collection_calls.append(name)
        if name not in self.collections:
            raise UnexpectedResponse(404, "missing", b"{}", {})
        return self.collections[name]

    def create_collection(self, **kwargs: object) -> None:
        self.create_collection_calls.append(kwargs)

    def create_payload_index(self, **kwargs: object) -> None:
        self.create_payload_index_calls.append(kwargs)
        if self.create_payload_index_hook is not None:
            self.create_payload_index_hook(**kwargs)

    def upsert(self, *, collection_name: str, wait: bool, points: list[PointStruct]) -> None:
        self.upsert_calls.append({"collection_name": collection_name, "wait": wait, "points": points})
        self.upserted_points.append(points)

    def search(self, **kwargs: object) -> list[object]:
        self.search_calls.append(kwargs)
        return self.search_result

    def retrieve(self, **kwargs: object) -> list[object]:
        self.retrieve_calls.append(kwargs)
        if self.retrieve_failure is not None:
            raise self.retrieve_failure
        if self.retrieve_hook is not None:
            return self.retrieve_hook(**kwargs)
        return self.retrieve_result

    def delete(self, *, collection_name: str, points_selector: PointIdsList | FilterSelector, wait: bool) -> None:
        self.delete_calls.append({"collection_name": collection_name, "points_selector": points_selector, "wait": wait})
        self.delete_selectors.append(points_selector)
        if self.delete_failure is not None:
            raise self.delete_failure

    def close(self) -> None:
        self.close_count += 1


def _knowledge_fs_vector_store_request(operation: str, **kwargs: object) -> VectorRequest:
    return VectorRequest.model_validate({"operation": operation, "scope": _KNOWLEDGE_FS_VECTOR_STORE_SCOPE, **kwargs})


type TidbHarness = tuple[FakeQdrant, CollectionInfo]


class TestKnowledgeFsVectorStoreCases:
    @staticmethod
    @pytest.fixture(autouse=True)
    def _vector_store_config(config_overrides: Callable[..., None]) -> None:
        config_overrides(DEPLOYMENT_EDITION="COMMUNITY")

    @staticmethod
    @pytest.fixture
    def client() -> Iterator[QdrantClientType]:
        client = QdrantClient(":memory:")
        client.create_collection(
            VectorScope.model_validate(_KNOWLEDGE_FS_VECTOR_STORE_SCOPE).collection_name,
            vectors_config=models.VectorParams(size=2, distance=models.Distance.COSINE),
        )
        native_get = client.get_collection

        def get_collection(name: str) -> CollectionInfo:
            # Match the remote API's 404 contract while exercising native vector I/O.
            if not client.collection_exists(name):
                raise UnexpectedResponse(404, "missing", b"{}", {})
            return native_get(name)

        with patch.object(client, "get_collection", side_effect=get_collection):
            yield client
        client.close()

    @staticmethod
    def test_native_vector_roundtrip_authorized_id_filter_and_idempotent_deletion(client: QdrantClientType) -> None:
        points = [
            {
                "id": _KNOWLEDGE_FS_VECTOR_STORE_A,
                "generation_id": _KNOWLEDGE_FS_VECTOR_STORE_GENERATION,
                "content_hash": "a" * 64,
                "vector": [3, 4],
            },
            {
                "id": _KNOWLEDGE_FS_VECTOR_STORE_B,
                "generation_id": _KNOWLEDGE_FS_VECTOR_STORE_GENERATION,
                "content_hash": "b" * 64,
                "vector": [1, 0],
            },
        ]
        execute_vector_request(client, _knowledge_fs_vector_store_request("upsert", points=points))
        execute_vector_request(client, _knowledge_fs_vector_store_request("upsert", points=points))
        actual = execute_vector_request(
            client,
            _knowledge_fs_vector_store_request("get", ids=[_KNOWLEDGE_FS_VECTOR_STORE_A, _KNOWLEDGE_FS_VECTOR_STORE_B]),
        )["points"]
        assert len(actual) == 2
        assert actual[0]["vector"] == pytest.approx([0.6, 0.8])
        assert actual[0]["content_hash"] == "a" * 64
        # The nearest point B is unauthorized. It must not crowd out the authorized A.
        matches = execute_vector_request(
            client,
            _knowledge_fs_vector_store_request(
                "search", ids=[_KNOWLEDGE_FS_VECTOR_STORE_A], query_vector=[1, 0], limit=1
            ),
        )["matches"]
        assert [item["id"] for item in matches] == [_KNOWLEDGE_FS_VECTOR_STORE_A]
        assert matches[0]["score"] == pytest.approx(0.6)
        for _ in range(2):
            execute_vector_request(
                client, _knowledge_fs_vector_store_request("delete", ids=[_KNOWLEDGE_FS_VECTOR_STORE_A])
            )
        assert (
            execute_vector_request(
                client, _knowledge_fs_vector_store_request("get", ids=[_KNOWLEDGE_FS_VECTOR_STORE_A])
            )["points"]
            == []
        )
        assert (
            len(
                execute_vector_request(
                    client, _knowledge_fs_vector_store_request("get", ids=[_KNOWLEDGE_FS_VECTOR_STORE_B])
                )["points"]
            )
            == 1
        )

    @staticmethod
    @pytest.mark.parametrize(
        ("field", "value"),
        [
            ("tenant_id", _KNOWLEDGE_FS_VECTOR_STORE_B),
            ("knowledge_space_id", _KNOWLEDGE_FS_VECTOR_STORE_B),
            ("vector_space_id", "other"),
            ("kind", "visual"),
            ("dimension", 3),
        ],
    )
    def test_each_scope_dimension_has_a_distinct_reserved_namespace(field: str, value: object) -> None:
        original = VectorScope.model_validate(_KNOWLEDGE_FS_VECTOR_STORE_SCOPE)
        other = VectorScope.model_validate({**_KNOWLEDGE_FS_VECTOR_STORE_SCOPE, field: value})
        assert other.collection_name != original.collection_name
        assert other.legacy_collection_name != original.legacy_collection_name
        assert original.collection_name.startswith("knowledgefs_v1_dense_")
        assert SPACE not in original.collection_name

    @staticmethod
    @pytest.mark.parametrize("kind", ["dense", "visual", "graph-entity", "graph-relation"])
    def test_typed_collection_names_fit_tidb_delete_endpoint_and_normalize_uuid_case(kind: str) -> None:
        scope = VectorScope.model_validate({**_KNOWLEDGE_FS_VECTOR_STORE_SCOPE, "kind": kind})
        prefix = f"knowledgefs_v1_{kind.replace('-', '_')}_"
        assert scope.collection_name.startswith(prefix)
        assert len(scope.collection_name.removeprefix(prefix)) == min(32, 56 - len(prefix))
        assert len(scope.collection_name.removeprefix(prefix)) >= 26
        assert len(scope.collection_name) <= 56
        assert (
            VectorScope.model_validate({**_KNOWLEDGE_FS_VECTOR_STORE_SCOPE, "kind": kind, "tenant_id": TENANT.upper()})
            == scope
        )

    @staticmethod
    def test_legacy_namespace_keeps_pre_rename_hash() -> None:
        # Pin the pre-rename format so compatibility cannot drift with the new one.
        scope = VectorScope.model_validate(_KNOWLEDGE_FS_VECTOR_STORE_SCOPE)
        assert scope.legacy_collection_name == "knowledgefs_v1_488d91e70fe33beedcda4cb5e47b954dd5af7ca3"
        assert (
            scope.collection_name
            == "knowledgefs_v1_dense_" + scope.legacy_collection_name.removeprefix("knowledgefs_v1_")[:32]
        )

    @staticmethod
    def test_legacy_and_typed_points_remain_searchable_and_deletable_together(client: QdrantClientType) -> None:
        scope = VectorScope.model_validate(_KNOWLEDGE_FS_VECTOR_STORE_SCOPE)
        legacy = scope.legacy_collection_name
        current = scope.collection_name
        client.create_collection(legacy, vectors_config=models.VectorParams(size=2, distance=models.Distance.COSINE))
        points = [
            {
                "id": _KNOWLEDGE_FS_VECTOR_STORE_A,
                "generation_id": _KNOWLEDGE_FS_VECTOR_STORE_GENERATION,
                "content_hash": "a" * 64,
                "vector": [3, 4],
            },
            {
                "id": _KNOWLEDGE_FS_VECTOR_STORE_B,
                "generation_id": _KNOWLEDGE_FS_VECTOR_STORE_GENERATION,
                "content_hash": "b" * 64,
                "vector": [1, 0],
            },
        ]
        client.upsert(
            legacy,
            points=[
                models.PointStruct(
                    id=point["id"],
                    vector=point["vector"],
                    payload={k: v for k, v in point.items() if k not in {"id", "vector"}},
                )
                for point in points
            ],
        )
        client.delete_collection(current)
        assert (
            len(
                execute_vector_request(
                    client,
                    _knowledge_fs_vector_store_request(
                        "get", ids=[_KNOWLEDGE_FS_VECTOR_STORE_A, _KNOWLEDGE_FS_VECTOR_STORE_B]
                    ),
                )["points"]
            )
            == 2
        )
        assert (
            execute_vector_request(
                client,
                _knowledge_fs_vector_store_request("search", ids=[_KNOWLEDGE_FS_VECTOR_STORE_B], query_vector=[1, 0]),
            )["matches"][0]["id"]
            == _KNOWLEDGE_FS_VECTOR_STORE_B
        )
        assert not client.collection_exists(current)

        # A new document in this scope must create the typed name, without hiding old A.
        execute_vector_request(client, _knowledge_fs_vector_store_request("upsert", points=[points[1]]))
        assert client.count(current).count == 1
        assert client.count(legacy).count == 2
        assert (
            len(
                execute_vector_request(
                    client,
                    _knowledge_fs_vector_store_request(
                        "get", ids=[_KNOWLEDGE_FS_VECTOR_STORE_A, _KNOWLEDGE_FS_VECTOR_STORE_B]
                    ),
                )["points"]
            )
            == 2
        )
        matches = execute_vector_request(
            client,
            _knowledge_fs_vector_store_request(
                "search", ids=[_KNOWLEDGE_FS_VECTOR_STORE_A, _KNOWLEDGE_FS_VECTOR_STORE_B], query_vector=[1, 0], limit=1
            ),
        )["matches"]
        assert [match["id"] for match in matches] == [_KNOWLEDGE_FS_VECTOR_STORE_B]
        # B exists in both collections, but cannot crowd out an authorized point A.
        matches = execute_vector_request(
            client,
            _knowledge_fs_vector_store_request(
                "search", ids=[_KNOWLEDGE_FS_VECTOR_STORE_A], query_vector=[1, 0], limit=1
            ),
        )["matches"]
        assert [match["id"] for match in matches] == [_KNOWLEDGE_FS_VECTOR_STORE_A]
        for _ in range(2):
            execute_vector_request(
                client, _knowledge_fs_vector_store_request("delete", ids=[_KNOWLEDGE_FS_VECTOR_STORE_B])
            )
        assert client.retrieve(current, [_KNOWLEDGE_FS_VECTOR_STORE_B]) == []
        assert client.retrieve(legacy, [_KNOWLEDGE_FS_VECTOR_STORE_B]) == []
        assert (
            len(
                execute_vector_request(
                    client, _knowledge_fs_vector_store_request("get", ids=[_KNOWLEDGE_FS_VECTOR_STORE_A])
                )["points"]
            )
            == 1
        )

    @staticmethod
    @pytest.mark.parametrize("operation", ["get", "search", "delete"])
    def test_legacy_backend_failure_never_returns_partial_success(client: QdrantClientType, operation: str) -> None:
        execute_vector_request(
            client,
            _knowledge_fs_vector_store_request(
                "upsert",
                points=[
                    {
                        "id": _KNOWLEDGE_FS_VECTOR_STORE_A,
                        "generation_id": _KNOWLEDGE_FS_VECTOR_STORE_GENERATION,
                        "content_hash": "a" * 64,
                        "vector": [1, 0],
                    }
                ],
            ),
        )
        native_get = client.get_collection

        def get_collection(name: str) -> CollectionInfo:
            if name == VectorScope.model_validate(_KNOWLEDGE_FS_VECTOR_STORE_SCOPE).legacy_collection_name:
                raise UnexpectedResponse(503, "unavailable", b"{}", {})
            return native_get(name)

        payload = _knowledge_fs_vector_store_request(
            operation, ids=[_KNOWLEDGE_FS_VECTOR_STORE_A], **({"query_vector": [1, 0]} if operation == "search" else {})
        )
        with patch.object(client, "get_collection", side_effect=get_collection):
            with pytest.raises(UnexpectedResponse):
                execute_vector_request(client, payload)

    @staticmethod
    @pytest.mark.parametrize(
        "payload",
        [
            {"operation": "search", "ids": [], "query_vector": [1, 0]},
            {"operation": "search", "ids": [_KNOWLEDGE_FS_VECTOR_STORE_A], "query_vector": [1]},
            {"operation": "search", "ids": [_KNOWLEDGE_FS_VECTOR_STORE_A], "query_vector": [0, 0]},
            {"operation": "search", "ids": [_KNOWLEDGE_FS_VECTOR_STORE_A], "query_vector": [float("nan"), 1]},
            {
                "operation": "search",
                "ids": [_KNOWLEDGE_FS_VECTOR_STORE_A, _KNOWLEDGE_FS_VECTOR_STORE_A],
                "query_vector": [1, 0],
            },
            {
                "operation": "search",
                "ids": [_KNOWLEDGE_FS_VECTOR_STORE_A],
                "query_vector": [1, 0],
                "collection_name": "dataset",
            },
            {
                "operation": "search",
                "ids": [_KNOWLEDGE_FS_VECTOR_STORE_A],
                "query_vector": [1, 0],
                "endpoint": "http://example.com",
            },
            {"operation": "get", "ids": ["not-a-uuid"]},
            {"operation": "delete", "ids": [_KNOWLEDGE_FS_VECTOR_STORE_A], "query_vector": [1, 0]},
            {"operation": "upsert", "points": []},
        ],
    )
    def test_invalid_operations_fail_before_backend_io(payload: dict[str, object]) -> None:
        with pytest.raises(ValidationError):
            VectorRequest.model_validate({"scope": _KNOWLEDGE_FS_VECTOR_STORE_SCOPE, **payload})

    @staticmethod
    def test_missing_collection_search_is_not_reported_as_empty_success() -> None:
        client = FakeQdrant()
        with pytest.raises(VectorStoreUnavailableError, match="missing"):
            client.execute(
                _knowledge_fs_vector_store_request("search", ids=[_KNOWLEDGE_FS_VECTOR_STORE_A], query_vector=[1, 0])
            )
        assert client.create_collection_calls == []
        assert (
            client.execute(_knowledge_fs_vector_store_request("delete", ids=[_KNOWLEDGE_FS_VECTOR_STORE_A]))["points"]
            == []
        )

    @staticmethod
    def test_collection_creation_race_accepts_only_compatible_existing_collection(client: QdrantClientType) -> None:
        real_get = client.get_collection
        with (
            patch.object(
                client,
                "get_collection",
                side_effect=[
                    UnexpectedResponse(404, "missing", b"{}", {}),
                    real_get(VectorScope.model_validate(_KNOWLEDGE_FS_VECTOR_STORE_SCOPE).collection_name),
                ],
            ),
            patch.object(client, "create_collection", side_effect=RuntimeError("already exists")),
        ):
            execute_vector_request(
                client,
                _knowledge_fs_vector_store_request(
                    "upsert",
                    points=[
                        {
                            "id": _KNOWLEDGE_FS_VECTOR_STORE_A,
                            "generation_id": _KNOWLEDGE_FS_VECTOR_STORE_GENERATION,
                            "content_hash": "a" * 64,
                            "vector": [1, 0],
                        }
                    ],
                ),
            )
        assert (
            len(
                execute_vector_request(
                    client, _knowledge_fs_vector_store_request("get", ids=[_KNOWLEDGE_FS_VECTOR_STORE_A])
                )["points"]
            )
            == 1
        )

    @staticmethod
    def test_no_binding_never_allocates_a_paid_cluster(config_overrides: Callable[..., None]) -> None:
        from services.tidb_binding_service import TidbBindingUnavailableError

        config_overrides(VECTOR_STORE="tidb_on_qdrant")
        with patch("services.tidb_binding_service._load_binding", return_value=None):
            with pytest.raises(TidbBindingUnavailableError, match="no active"):
                with configured_vector_client(TENANT):
                    pytest.fail("unconfigured backend was opened")

    @staticmethod
    def test_unsupported_backend_fails_explicitly(config_overrides: Callable[..., None]) -> None:
        config_overrides(VECTOR_STORE="milvus")
        with pytest.raises(VectorStoreUnavailableError, match="does not support"):
            with configured_vector_client(TENANT):
                pytest.fail("unsupported backend was opened")

    @staticmethod
    @pytest.mark.parametrize("allow_create", [True, False])
    def test_tidb_client_uses_tenant_binding(config_overrides: Callable[..., None], allow_create: bool) -> None:
        config_overrides(VECTOR_STORE="tidb_on_qdrant", TIDB_ON_QDRANT_URL="https://global.invalid")
        binding = TidbAuthBinding(
            tenant_id=TENANT,
            cluster_id="cluster-1",
            cluster_name="tenant-cluster",
            active=True,
            status=TidbAuthBindingStatus.ACTIVE,
            account="tenant-account",
            password="tenant-secret",
            qdrant_endpoint="https://tenant.invalid",
        )
        client = FakeQdrant()

        def open_client(**kwargs: object) -> FakeQdrant:
            assert kwargs["url"] == "https://tenant.invalid"
            assert kwargs["api_key"] == "tenant-account:tenant-secret"
            return client

        with (
            patch("services.tidb_binding_service.resolve_tidb_auth_binding", return_value=binding) as resolve,
            patch("qdrant_client.QdrantClient", side_effect=open_client),
        ):
            with configured_vector_client(TENANT, allow_create=allow_create) as configured:
                assert configured is client
        resolve.assert_called_once_with(TENANT, allow_create=allow_create)
        assert client.close_count == 1

    @staticmethod
    def test_qdrant_configuration_closes_client_even_when_operation_fails(
        config_overrides: Callable[..., None],
    ) -> None:
        config_overrides(VECTOR_STORE="qdrant", QDRANT_URL="https://configured.invalid", QDRANT_API_KEY="private")
        with patch("qdrant_client.QdrantClient") as factory:
            with pytest.raises(RuntimeError):
                with configured_vector_client(TENANT):
                    raise RuntimeError("operation failed")
            assert factory.call_args.kwargs["url"] == "https://configured.invalid"
            factory.return_value.close.assert_called_once()
        config_overrides(QDRANT_URL="")
        with pytest.raises(VectorStoreUnavailableError, match="endpoint"):
            with configured_vector_client(TENANT):
                pytest.fail("missing endpoint accepted")

    @staticmethod
    def test_cloud_quota_is_enforced_before_any_vector_mutation() -> None:
        from services.vector_space_admission_service import VectorSpaceAdmissionError

        client = FakeQdrant()
        with patch(
            "services.vector_space_admission_service.VectorSpaceAdmissionService.ensure_external_points_can_be_indexed",
            side_effect=VectorSpaceAdmissionError("limit reached"),
        ):
            with pytest.raises(VectorSpaceAdmissionError):
                client.execute(
                    _knowledge_fs_vector_store_request(
                        "upsert",
                        points=[
                            {
                                "id": _KNOWLEDGE_FS_VECTOR_STORE_A,
                                "generation_id": _KNOWLEDGE_FS_VECTOR_STORE_GENERATION,
                                "content_hash": "a" * 64,
                                "vector": [1, 0],
                            }
                        ],
                    ),
                )
        assert client.get_collection_calls == []
        assert client.upsert_calls == []

    @staticmethod
    def test_cloud_quota_uses_existing_watermark_without_embedding_calls(config_overrides: Callable[..., None]) -> None:
        from enums import CloudPlan, DeploymentEdition
        from services.vector_space_admission_service import VectorSpaceAdmissionError, VectorSpaceAdmissionService

        config_overrides(
            DEPLOYMENT_EDITION=DeploymentEdition.CLOUD,
            VECTOR_STORE="tidb_on_qdrant",
            TIDB_ON_QDRANT_ESTIMATED_STORAGE_LIMITS_MB="sandbox:60,professional:6144,team:24576",
        )
        service = VectorSpaceAdmissionService()
        with (
            patch.object(service, "_get_plan", return_value=CloudPlan.SANDBOX),
            patch.object(service, "_get_usage_and_limit_mb", return_value=(0.0, 50)),
            patch.object(service, "_get_embedding_dimension") as dimension,
            patch.object(service, "_reserve_projected_usage", return_value=(0, 60 * 1024 * 1024)) as reserve,
        ):
            for _ in range(2):
                service.ensure_external_points_can_be_indexed(
                    tenant_id=TENANT, batch_id="stable-batch", point_count=2, dimension=3
                )
            assert reserve.call_args.kwargs["document_id"] == "knowledgefs:stable-batch"
            assert reserve.call_args.kwargs["document_estimate_bytes"] == 2 * (3 * 8 + 3584)
            assert reserve.call_args.kwargs["estimate_limit_bytes"] == 60 * 1024 * 1024
            dimension.assert_not_called()
            reserve.return_value = (0, 61 * 1024 * 1024)
            with pytest.raises(VectorSpaceAdmissionError, match="exceeding the 50 MB limit"):
                service.ensure_external_points_can_be_indexed(
                    tenant_id=TENANT, batch_id="large", point_count=2, dimension=3
                )
        with pytest.raises(VectorSpaceAdmissionError, match="Invalid"):
            service.ensure_external_points_can_be_indexed(tenant_id=TENANT, batch_id="bad", point_count=0, dimension=3)

    @staticmethod
    def test_unmetered_workspace_does_not_contact_billing_or_reserve_quota(
        config_overrides: Callable[..., None],
    ) -> None:
        from services.vector_space_admission_service import VectorSpaceAdmissionService

        config_overrides(DEPLOYMENT_EDITION="CLOUD", VECTOR_STORE="tidb_on_qdrant")
        service = VectorSpaceAdmissionService()
        with (
            patch.object(service, "_get_plan", return_value=None),
            patch.object(service, "_get_usage_and_limit_mb") as billing,
            patch.object(service, "_reserve_projected_usage") as reserve,
        ):
            service.ensure_external_points_can_be_indexed(
                tenant_id=TENANT, batch_id="unmetered", point_count=2, dimension=3
            )
            billing.assert_not_called()
            reserve.assert_not_called()

    @staticmethod
    @pytest.mark.parametrize("limit", [50, -1])
    def test_external_points_with_unknown_usage_fail_before_reservation(
        config_overrides: Callable[..., None], limit: int
    ) -> None:
        from enums import CloudPlan
        from services.vector_space_admission_service import (
            VectorSpaceAdmissionService,
            VectorSpaceAdmissionUnavailableError,
        )

        config_overrides(DEPLOYMENT_EDITION="CLOUD", VECTOR_STORE="tidb_on_qdrant")
        service = VectorSpaceAdmissionService()
        with (
            patch.object(service, "_get_plan", return_value=CloudPlan.SANDBOX),
            patch(
                "services.vector_space_admission_service.BillingService.get_vector_space",
                return_value={"size": 0, "limit": limit, "usage_unknown": True},
            ),
            patch.object(service, "_reserve_projected_usage") as reserve,
        ):
            with pytest.raises(VectorSpaceAdmissionUnavailableError, match="Unable to verify vector storage usage"):
                service.ensure_external_points_can_be_indexed(
                    tenant_id=TENANT, batch_id="unknown", point_count=2, dimension=3
                )
            reserve.assert_not_called()

    @staticmethod
    @pytest.mark.parametrize(("edition", "vector_store"), [("COMMUNITY", "tidb_on_qdrant"), ("CLOUD", "qdrant")])
    def test_external_points_skip_billing_outside_cloud_tidb(
        config_overrides: Callable[..., None], edition: str, vector_store: str
    ) -> None:
        from services.vector_space_admission_service import VectorSpaceAdmissionService

        config_overrides(DEPLOYMENT_EDITION=edition, VECTOR_STORE=vector_store)
        service = VectorSpaceAdmissionService()
        with (
            patch("services.vector_space_admission_service.BillingService.get_vector_space") as billing,
            patch.object(service, "_reserve_projected_usage") as reserve,
        ):
            service.ensure_external_points_can_be_indexed(
                tenant_id=TENANT, batch_id="unmetered", point_count=2, dimension=3
            )
            billing.assert_not_called()
            reserve.assert_not_called()

    @staticmethod
    def test_incompatible_collection_is_never_recreated_or_written(client: QdrantClientType) -> None:
        collection = VectorScope.model_validate(_KNOWLEDGE_FS_VECTOR_STORE_SCOPE).collection_name
        client.delete_collection(collection)
        client.create_collection(
            collection, vectors_config=models.VectorParams(size=3, distance=models.Distance.COSINE)
        )
        with pytest.raises(VectorStoreUnavailableError, match="incompatible"):
            execute_vector_request(
                client,
                _knowledge_fs_vector_store_request(
                    "upsert",
                    points=[
                        {
                            "id": _KNOWLEDGE_FS_VECTOR_STORE_A,
                            "generation_id": _KNOWLEDGE_FS_VECTOR_STORE_GENERATION,
                            "content_hash": "a" * 64,
                            "vector": [1, 0],
                        }
                    ],
                ),
            )
        from qdrant_client.http.models import VectorParams

        vectors = client.get_collection(collection).config.params.vectors
        assert isinstance(vectors, VectorParams)
        assert vectors.size == 3

    @staticmethod
    def test_uncertain_native_delete_is_retryable(client: QdrantClientType) -> None:
        execute_vector_request(
            client,
            _knowledge_fs_vector_store_request(
                "upsert",
                points=[
                    {
                        "id": _KNOWLEDGE_FS_VECTOR_STORE_A,
                        "generation_id": _KNOWLEDGE_FS_VECTOR_STORE_GENERATION,
                        "content_hash": "a" * 64,
                        "vector": [1, 0],
                    }
                ],
            ),
        )
        with patch.object(client, "delete"):
            with pytest.raises(VectorStoreUnavailableError, match="not yet visible"):
                execute_vector_request(
                    client, _knowledge_fs_vector_store_request("delete", ids=[_KNOWLEDGE_FS_VECTOR_STORE_A])
                )
        execute_vector_request(client, _knowledge_fs_vector_store_request("delete", ids=[_KNOWLEDGE_FS_VECTOR_STORE_A]))
        assert (
            execute_vector_request(
                client, _knowledge_fs_vector_store_request("get", ids=[_KNOWLEDGE_FS_VECTOR_STORE_A])
            )["points"]
            == []
        )

    @staticmethod
    @pytest.fixture
    def tidb_client(
        client: QdrantClientType, config_overrides: Callable[..., None]
    ) -> tuple[FakeQdrant, CollectionInfo]:
        config_overrides(VECTOR_STORE="tidb_on_qdrant")
        scope = VectorScope.model_validate(_KNOWLEDGE_FS_VECTOR_STORE_SCOPE)
        info = client.get_collection(scope.collection_name)
        return FakeQdrant(collections={scope.collection_name: info}), info

    @staticmethod
    def test_tidb_new_collection_indexes_and_stores_point_ids(tidb_client: TidbHarness) -> None:
        client, info = tidb_client
        client.execute(
            _knowledge_fs_vector_store_request(
                "upsert",
                points=[
                    {
                        "id": _KNOWLEDGE_FS_VECTOR_STORE_A,
                        "generation_id": _KNOWLEDGE_FS_VECTOR_STORE_GENERATION,
                        "content_hash": "a" * 64,
                        "vector": [1, 0],
                    }
                ],
            ),
        )
        assert client.create_payload_index_calls == [
            {
                "collection_name": VectorScope.model_validate(_KNOWLEDGE_FS_VECTOR_STORE_SCOPE).collection_name,
                "field_name": TIDB_POINT_ID_FIELD,
                "field_schema": models.PayloadSchemaType.KEYWORD,
                "wait": True,
            }
        ]
        assert client.upserted_points[-1][0].payload == {
            "generation_id": _KNOWLEDGE_FS_VECTOR_STORE_GENERATION,
            "content_hash": "a" * 64,
            TIDB_POINT_ID_FIELD: _KNOWLEDGE_FS_VECTOR_STORE_A,
        }

    @staticmethod
    @pytest.mark.parametrize("compatible", [False, True])
    def test_tidb_payload_index_creation_race_requires_compatible_index(
        tidb_client: TidbHarness, compatible: bool
    ) -> None:
        client, info = tidb_client

        def create_index(**_kwargs: object) -> None:
            if compatible:
                info.payload_schema[TIDB_POINT_ID_FIELD] = models.PayloadIndexInfo(data_type="keyword", points=0)
            raise RuntimeError("index creation raced or failed")

        client.create_payload_index_hook = create_index
        payload = _knowledge_fs_vector_store_request(
            "upsert",
            points=[
                {
                    "id": _KNOWLEDGE_FS_VECTOR_STORE_A,
                    "generation_id": _KNOWLEDGE_FS_VECTOR_STORE_GENERATION,
                    "content_hash": "a" * 64,
                    "vector": [1, 0],
                }
            ],
        )
        if compatible:
            client.execute(payload)
            assert len(client.upsert_calls) == 1
        else:
            with pytest.raises(RuntimeError, match="creation"):
                client.execute(payload)
            assert client.upsert_calls == []

    @staticmethod
    def test_tidb_nonempty_old_collection_is_not_marked_indexed(tidb_client: TidbHarness) -> None:
        client, info = tidb_client
        info.points_count = 1
        client.execute(
            _knowledge_fs_vector_store_request(
                "upsert",
                points=[
                    {
                        "id": _KNOWLEDGE_FS_VECTOR_STORE_A,
                        "generation_id": _KNOWLEDGE_FS_VECTOR_STORE_GENERATION,
                        "content_hash": "a" * 64,
                        "vector": [1, 0],
                    }
                ],
            ),
        )
        assert client.create_payload_index_calls == []
        assert len(client.upsert_calls) == 1

    @staticmethod
    @pytest.mark.parametrize("operation", ["search", "upsert"])
    def test_tidb_wrong_id_index_type_fails_closed(tidb_client: TidbHarness, operation: str) -> None:
        client, info = tidb_client
        info.payload_schema[TIDB_POINT_ID_FIELD] = models.PayloadIndexInfo(data_type="integer", points=0)
        payload = (
            _knowledge_fs_vector_store_request("search", ids=[_KNOWLEDGE_FS_VECTOR_STORE_A], query_vector=[1, 0])
            if operation == "search"
            else _knowledge_fs_vector_store_request(
                "upsert",
                points=[
                    {
                        "id": _KNOWLEDGE_FS_VECTOR_STORE_A,
                        "generation_id": _KNOWLEDGE_FS_VECTOR_STORE_GENERATION,
                        "content_hash": "a" * 64,
                        "vector": [1, 0],
                    }
                ],
            )
        )
        with pytest.raises(VectorStoreUnavailableError, match="ID index"):
            client.execute(payload)
        assert client.upsert_calls == []
        assert client.search_calls == []

    @staticmethod
    def test_tidb_indexed_search_uses_supported_filter_and_payload_selection(tidb_client: TidbHarness) -> None:
        client, info = tidb_client
        info.payload_schema[TIDB_POINT_ID_FIELD] = models.PayloadIndexInfo(data_type="keyword", points=1)
        client.search_result = [models.ScoredPoint(id=_KNOWLEDGE_FS_VECTOR_STORE_A, version=0, score=0.6)]
        result = client.execute(
            _knowledge_fs_vector_store_request(
                "search", ids=[_KNOWLEDGE_FS_VECTOR_STORE_A], query_vector=[1, 0], limit=1
            )
        )
        assert result["matches"] == [{"id": _KNOWLEDGE_FS_VECTOR_STORE_A, "score": 0.6}]
        query = client.search_calls[-1]
        assert query["with_payload"] is True
        assert query["with_vectors"] is False
        assert query["query_filter"] == models.Filter(
            must=[
                models.FieldCondition(
                    key=TIDB_POINT_ID_FIELD, match=models.MatchAny(any=[_KNOWLEDGE_FS_VECTOR_STORE_A])
                )
            ]
        )
        assert client.retrieve_calls == []
        client.search_result = [models.ScoredPoint(id=_KNOWLEDGE_FS_VECTOR_STORE_B, version=0, score=1.0)]
        with pytest.raises(VectorStoreUnavailableError, match="unauthorized"):
            client.execute(
                _knowledge_fs_vector_store_request("search", ids=[_KNOWLEDGE_FS_VECTOR_STORE_A], query_vector=[1, 0])
            )

    @staticmethod
    def test_tidb_unindexed_legacy_search_reads_only_authorized_ids(
        client: QdrantClientType, config_overrides: Callable[..., None]
    ) -> None:
        scope = VectorScope.model_validate(_KNOWLEDGE_FS_VECTOR_STORE_SCOPE)
        client.create_collection(
            scope.legacy_collection_name, vectors_config=models.VectorParams(size=2, distance="Cosine")
        )
        client.upsert(
            scope.legacy_collection_name,
            points=[
                models.PointStruct(id=_KNOWLEDGE_FS_VECTOR_STORE_A, vector=[3, 4]),
                models.PointStruct(id=_KNOWLEDGE_FS_VECTOR_STORE_B, vector=[1, 0]),
            ],
        )
        config_overrides(VECTOR_STORE="tidb_on_qdrant")
        with patch.object(client, "search", side_effect=AssertionError("Legacy search must not query unfiltered")):
            result = execute_vector_request(
                client,
                _knowledge_fs_vector_store_request(
                    "search", ids=[_KNOWLEDGE_FS_VECTOR_STORE_A], query_vector=[1, 0], limit=1
                ),
            )
            assert [match["id"] for match in result["matches"]] == [_KNOWLEDGE_FS_VECTOR_STORE_A]
            assert result["matches"][0]["score"] == pytest.approx(0.6)
            result = execute_vector_request(
                client,
                _knowledge_fs_vector_store_request(
                    "search",
                    ids=[_KNOWLEDGE_FS_VECTOR_STORE_A, _KNOWLEDGE_FS_VECTOR_STORE_B],
                    query_vector=[1, 0],
                    limit=1,
                ),
            )
            assert result["matches"] == [{"id": _KNOWLEDGE_FS_VECTOR_STORE_B, "score": 1.0}]

    @staticmethod
    def test_tidb_unindexed_search_bounds_reads_and_propagates_failures(tidb_client: TidbHarness) -> None:
        client, info = tidb_client
        info.points_count = 130
        ids = [f"00000000-0000-4000-8000-{n:012d}" for n in range(130)]

        def retrieve(**kwargs: object) -> list[object]:
            assert kwargs["with_payload"] is False
            assert kwargs["with_vectors"] is True
            ids_batch = kwargs["ids"]
            assert isinstance(ids_batch, list)
            assert len(ids_batch) <= 64
            return [models.Record(id=point_id, vector=[1, 0]) for point_id in ids_batch]

        client.retrieve_hook = retrieve
        result = client.execute(_knowledge_fs_vector_store_request("search", ids=ids, query_vector=[1, 0], limit=3))
        assert result["matches"] == [{"id": point_id, "score": 1.0} for point_id in ids[:3]]
        assert len(client.retrieve_calls) == 3
        assert client.search_calls == []
        client.retrieve_failure = RuntimeError("read failed")
        with pytest.raises(RuntimeError, match="read failed"):
            client.execute(_knowledge_fs_vector_store_request("search", ids=ids, query_vector=[1, 0]))

    @staticmethod
    @pytest.mark.parametrize("vector", [None, [1], [0, 0], [float("nan"), 0], [1e20, 0]])
    def test_tidb_unindexed_search_rejects_unscorable_vectors(
        tidb_client: TidbHarness, vector: list[float] | None
    ) -> None:
        client, _ = tidb_client
        client.retrieve_result = [models.Record(id=_KNOWLEDGE_FS_VECTOR_STORE_A, vector=vector)]
        with pytest.raises(VectorStoreUnavailableError, match="dimensions|scored"):
            client.execute(
                _knowledge_fs_vector_store_request("search", ids=[_KNOWLEDGE_FS_VECTOR_STORE_A], query_vector=[1, 0])
            )

    @staticmethod
    def test_tidb_unindexed_search_rejects_unrequested_points(tidb_client: TidbHarness) -> None:
        client, _ = tidb_client
        client.retrieve_result = [models.Record(id=_KNOWLEDGE_FS_VECTOR_STORE_B, vector=[1, 0])]
        with pytest.raises(VectorStoreUnavailableError, match="unauthorized"):
            client.execute(
                _knowledge_fs_vector_store_request("search", ids=[_KNOWLEDGE_FS_VECTOR_STORE_A], query_vector=[1, 0])
            )

    @staticmethod
    def test_tidb_indexed_delete_uses_field_filter_and_verifies_absence(tidb_client: TidbHarness) -> None:
        client, info = tidb_client
        info.payload_schema[TIDB_POINT_ID_FIELD] = models.PayloadIndexInfo(data_type="keyword", points=2)
        client.retrieve_result = list[object]()
        client.execute(
            _knowledge_fs_vector_store_request(
                "delete", ids=[_KNOWLEDGE_FS_VECTOR_STORE_A, _KNOWLEDGE_FS_VECTOR_STORE_B]
            )
        )
        assert client.delete_selectors[-1] == models.FilterSelector(
            filter=models.Filter(
                must=[
                    models.FieldCondition(
                        key=TIDB_POINT_ID_FIELD,
                        match=models.MatchAny(any=[_KNOWLEDGE_FS_VECTOR_STORE_A, _KNOWLEDGE_FS_VECTOR_STORE_B]),
                    )
                ]
            )
        )
        assert len(client.delete_calls) == 1
        client.retrieve_result = [models.Record(id=_KNOWLEDGE_FS_VECTOR_STORE_A)]
        with pytest.raises(VectorStoreUnavailableError, match="not yet visible"):
            client.execute(
                _knowledge_fs_vector_store_request(
                    "delete", ids=[_KNOWLEDGE_FS_VECTOR_STORE_A, _KNOWLEDGE_FS_VECTOR_STORE_B]
                )
            )

    @staticmethod
    def test_tidb_unindexed_delete_uses_single_ids_and_propagates_errors(tidb_client: TidbHarness) -> None:
        client, _ = tidb_client
        client.retrieve_result = list[object]()
        client.execute(
            _knowledge_fs_vector_store_request(
                "delete", ids=[_KNOWLEDGE_FS_VECTOR_STORE_A, _KNOWLEDGE_FS_VECTOR_STORE_B]
            )
        )
        assert client.create_payload_index_calls == [
            {
                "collection_name": VectorScope.model_validate(_KNOWLEDGE_FS_VECTOR_STORE_SCOPE).collection_name,
                "field_name": "content_hash",
                "field_schema": models.PayloadSchemaType.KEYWORD,
                "wait": True,
            }
        ]
        from qdrant_client.http.models import PointIdsList as NativePointIdsList

        selectors = [selector for selector in client.delete_selectors if isinstance(selector, NativePointIdsList)]
        assert len(selectors) == len(client.delete_selectors)
        assert sorted(selector.points for selector in selectors) == [
            [_KNOWLEDGE_FS_VECTOR_STORE_A],
            [_KNOWLEDGE_FS_VECTOR_STORE_B],
        ]
        assert all(call["wait"] for call in client.delete_calls)
        client.delete_failure = RuntimeError("delete failed")
        with pytest.raises(RuntimeError, match="delete failed"):
            client.execute(
                _knowledge_fs_vector_store_request(
                    "delete", ids=[_KNOWLEDGE_FS_VECTOR_STORE_A, _KNOWLEDGE_FS_VECTOR_STORE_B]
                )
            )

    @staticmethod
    @pytest.mark.parametrize("remaining", [[], [models.Record(id=_KNOWLEDGE_FS_VECTOR_STORE_A)]])
    def test_tidb_delete_not_found_still_requires_readback(tidb_client: TidbHarness, remaining: list[object]) -> None:
        client, info = tidb_client
        info.payload_schema[TIDB_POINT_ID_FIELD] = models.PayloadIndexInfo(data_type="keyword", points=1)
        client.delete_failure = UnexpectedResponse(404, "missing", b"{}", {})
        client.retrieve_result = remaining
        if remaining:
            with pytest.raises(VectorStoreUnavailableError, match="not yet visible"):
                client.execute(_knowledge_fs_vector_store_request("delete", ids=[_KNOWLEDGE_FS_VECTOR_STORE_A]))
        else:
            client.execute(_knowledge_fs_vector_store_request("delete", ids=[_KNOWLEDGE_FS_VECTOR_STORE_A]))
        assert len(client.retrieve_calls) == 1

    @staticmethod
    @pytest.mark.parametrize("status", [404, 503])
    def test_tidb_delete_readback_only_accepts_missing_collection(tidb_client: TidbHarness, status: int) -> None:
        client, info = tidb_client
        info.payload_schema[TIDB_POINT_ID_FIELD] = models.PayloadIndexInfo(data_type="keyword", points=1)
        client.retrieve_failure = UnexpectedResponse(status, "unavailable", b"{}", {})
        if status == 404:
            client.execute(_knowledge_fs_vector_store_request("delete", ids=[_KNOWLEDGE_FS_VECTOR_STORE_A]))
        else:
            with pytest.raises(UnexpectedResponse):
                client.execute(_knowledge_fs_vector_store_request("delete", ids=[_KNOWLEDGE_FS_VECTOR_STORE_A]))
