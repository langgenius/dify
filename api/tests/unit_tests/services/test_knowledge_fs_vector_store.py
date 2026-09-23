from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from pydantic import ValidationError

from services.knowledge_fs.vector_store import (
    VectorRequest,
    VectorScope,
    VectorStoreUnavailableError,
    configured_vector_client,
    execute_vector_request,
)

QdrantClient = pytest.importorskip("qdrant_client").QdrantClient
models = pytest.importorskip("qdrant_client.http.models")
UnexpectedResponse = pytest.importorskip("qdrant_client.http.exceptions").UnexpectedResponse

TENANT = "018f0d60-7a49-7cc2-9c1b-5b36f18f0001"
SPACE = "018f0d60-7a49-7cc2-9c1b-5b36f18f0002"
GENERATION = "018f0d60-7a49-7cc2-9c1b-5b36f18f0003"
A = "018f0d60-7a49-7cc2-9c1b-5b36f18f0004"
B = "018f0d60-7a49-7cc2-9c1b-5b36f18f0005"
SCOPE = {
    "tenant_id": TENANT,
    "knowledge_space_id": SPACE,
    "vector_space_id": "embedding-v1",
    "kind": "dense",
    "dimension": 2,
}


def request(operation, **kwargs):
    return VectorRequest.model_validate({"operation": operation, "scope": SCOPE, **kwargs})


@pytest.fixture
def client():
    client = QdrantClient(":memory:")
    client.create_collection(
        VectorScope.model_validate(SCOPE).collection_name,
        vectors_config=models.VectorParams(size=2, distance=models.Distance.COSINE),
    )
    yield client
    client.close()


def test_native_vector_roundtrip_authorized_id_filter_and_idempotent_deletion(client):
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
def test_each_scope_dimension_has_a_distinct_reserved_namespace(field, value):
    original = VectorScope.model_validate(SCOPE).collection_name
    other = VectorScope.model_validate({**SCOPE, field: value}).collection_name
    assert other != original
    assert original.startswith("knowledgefs_v1_")
    assert SPACE not in original


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
def test_invalid_operations_fail_before_backend_io(payload):
    with pytest.raises(ValidationError):
        VectorRequest.model_validate({"scope": SCOPE, **payload})


def test_missing_collection_search_is_not_reported_as_empty_success():
    client = MagicMock()
    client.get_collection.side_effect = UnexpectedResponse(404, "missing", b"{}", {})
    with pytest.raises(VectorStoreUnavailableError, match="missing"):
        execute_vector_request(client, request("search", ids=[A], query_vector=[1, 0]))
    client.create_collection.assert_not_called()
    assert execute_vector_request(client, request("delete", ids=[A]))["points"] == []


def test_collection_creation_race_accepts_only_compatible_existing_collection(client):
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


def test_no_binding_never_allocates_a_paid_cluster(config_overrides):
    from services.tidb_binding_service import TidbBindingUnavailableError

    config_overrides(VECTOR_STORE="tidb_on_qdrant")
    with patch("services.tidb_binding_service._load_binding", return_value=None):
        with pytest.raises(TidbBindingUnavailableError, match="no active"):
            with configured_vector_client(TENANT):
                pytest.fail("unconfigured backend was opened")


def test_unsupported_backend_fails_explicitly(config_overrides):
    config_overrides(VECTOR_STORE="milvus")
    with pytest.raises(VectorStoreUnavailableError, match="does not support"):
        with configured_vector_client(TENANT):
            pytest.fail("unsupported backend was opened")


@pytest.mark.parametrize("allow_create", [True, False])
def test_tidb_client_uses_tenant_binding(config_overrides, allow_create):
    config_overrides(VECTOR_STORE="tidb_on_qdrant", TIDB_ON_QDRANT_URL="https://global.invalid")
    binding = SimpleNamespace(
        account="tenant-account", password="tenant-secret", qdrant_endpoint="https://tenant.invalid"
    )
    client = MagicMock()

    def open_client(**kwargs):
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
    client.close.assert_called_once()


def test_qdrant_configuration_closes_client_even_when_operation_fails(config_overrides):
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


def test_cloud_quota_is_enforced_before_any_vector_mutation():
    from services.vector_space_admission_service import VectorSpaceAdmissionError

    client = MagicMock()
    with patch(
        "services.vector_space_admission_service.VectorSpaceAdmissionService.ensure_external_points_can_be_indexed",
        side_effect=VectorSpaceAdmissionError("limit reached"),
    ):
        with pytest.raises(VectorSpaceAdmissionError):
            execute_vector_request(
                client,
                request(
                    "upsert",
                    points=[{"id": A, "generation_id": GENERATION, "content_hash": "a" * 64, "vector": [1, 0]}],
                ),
            )
    client.get_collection.assert_not_called()
    client.upsert.assert_not_called()


def test_cloud_quota_uses_existing_watermark_without_embedding_calls(config_overrides):
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
        patch.object(service, "_reserve_projected_usage", return_value=(0, 1024)) as reserve,
    ):
        for _ in range(2):
            service.ensure_external_points_can_be_indexed(
                tenant_id=TENANT, batch_id="stable-batch", point_count=2, dimension=3
            )
        assert reserve.call_args.kwargs["document_id"] == "knowledgefs:stable-batch"
        assert reserve.call_args.kwargs["document_estimate_bytes"] == 2 * (3 * 8 + 3584)
        reserve.return_value = (0, 61 * 1024 * 1024)
        with pytest.raises(VectorSpaceAdmissionError, match="exceeding"):
            service.ensure_external_points_can_be_indexed(
                tenant_id=TENANT, batch_id="large", point_count=2, dimension=3
            )
    with pytest.raises(VectorSpaceAdmissionError, match="Invalid"):
        service.ensure_external_points_can_be_indexed(tenant_id=TENANT, batch_id="bad", point_count=0, dimension=3)


def test_unmetered_workspace_does_not_contact_billing_or_reserve_quota(config_overrides):
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


def test_incompatible_collection_is_never_recreated_or_written(client):
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
    assert client.get_collection(collection).config.params.vectors.size == 3


def test_uncertain_native_delete_is_retryable(client):
    execute_vector_request(
        client,
        request("upsert", points=[{"id": A, "generation_id": GENERATION, "content_hash": "a" * 64, "vector": [1, 0]}]),
    )
    with patch.object(client, "delete"):
        with pytest.raises(VectorStoreUnavailableError, match="not yet visible"):
            execute_vector_request(client, request("delete", ids=[A]))
    execute_vector_request(client, request("delete", ids=[A]))
    assert execute_vector_request(client, request("get", ids=[A]))["points"] == []
