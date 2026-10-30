import json
from collections.abc import Generator
from contextlib import contextmanager

import alibabacloud_gpdb20160503.client as gpdb_client_module
import dify_vdb_analyticdb.analyticdb_vector_openapi as openapi_module
import pytest
from alibabacloud_gpdb20160503 import models as gpdb_models
from alibabacloud_tea_openapi import models as open_api_models
from dify_vdb_analyticdb.analyticdb_vector_openapi import (
    AnalyticdbVectorOpenAPI,
    AnalyticdbVectorOpenAPIConfig,
)
from Tea.exceptions import TeaException

from core.rag.models.document import Document

# Fields every request sends to address the instance as its manager account.
MANAGER = {
    "DBInstanceId": "instance-1",
    "ManagerAccount": "account",
    "ManagerAccountPassword": "password",
    "RegionId": "cn-hangzhou",
}
# Fields every request sends to address the collection inside the namespace.
COLLECTION = {
    "Collection": "collection_1",
    "DBInstanceId": "instance-1",
    "Namespace": "dify",
    "NamespacePassword": "ns-password",
    "RegionId": "cn-hangzhou",
}


class FakeGpdbClient:
    """Stands in for the AnalyticDB OpenAPI client: records each request and answers with preset results."""

    def __init__(self, config: open_api_models.Config | None = None) -> None:
        self.config = config
        self.requests: list[tuple[str, dict[str, object]]] = []
        self.errors: dict[str, Exception] = {}
        self.matches: list[gpdb_models.QueryCollectionDataResponseBodyMatchesMatch] = []

    def sent(self, method: str) -> list[dict[str, object]]:
        return [request for name, request in self.requests if name == method]

    def _record(self, method: str, request_map: dict[str, object]) -> None:
        self.requests.append((method, request_map))
        if method in self.errors:
            raise self.errors[method]

    def init_vector_database(self, request: gpdb_models.InitVectorDatabaseRequest) -> None:
        self._record("init_vector_database", request.to_map())

    def describe_namespace(self, request: gpdb_models.DescribeNamespaceRequest) -> None:
        self._record("describe_namespace", request.to_map())

    def create_namespace(self, request: gpdb_models.CreateNamespaceRequest) -> None:
        self._record("create_namespace", request.to_map())

    def describe_collection(self, request: gpdb_models.DescribeCollectionRequest) -> None:
        self._record("describe_collection", request.to_map())

    def create_collection(self, request: gpdb_models.CreateCollectionRequest) -> None:
        self._record("create_collection", request.to_map())

    def upsert_collection_data(self, request: gpdb_models.UpsertCollectionDataRequest) -> None:
        self._record("upsert_collection_data", request.to_map())

    def query_collection_data(
        self, request: gpdb_models.QueryCollectionDataRequest
    ) -> gpdb_models.QueryCollectionDataResponse:
        self._record("query_collection_data", request.to_map())
        return gpdb_models.QueryCollectionDataResponse(
            body=gpdb_models.QueryCollectionDataResponseBody(
                matches=gpdb_models.QueryCollectionDataResponseBodyMatches(match=self.matches)
            )
        )

    def delete_collection_data(self, request: gpdb_models.DeleteCollectionDataRequest) -> None:
        self._record("delete_collection_data", request.to_map())

    def delete_collection(self, request: gpdb_models.DeleteCollectionRequest) -> None:
        self._record("delete_collection", request.to_map())


class FakeRedis:
    """The parts of ``redis_client`` that initialization uses, returning one cached value for every key."""

    def __init__(self, cached: object = None) -> None:
        self.cached = cached
        self.lock_names: list[str] = []
        self.set_calls: list[tuple[str, object, int | None]] = []

    @contextmanager
    def lock(self, name: str, timeout: int) -> Generator[None]:
        self.lock_names.append(name)
        yield

    def get(self, key: str) -> object:
        return self.cached

    def set(self, key: str, value: object, ex: int | None = None) -> None:
        self.set_calls.append((key, value, ex))


def _api_error(status_code: int) -> TeaException:
    return TeaException({"code": "Error", "message": "request failed", "data": {"statusCode": status_code}})


def _match(
    score: float, document_id: str, page_content: str, vector: list[float]
) -> gpdb_models.QueryCollectionDataResponseBodyMatchesMatch:
    return gpdb_models.QueryCollectionDataResponseBodyMatchesMatch(
        score=score,
        metadata={"metadata_": json.dumps({"document_id": document_id}), "page_content": page_content},
        values=gpdb_models.QueryCollectionDataResponseBodyMatchesMatchValues(value=vector),
    )


def _config() -> AnalyticdbVectorOpenAPIConfig:
    return AnalyticdbVectorOpenAPIConfig(
        access_key_id="ak",
        access_key_secret="sk",
        region_id="cn-hangzhou",
        instance_id="instance-1",
        account="account",
        account_password="password",
        namespace="dify",
        namespace_password="ns-password",
    )


@pytest.fixture
def fake_redis(monkeypatch: pytest.MonkeyPatch) -> FakeRedis:
    redis = FakeRedis()
    monkeypatch.setattr(openapi_module, "redis_client", redis)
    return redis


@pytest.fixture
def client() -> FakeGpdbClient:
    return FakeGpdbClient()


@pytest.fixture
def vector(monkeypatch: pytest.MonkeyPatch, client: FakeGpdbClient, fake_redis: FakeRedis) -> AnalyticdbVectorOpenAPI:
    monkeypatch.setattr(gpdb_client_module, "Client", lambda _config: client)
    # The instance is already initialized, so construction sends no request.
    fake_redis.cached = 1
    vector = AnalyticdbVectorOpenAPI("COLLECTION_1", _config())
    fake_redis.cached = None
    assert vector._client is client
    return vector


@pytest.mark.parametrize(
    ("field", "value", "error_message"),
    [
        ("access_key_id", "", "ANALYTICDB_KEY_ID"),
        ("access_key_secret", "", "ANALYTICDB_KEY_SECRET"),
        ("region_id", "", "ANALYTICDB_REGION_ID"),
        ("instance_id", "", "ANALYTICDB_INSTANCE_ID"),
        ("account", "", "ANALYTICDB_ACCOUNT"),
        ("account_password", "", "ANALYTICDB_PASSWORD"),
        ("namespace_password", "", "ANALYTICDB_NAMESPACE_PASSWORD"),
    ],
)
def test_openapi_config_validation(field: str, value: str, error_message: str) -> None:
    values = _config().model_dump()
    values[field] = value

    with pytest.raises(ValueError, match=error_message):
        AnalyticdbVectorOpenAPIConfig.model_validate(values)


def test_openapi_config_to_client_params() -> None:
    config = _config()
    params = config.to_analyticdb_client_params()

    assert params["access_key_id"] == "ak"
    assert params["access_key_secret"] == "sk"
    assert params["region_id"] == "cn-hangzhou"
    assert params["read_timeout"] == 60000


def test_init_creates_openapi_client_and_runs_initialize(
    monkeypatch: pytest.MonkeyPatch, fake_redis: FakeRedis
) -> None:
    monkeypatch.setattr(gpdb_client_module, "Client", FakeGpdbClient)
    fake_redis.cached = 1

    vector = AnalyticdbVectorOpenAPI("COLLECTION_1", _config())

    assert vector._collection_name == "collection_1"
    assert isinstance(vector._client_config, open_api_models.Config)
    assert vector._client_config.user_agent == "dify"
    assert vector._client_config.access_key_id == "ak"
    assert isinstance(vector._client, FakeGpdbClient)
    assert vector._client.config is vector._client_config
    # _initialize ran: it took the instance lock and found the cache marker.
    assert fake_redis.lock_names == ["vector_initialize_instance-1_lock"]


def test_initialize_skips_when_cached(
    vector: AnalyticdbVectorOpenAPI, client: FakeGpdbClient, fake_redis: FakeRedis
) -> None:
    fake_redis.cached = 1

    vector._initialize()

    assert client.requests == []
    assert fake_redis.set_calls == []


def test_initialize_runs_when_cache_is_missing(
    vector: AnalyticdbVectorOpenAPI, client: FakeGpdbClient, fake_redis: FakeRedis
) -> None:
    vector._initialize()

    assert client.requests == [
        ("init_vector_database", MANAGER),
        ("describe_namespace", {**MANAGER, "Namespace": "dify"}),
    ]
    assert fake_redis.set_calls == [("vector_initialize_instance-1", 1, 3600)]


def test_initialize_vector_database_calls_openapi_client(
    vector: AnalyticdbVectorOpenAPI, client: FakeGpdbClient
) -> None:
    vector._initialize_vector_database()

    assert client.sent("init_vector_database") == [MANAGER]


def test_create_namespace_creates_when_namespace_not_found(
    vector: AnalyticdbVectorOpenAPI, client: FakeGpdbClient
) -> None:
    client.errors["describe_namespace"] = _api_error(404)

    vector._create_namespace_if_not_exists()

    assert client.sent("create_namespace") == [{**MANAGER, "Namespace": "dify", "NamespacePassword": "ns-password"}]


def test_create_namespace_raises_on_unexpected_api_error(
    vector: AnalyticdbVectorOpenAPI, client: FakeGpdbClient
) -> None:
    client.errors["describe_namespace"] = _api_error(500)

    with pytest.raises(ValueError, match="failed to create namespace"):
        vector._create_namespace_if_not_exists()

    assert client.sent("create_namespace") == []


def test_create_namespace_noop_when_namespace_exists(vector: AnalyticdbVectorOpenAPI, client: FakeGpdbClient) -> None:
    vector._create_namespace_if_not_exists()

    assert [name for name, _ in client.requests] == ["describe_namespace"]


def test_create_collection_if_not_exists_creates_when_missing(
    vector: AnalyticdbVectorOpenAPI, client: FakeGpdbClient, fake_redis: FakeRedis
) -> None:
    client.errors["describe_collection"] = _api_error(404)

    vector.create_collection_if_not_exists(embedding_dimension=1024)

    assert client.sent("create_collection") == [
        {
            **MANAGER,
            "Collection": "collection_1",
            "Dimension": 1024,
            "FullTextRetrievalFields": "page_content",
            "Metadata": '{"ref_doc_id":"text","page_content":"text","metadata_":"jsonb"}',
            "Metrics": "cosine",
            "Namespace": "dify",
        }
    ]
    assert fake_redis.set_calls == [("vector_indexing_collection_1", 1, 3600)]


def test_create_collection_if_not_exists_skips_when_cached(
    vector: AnalyticdbVectorOpenAPI, client: FakeGpdbClient, fake_redis: FakeRedis
) -> None:
    fake_redis.cached = 1

    vector.create_collection_if_not_exists(embedding_dimension=1024)

    assert client.requests == []


def test_create_collection_if_not_exists_raises_on_non_404_errors(
    vector: AnalyticdbVectorOpenAPI, client: FakeGpdbClient, fake_redis: FakeRedis
) -> None:
    client.errors["describe_collection"] = _api_error(500)

    with pytest.raises(ValueError, match="failed to create collection collection_1"):
        vector.create_collection_if_not_exists(embedding_dimension=512)

    assert client.sent("create_collection") == []
    assert fake_redis.set_calls == []


def test_openapi_add_delete_and_search_methods(vector: AnalyticdbVectorOpenAPI, client: FakeGpdbClient) -> None:
    documents = [
        Document(page_content="doc 1", metadata={"doc_id": "d1", "document_id": "doc-1"}),
        Document.model_construct(page_content="doc 2", metadata=None),
    ]
    embeddings = [[0.1, 0.2], [0.2, 0.3]]
    vector.add_texts(documents, embeddings)

    # The document without metadata is skipped.
    assert client.sent("upsert_collection_data") == [
        {
            **COLLECTION,
            "Rows": [
                {
                    "Metadata": {
                        "ref_doc_id": "d1",
                        "page_content": "doc 1",
                        "metadata_": json.dumps({"doc_id": "d1", "document_id": "doc-1"}),
                    },
                    "Vector": [0.1, 0.2],
                }
            ],
        }
    ]

    client.matches = [_match(0.5, "doc-1", "existing", [1.0])]
    assert vector.text_exists("d1") is True
    assert client.sent("query_collection_data")[-1]["Filter"] == "ref_doc_id='d1'"

    vector.delete_by_ids(["d1", "d2"])
    vector.delete_by_metadata_field("document_id", "doc-1")
    assert client.sent("delete_collection_data") == [
        {**COLLECTION, "CollectionDataFilter": "ref_doc_id IN ('d1','d2')"},
        {**COLLECTION, "CollectionDataFilter": "metadata_ ->> 'document_id' = 'doc-1'"},
    ]

    client.matches = [_match(0.1, "doc-2", "low", [3.0, 4.0]), _match(0.9, "doc-1", "high", [1.0, 2.0])]

    docs_by_vector = vector.search_by_vector([0.1, 0.2], top_k=2, score_threshold=0.5, document_ids_filter=["doc-1"])
    assert len(docs_by_vector) == 1
    assert docs_by_vector[0].page_content == "high"
    assert docs_by_vector[0].metadata["score"] == 0.9
    assert docs_by_vector[0].vector == [1.0, 2.0]
    vector_query = client.sent("query_collection_data")[-1]
    assert vector_query["Filter"] == "metadata_->>'document_id' IN ('doc-1')"
    assert vector_query["Vector"] == [0.1, 0.2]
    assert vector_query["TopK"] == 2

    docs_by_text = vector.search_by_full_text("hello", top_k=2, score_threshold=0.2)
    assert len(docs_by_text) == 1
    assert docs_by_text[0].page_content == "high"
    text_query = client.sent("query_collection_data")[-1]
    assert text_query["Content"] == "hello"
    assert text_query["Filter"] == ""


def test_text_exists_returns_false_when_matches_empty(vector: AnalyticdbVectorOpenAPI) -> None:
    assert vector.text_exists("missing-id") is False


def test_openapi_delete_success(vector: AnalyticdbVectorOpenAPI, client: FakeGpdbClient) -> None:
    vector.delete()

    assert client.sent("delete_collection") == [COLLECTION]


def test_openapi_delete_propagates_errors(vector: AnalyticdbVectorOpenAPI, client: FakeGpdbClient) -> None:
    client.errors["delete_collection"] = RuntimeError("boom")

    with pytest.raises(RuntimeError, match="boom"):
        vector.delete()
