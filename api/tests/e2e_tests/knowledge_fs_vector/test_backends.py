"""CI-owned native service acceptance. No mocks, LLM calls or existing datasets."""

import os
from uuid import uuid4

import pytest

from configs import dify_config
from services.knowledge_fs.vector_store import (
    VectorRequest,
    VectorStoreUnavailableError,
    configured_vector_client,
    execute_vector_request,
)
from services.knowledge_fs.vector_store_weaviate import WeaviateVectorStore

pytestmark = pytest.mark.skipif(
    os.getenv("KNOWLEDGE_FS_VECTOR_INTEGRATION") != "1", reason="Requires CI vector services"
)


@pytest.mark.parametrize("backend", ["elasticsearch", "weaviate"])
@pytest.mark.parametrize("kind", ["dense", "visual", "graph-entity", "graph-relation"])
def test_native_store_write_retry_authorization_isolation_and_delete(monkeypatch, backend, kind):
    monkeypatch.setattr(dify_config, "VECTOR_STORE", backend)
    scope = {
        "tenant_id": str(uuid4()),
        "knowledge_space_id": str(uuid4()),
        "vector_space_id": "integration-v1",
        "kind": kind,
        "dimension": 3,
    }
    first, nearest, generation = (str(uuid4()) for _ in range(3))
    points = [
        {"id": first, "generation_id": generation, "content_hash": "a" * 64, "vector": [3.0, 4.0, 0.0]},
        {"id": nearest, "generation_id": generation, "content_hash": "b" * 64, "vector": [1.0, 0.0, 0.0]},
    ]

    def request(operation, **kwargs):
        return VectorRequest.model_validate({"operation": operation, "scope": scope, **kwargs})

    with configured_vector_client(scope["tenant_id"]) as store:
        try:
            # A retried write must keep identities and metadata without duplicate points.
            for _ in range(2):
                execute_vector_request(store, request("upsert", points=points))
            readback = execute_vector_request(store, request("get", ids=[first, nearest]))["points"]
            assert {point["id"] for point in readback} == {first, nearest}
            for point in readback:
                original = next(p for p in points if p["id"] == point["id"])
                assert point["generation_id"] == generation
                assert point["content_hash"] == original["content_hash"]
                norm = sum(x * x for x in point["vector"]) ** 0.5
                expected_norm = sum(x * x for x in original["vector"]) ** 0.5
                assert [x / norm for x in point["vector"]] == pytest.approx(
                    [x / expected_norm for x in original["vector"]], abs=1e-5
                )

            # The globally nearest point is unauthorized and cannot crowd out the allowed one.
            result = execute_vector_request(store, request("search", ids=[first], query_vector=[1, 0, 0], limit=1))
            assert len(result["matches"]) == 1
            assert result["matches"][0]["id"] == first
            assert result["matches"][0]["score"] == pytest.approx(0.6, abs=1e-5)
            ranked = execute_vector_request(
                store, request("search", ids=[first, nearest], query_vector=[1, 0, 0], limit=2)
            )["matches"]
            assert [point["id"] for point in ranked] == [nearest, first]

            # Identical point IDs cannot cross tenant, space, model, kind or dimension boundaries.
            for key, value in [
                ("tenant_id", str(uuid4())),
                ("knowledge_space_id", str(uuid4())),
                ("vector_space_id", "other"),
                ("kind", "visual" if kind != "visual" else "dense"),
                ("dimension", 4),
            ]:
                isolated = VectorRequest.model_validate(
                    {"operation": "get", "scope": {**scope, key: value}, "ids": [first]}
                )
                assert execute_vector_request(store, isolated)["points"] == []
            with pytest.raises(VectorStoreUnavailableError, match="missing"):
                execute_vector_request(
                    store,
                    VectorRequest.model_validate(
                        {
                            "operation": "search",
                            "scope": {**scope, "tenant_id": str(uuid4())},
                            "ids": [first],
                            "query_vector": [1, 0, 0],
                        }
                    ),
                )

            for _ in range(2):
                execute_vector_request(store, request("delete", ids=[first]))
            assert execute_vector_request(store, request("get", ids=[first]))["points"] == []
            assert len(execute_vector_request(store, request("get", ids=[nearest]))["points"]) == 1
            assert (
                execute_vector_request(store, request("search", ids=[first], query_vector=[1, 0, 0]))["matches"] == []
            )
        finally:
            execute_vector_request(store, request("delete", ids=[first, nearest]))
            if isinstance(store, WeaviateVectorStore):
                store.client.collections.delete(store.collection_name(request("get", ids=[first]).scope))
            else:
                store.client.indices.delete(
                    index=request("get", ids=[first]).scope.collection_name, ignore_unavailable=True
                )
