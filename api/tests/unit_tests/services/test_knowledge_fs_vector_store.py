from __future__ import annotations

from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, cast
from unittest.mock import patch

import pytest
from pydantic import ValidationError

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

if TYPE_CHECKING:
    from qdrant_client import QdrantClient as QdrantClientType
    from qdrant_client.http.models import CollectionInfo, FilterSelector, PointIdsList, PointStruct

    from services.knowledge_fs.vector_store import VectorResult

QdrantClient = pytest.importorskip("qdrant_client").QdrantClient
models = pytest.importorskip("qdrant_client.http.models")
UnexpectedResponse = pytest.importorskip("qdrant_client.http.exceptions").UnexpectedResponse

TENANT = "018f0d60-7a49-7cc2-9c1b-5b36f18f0001"
SPACE = "018f0d60-7a49-7cc2-9c1b-5b36f18f0002"
GENERATION = "018f0d60-7a49-7cc2-9c1b-5b36f18f0003"
A = "018f0d60-7a49-7cc2-9c1b-5b36f18f0004"
B = "018f0d60-7a49-7cc2-9c1b-5b36f18f0005"
SCOPE: dict[str, object] = {
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


def request(operation: str, **kwargs: object) -> VectorRequest:
    return VectorRequest.model_validate({"operation": operation, "scope": SCOPE, **kwargs})


@pytest.fixture(autouse=True)
def _vector_store_config(config_overrides: Callable[..., None]) -> None:
    config_overrides(DEPLOYMENT_EDITION="COMMUNITY")


@pytest.fixture
def client() -> Iterator[QdrantClientType]:
    client = QdrantClient(":memory:")
    client.create_collection(
        VectorScope.model_validate(SCOPE).collection_name,
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


def test_native_vector_roundtrip_authorized_id_filter_and_idempotent_deletion(client: QdrantClientType) -> None:
    points = [
        {"id": A, "generation_id": GENERATION, "content_hash": "a" * 64, "vector": [3, 4]},
        {"id": B, "generation_id": GENERATION, "content_hash": "b" * 64, "vector": [1, 0]},
    ]
    execute_vector_request(client, request("upsert", points=points))
    execute_vector_request(client, request("upsert", points=points))
    actual = execute_vector_request(client, request("get", ids=[A, B]))["points"]
    assert len(actual) == 2
    assert actual[0]["vector"] == pytest.approx([0.6, 0.8])
    assert actual[0]["content_hash"] == "a" * 64
    # The nearest point B is unauthorized. It must not crowd out the authorized A.
    matches = execute_vector_request(client, request("search", ids=[A], query_vector=[1, 0], limit=1))["matches"]
    assert [item["id"] for item in matches] == [A]
    assert matches[0]["score"] == pytest.approx(0.6)
    for _ in range(2):
        execute_vector_request(client, request("delete", ids=[A]))
    assert execute_vector_request(client, request("get", ids=[A]))["points"] == []
    assert len(execute_vector_request(client, request("get", ids=[B]))["points"]) == 1


@pytest.mark.parametrize(
    ("field", "value"),
    [("tenant_id", B), ("knowledge_space_id", B), ("vector_space_id", "other"), ("kind", "visual"), ("dimension", 3)],
)
def test_each_scope_dimension_has_a_distinct_reserved_namespace(field: str, value: object) -> None:
    original = VectorScope.model_validate(SCOPE)
    other = VectorScope.model_validate({**SCOPE, field: value})
    assert other.collection_name != original.collection_name
    assert other.legacy_collection_name != original.legacy_collection_name
    assert original.collection_name.startswith("knowledgefs_v1_dense_")
    assert SPACE not in original.collection_name


@pytest.mark.parametrize("kind", ["dense", "visual", "graph-entity", "graph-relation"])
def test_typed_collection_names_fit_tidb_delete_endpoint_and_normalize_uuid_case(kind: str) -> None:
    scope = VectorScope.model_validate({**SCOPE, "kind": kind})
    prefix = f"knowledgefs_v1_{kind.replace('-', '_')}_"
    assert scope.collection_name.startswith(prefix)
    assert len(scope.collection_name.removeprefix(prefix)) == min(32, 56 - len(prefix))
    assert len(scope.collection_name.removeprefix(prefix)) >= 26
    assert len(scope.collection_name) <= 56
    assert VectorScope.model_validate({**SCOPE, "kind": kind, "tenant_id": TENANT.upper()}) == scope


def test_legacy_namespace_keeps_pre_rename_hash() -> None:
    # Pin the pre-rename format so compatibility cannot drift with the new one.
    scope = VectorScope.model_validate(SCOPE)
    assert scope.legacy_collection_name == "knowledgefs_v1_488d91e70fe33beedcda4cb5e47b954dd5af7ca3"
    assert (
        scope.collection_name
        == "knowledgefs_v1_dense_" + scope.legacy_collection_name.removeprefix("knowledgefs_v1_")[:32]
    )


def test_legacy_and_typed_points_remain_searchable_and_deletable_together(client: QdrantClientType) -> None:
    scope = VectorScope.model_validate(SCOPE)
    legacy = scope.legacy_collection_name
    current = scope.collection_name
    client.create_collection(legacy, vectors_config=models.VectorParams(size=2, distance=models.Distance.COSINE))
    points = [
        {"id": A, "generation_id": GENERATION, "content_hash": "a" * 64, "vector": [3, 4]},
        {"id": B, "generation_id": GENERATION, "content_hash": "b" * 64, "vector": [1, 0]},
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
    assert len(execute_vector_request(client, request("get", ids=[A, B]))["points"]) == 2
    assert execute_vector_request(client, request("search", ids=[B], query_vector=[1, 0]))["matches"][0]["id"] == B
    assert not client.collection_exists(current)

    # A new document in this scope must create the typed name, without hiding old A.
    execute_vector_request(client, request("upsert", points=[points[1]]))
    assert client.count(current).count == 1
    assert client.count(legacy).count == 2
    assert len(execute_vector_request(client, request("get", ids=[A, B]))["points"]) == 2
    matches = execute_vector_request(client, request("search", ids=[A, B], query_vector=[1, 0], limit=1))["matches"]
    assert [match["id"] for match in matches] == [B]
    # B exists in both collections, but cannot crowd out an authorized point A.
    matches = execute_vector_request(client, request("search", ids=[A], query_vector=[1, 0], limit=1))["matches"]
    assert [match["id"] for match in matches] == [A]
    for _ in range(2):
        execute_vector_request(client, request("delete", ids=[B]))
    assert client.retrieve(current, [B]) == []
    assert client.retrieve(legacy, [B]) == []
    assert len(execute_vector_request(client, request("get", ids=[A]))["points"]) == 1


@pytest.mark.parametrize("operation", ["get", "search", "delete"])
def test_legacy_backend_failure_never_returns_partial_success(client: QdrantClientType, operation: str) -> None:
    execute_vector_request(
        client,
        request("upsert", points=[{"id": A, "generation_id": GENERATION, "content_hash": "a" * 64, "vector": [1, 0]}]),
    )
    native_get = client.get_collection

    def get_collection(name: str) -> CollectionInfo:
        if name == VectorScope.model_validate(SCOPE).legacy_collection_name:
            raise UnexpectedResponse(503, "unavailable", b"{}", {})
        return native_get(name)

    payload = request(operation, ids=[A], **({"query_vector": [1, 0]} if operation == "search" else {}))
    with patch.object(client, "get_collection", side_effect=get_collection):
        with pytest.raises(UnexpectedResponse):
            execute_vector_request(client, payload)


@pytest.mark.parametrize(
    "payload",
    [
        {"operation": "search", "ids": [], "query_vector": [1, 0]},
        {"operation": "search", "ids": [A], "query_vector": [1]},
        {"operation": "search", "ids": [A], "query_vector": [0, 0]},
        {"operation": "search", "ids": [A], "query_vector": [float("nan"), 1]},
        {"operation": "search", "ids": [A, A], "query_vector": [1, 0]},
        {"operation": "search", "ids": [A], "query_vector": [1, 0], "collection_name": "dataset"},
        {"operation": "search", "ids": [A], "query_vector": [1, 0], "endpoint": "http://example.com"},
        {"operation": "get", "ids": ["not-a-uuid"]},
        {"operation": "delete", "ids": [A], "query_vector": [1, 0]},
        {"operation": "upsert", "points": []},
    ],
)
def test_invalid_operations_fail_before_backend_io(payload: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        VectorRequest.model_validate({"scope": SCOPE, **payload})


def test_missing_collection_search_is_not_reported_as_empty_success() -> None:
    client = FakeQdrant()
    with pytest.raises(VectorStoreUnavailableError, match="missing"):
        client.execute(request("search", ids=[A], query_vector=[1, 0]))
    assert client.create_collection_calls == []
    assert client.execute(request("delete", ids=[A]))["points"] == []


def test_collection_creation_race_accepts_only_compatible_existing_collection(client: QdrantClientType) -> None:
    real_get = client.get_collection
    with (
        patch.object(
            client,
            "get_collection",
            side_effect=[
                UnexpectedResponse(404, "missing", b"{}", {}),
                real_get(VectorScope.model_validate(SCOPE).collection_name),
            ],
        ),
        patch.object(client, "create_collection", side_effect=RuntimeError("already exists")),
    ):
        execute_vector_request(
            client,
            request(
                "upsert", points=[{"id": A, "generation_id": GENERATION, "content_hash": "a" * 64, "vector": [1, 0]}]
            ),
        )
    assert len(execute_vector_request(client, request("get", ids=[A]))["points"]) == 1


def test_no_binding_never_allocates_a_paid_cluster(config_overrides: Callable[..., None]) -> None:
    from services.tidb_binding_service import TidbBindingUnavailableError

    config_overrides(VECTOR_STORE="tidb_on_qdrant")
    with patch("services.tidb_binding_service._load_binding", return_value=None):
        with pytest.raises(TidbBindingUnavailableError, match="no active"):
            with configured_vector_client(TENANT):
                pytest.fail("unconfigured backend was opened")


def test_unsupported_backend_fails_explicitly(config_overrides: Callable[..., None]) -> None:
    config_overrides(VECTOR_STORE="milvus")
    with pytest.raises(VectorStoreUnavailableError, match="does not support"):
        with configured_vector_client(TENANT):
            pytest.fail("unsupported backend was opened")


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


def test_qdrant_configuration_closes_client_even_when_operation_fails(config_overrides: Callable[..., None]) -> None:
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


def test_cloud_quota_is_enforced_before_any_vector_mutation() -> None:
    from services.vector_space_admission_service import VectorSpaceAdmissionError

    client = FakeQdrant()
    with patch(
        "services.vector_space_admission_service.VectorSpaceAdmissionService.ensure_external_points_can_be_indexed",
        side_effect=VectorSpaceAdmissionError("limit reached"),
    ):
        with pytest.raises(VectorSpaceAdmissionError):
            client.execute(
                request(
                    "upsert",
                    points=[{"id": A, "generation_id": GENERATION, "content_hash": "a" * 64, "vector": [1, 0]}],
                ),
            )
    assert client.get_collection_calls == []
    assert client.upsert_calls == []


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


def test_unmetered_workspace_does_not_contact_billing_or_reserve_quota(config_overrides: Callable[..., None]) -> None:
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


def test_incompatible_collection_is_never_recreated_or_written(client: QdrantClientType) -> None:
    collection = VectorScope.model_validate(SCOPE).collection_name
    client.delete_collection(collection)
    client.create_collection(collection, vectors_config=models.VectorParams(size=3, distance=models.Distance.COSINE))
    with pytest.raises(VectorStoreUnavailableError, match="incompatible"):
        execute_vector_request(
            client,
            request(
                "upsert", points=[{"id": A, "generation_id": GENERATION, "content_hash": "a" * 64, "vector": [1, 0]}]
            ),
        )
    from qdrant_client.http.models import VectorParams

    vectors = client.get_collection(collection).config.params.vectors
    assert isinstance(vectors, VectorParams)
    assert vectors.size == 3


def test_uncertain_native_delete_is_retryable(client: QdrantClientType) -> None:
    execute_vector_request(
        client,
        request("upsert", points=[{"id": A, "generation_id": GENERATION, "content_hash": "a" * 64, "vector": [1, 0]}]),
    )
    with patch.object(client, "delete"):
        with pytest.raises(VectorStoreUnavailableError, match="not yet visible"):
            execute_vector_request(client, request("delete", ids=[A]))
    execute_vector_request(client, request("delete", ids=[A]))
    assert execute_vector_request(client, request("get", ids=[A]))["points"] == []


type TidbHarness = tuple[FakeQdrant, CollectionInfo]


@pytest.fixture
def tidb_client(client: QdrantClientType, config_overrides: Callable[..., None]) -> tuple[FakeQdrant, CollectionInfo]:
    config_overrides(VECTOR_STORE="tidb_on_qdrant")
    scope = VectorScope.model_validate(SCOPE)
    info = client.get_collection(scope.collection_name)
    return FakeQdrant(collections={scope.collection_name: info}), info


def test_tidb_new_collection_indexes_and_stores_point_ids(tidb_client: TidbHarness) -> None:
    client, info = tidb_client
    client.execute(
        request("upsert", points=[{"id": A, "generation_id": GENERATION, "content_hash": "a" * 64, "vector": [1, 0]}]),
    )
    assert client.create_payload_index_calls == [
        {
            "collection_name": VectorScope.model_validate(SCOPE).collection_name,
            "field_name": TIDB_POINT_ID_FIELD,
            "field_schema": models.PayloadSchemaType.KEYWORD,
            "wait": True,
        }
    ]
    assert client.upserted_points[-1][0].payload == {
        "generation_id": GENERATION,
        "content_hash": "a" * 64,
        TIDB_POINT_ID_FIELD: A,
    }


@pytest.mark.parametrize("compatible", [False, True])
def test_tidb_payload_index_creation_race_requires_compatible_index(tidb_client: TidbHarness, compatible: bool) -> None:
    client, info = tidb_client

    def create_index(**_kwargs: object) -> None:
        if compatible:
            info.payload_schema[TIDB_POINT_ID_FIELD] = models.PayloadIndexInfo(data_type="keyword", points=0)
        raise RuntimeError("index creation raced or failed")

    client.create_payload_index_hook = create_index
    payload = request(
        "upsert", points=[{"id": A, "generation_id": GENERATION, "content_hash": "a" * 64, "vector": [1, 0]}]
    )
    if compatible:
        client.execute(payload)
        assert len(client.upsert_calls) == 1
    else:
        with pytest.raises(RuntimeError, match="creation"):
            client.execute(payload)
        assert client.upsert_calls == []


def test_tidb_nonempty_old_collection_is_not_marked_indexed(tidb_client: TidbHarness) -> None:
    client, info = tidb_client
    info.points_count = 1
    client.execute(
        request("upsert", points=[{"id": A, "generation_id": GENERATION, "content_hash": "a" * 64, "vector": [1, 0]}]),
    )
    assert client.create_payload_index_calls == []
    assert len(client.upsert_calls) == 1


@pytest.mark.parametrize("operation", ["search", "upsert"])
def test_tidb_wrong_id_index_type_fails_closed(tidb_client: TidbHarness, operation: str) -> None:
    client, info = tidb_client
    info.payload_schema[TIDB_POINT_ID_FIELD] = models.PayloadIndexInfo(data_type="integer", points=0)
    payload = (
        request("search", ids=[A], query_vector=[1, 0])
        if operation == "search"
        else request(
            "upsert", points=[{"id": A, "generation_id": GENERATION, "content_hash": "a" * 64, "vector": [1, 0]}]
        )
    )
    with pytest.raises(VectorStoreUnavailableError, match="ID index"):
        client.execute(payload)
    assert client.upsert_calls == []
    assert client.search_calls == []


def test_tidb_indexed_search_uses_supported_filter_and_payload_selection(tidb_client: TidbHarness) -> None:
    client, info = tidb_client
    info.payload_schema[TIDB_POINT_ID_FIELD] = models.PayloadIndexInfo(data_type="keyword", points=1)
    client.search_result = [models.ScoredPoint(id=A, version=0, score=0.6)]
    result = client.execute(request("search", ids=[A], query_vector=[1, 0], limit=1))
    assert result["matches"] == [{"id": A, "score": 0.6}]
    query = client.search_calls[-1]
    assert query["with_payload"] is True
    assert query["with_vectors"] is False
    assert query["query_filter"] == models.Filter(
        must=[models.FieldCondition(key=TIDB_POINT_ID_FIELD, match=models.MatchAny(any=[A]))]
    )
    assert client.retrieve_calls == []
    client.search_result = [models.ScoredPoint(id=B, version=0, score=1.0)]
    with pytest.raises(VectorStoreUnavailableError, match="unauthorized"):
        client.execute(request("search", ids=[A], query_vector=[1, 0]))


def test_tidb_unindexed_legacy_search_reads_only_authorized_ids(
    client: QdrantClientType, config_overrides: Callable[..., None]
) -> None:
    scope = VectorScope.model_validate(SCOPE)
    client.create_collection(
        scope.legacy_collection_name, vectors_config=models.VectorParams(size=2, distance="Cosine")
    )
    client.upsert(
        scope.legacy_collection_name,
        points=[
            models.PointStruct(id=A, vector=[3, 4]),
            models.PointStruct(id=B, vector=[1, 0]),
        ],
    )
    config_overrides(VECTOR_STORE="tidb_on_qdrant")
    with patch.object(client, "search", side_effect=AssertionError("Legacy search must not query unfiltered")):
        result = execute_vector_request(client, request("search", ids=[A], query_vector=[1, 0], limit=1))
        assert [match["id"] for match in result["matches"]] == [A]
        assert result["matches"][0]["score"] == pytest.approx(0.6)
        result = execute_vector_request(client, request("search", ids=[A, B], query_vector=[1, 0], limit=1))
        assert result["matches"] == [{"id": B, "score": 1.0}]


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
    result = client.execute(request("search", ids=ids, query_vector=[1, 0], limit=3))
    assert result["matches"] == [{"id": point_id, "score": 1.0} for point_id in ids[:3]]
    assert len(client.retrieve_calls) == 3
    assert client.search_calls == []
    client.retrieve_failure = RuntimeError("read failed")
    with pytest.raises(RuntimeError, match="read failed"):
        client.execute(request("search", ids=ids, query_vector=[1, 0]))


@pytest.mark.parametrize("vector", [None, [1], [0, 0], [float("nan"), 0], [1e20, 0]])
def test_tidb_unindexed_search_rejects_unscorable_vectors(tidb_client: TidbHarness, vector: list[float] | None) -> None:
    client, _ = tidb_client
    client.retrieve_result = [models.Record(id=A, vector=vector)]
    with pytest.raises(VectorStoreUnavailableError, match="dimensions|scored"):
        client.execute(request("search", ids=[A], query_vector=[1, 0]))


def test_tidb_unindexed_search_rejects_unrequested_points(tidb_client: TidbHarness) -> None:
    client, _ = tidb_client
    client.retrieve_result = [models.Record(id=B, vector=[1, 0])]
    with pytest.raises(VectorStoreUnavailableError, match="unauthorized"):
        client.execute(request("search", ids=[A], query_vector=[1, 0]))


def test_tidb_indexed_delete_uses_field_filter_and_verifies_absence(tidb_client: TidbHarness) -> None:
    client, info = tidb_client
    info.payload_schema[TIDB_POINT_ID_FIELD] = models.PayloadIndexInfo(data_type="keyword", points=2)
    client.retrieve_result = list[object]()
    client.execute(request("delete", ids=[A, B]))
    assert client.delete_selectors[-1] == models.FilterSelector(
        filter=models.Filter(must=[models.FieldCondition(key=TIDB_POINT_ID_FIELD, match=models.MatchAny(any=[A, B]))])
    )
    assert len(client.delete_calls) == 1
    client.retrieve_result = [models.Record(id=A)]
    with pytest.raises(VectorStoreUnavailableError, match="not yet visible"):
        client.execute(request("delete", ids=[A, B]))


def test_tidb_unindexed_delete_uses_single_ids_and_propagates_errors(tidb_client: TidbHarness) -> None:
    client, _ = tidb_client
    client.retrieve_result = list[object]()
    client.execute(request("delete", ids=[A, B]))
    assert client.create_payload_index_calls == [
        {
            "collection_name": VectorScope.model_validate(SCOPE).collection_name,
            "field_name": "content_hash",
            "field_schema": models.PayloadSchemaType.KEYWORD,
            "wait": True,
        }
    ]
    from qdrant_client.http.models import PointIdsList as NativePointIdsList

    selectors = [selector for selector in client.delete_selectors if isinstance(selector, NativePointIdsList)]
    assert len(selectors) == len(client.delete_selectors)
    assert sorted(selector.points for selector in selectors) == [[A], [B]]
    assert all(call["wait"] for call in client.delete_calls)
    client.delete_failure = RuntimeError("delete failed")
    with pytest.raises(RuntimeError, match="delete failed"):
        client.execute(request("delete", ids=[A, B]))


@pytest.mark.parametrize("remaining", [[], [models.Record(id=A)]])
def test_tidb_delete_not_found_still_requires_readback(tidb_client: TidbHarness, remaining: list[object]) -> None:
    client, info = tidb_client
    info.payload_schema[TIDB_POINT_ID_FIELD] = models.PayloadIndexInfo(data_type="keyword", points=1)
    client.delete_failure = UnexpectedResponse(404, "missing", b"{}", {})
    client.retrieve_result = remaining
    if remaining:
        with pytest.raises(VectorStoreUnavailableError, match="not yet visible"):
            client.execute(request("delete", ids=[A]))
    else:
        client.execute(request("delete", ids=[A]))
    assert len(client.retrieve_calls) == 1


@pytest.mark.parametrize("status", [404, 503])
def test_tidb_delete_readback_only_accepts_missing_collection(tidb_client: TidbHarness, status: int) -> None:
    client, info = tidb_client
    info.payload_schema[TIDB_POINT_ID_FIELD] = models.PayloadIndexInfo(data_type="keyword", points=1)
    client.retrieve_failure = UnexpectedResponse(status, "unavailable", b"{}", {})
    if status == 404:
        client.execute(request("delete", ids=[A]))
    else:
        with pytest.raises(UnexpectedResponse):
            client.execute(request("delete", ids=[A]))
