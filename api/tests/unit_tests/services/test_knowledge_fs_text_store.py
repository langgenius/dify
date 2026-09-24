import hashlib
from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from pydantic import ValidationError
from qdrant_client import QdrantClient
from qdrant_client.http.exceptions import UnexpectedResponse

from configs import dify_config
from services.knowledge_fs.text_store import (
    TextPayload,
    TextPoint,
    TextScope,
    configured_text_client,
    execute_text_request,
)
from services.knowledge_fs.text_store_native import (
    ElasticsearchTextStore,
    QdrantTextStore,
    WeaviateTextStore,
    lexical_sparse_vector,
)
from services.knowledge_fs.vector_store import VectorStoreUnavailableError
from services.knowledge_fs.vector_store_elasticsearch import ElasticsearchVectorStore
from services.knowledge_fs.vector_store_weaviate import WeaviateVectorStore

A, B, C, GENERATION = (f"00000000-0000-4000-8000-{n:012d}" for n in (1, 2, 3, 4))
SCOPE = {"tenant_id": A, "knowledge_space_id": B, "index_version": "fts-v1"}


def point(identifier=A, text="refund policy 退 款"):
    return {
        "id": identifier,
        "generation_id": GENERATION,
        "content_hash": hashlib.sha256(text.encode()).hexdigest(),
        "text": text,
    }


def request(operation, **kwargs):
    return TextPayload.model_validate({"operation": operation, "scope": SCOPE, **kwargs})


@pytest.fixture
def qdrant(monkeypatch):
    # qdrant-client 1.9 local sparse evaluator references the pre-NumPy-2 alias.
    # Remote Qdrant does not execute this emulator code. Exercise remote 1.8 in CI too.
    import numpy as np

    monkeypatch.setattr(np, "NINF", -np.inf, raising=False)
    client = QdrantClient(":memory:")
    original = client.get_collection

    def get_collection(name):
        if not client.collection_exists(name):
            raise UnexpectedResponse(404, "missing", b"{}", {})
        return original(name)

    with patch.object(client, "get_collection", side_effect=get_collection):
        yield QdrantTextStore(client)
    client.close()


def test_native_qdrant_fulltext_roundtrip_authorized_ranking_retry_and_delete(qdrant):
    points = [point(), point(B, "refund refund refund 退 款"), point(C, "vacation 假 期")]
    for _ in range(2):
        execute_text_request(qdrant, request("upsert", points=points))
    assert len(execute_text_request(qdrant, request("get", ids=[A, B, C]))["points"]) == 3
    for query in ["refund", "退 款"]:
        matches = execute_text_request(qdrant, request("search", ids=[A, C], query=query))["matches"]
        assert [m["id"] for m in matches] == [A]
        assert matches[0]["score"] > 0
    assert not execute_text_request(qdrant, request("search", ids=[A, B, C], query="refund vacation"))["matches"]
    assert [
        m["id"]
        for m in execute_text_request(qdrant, request("search", ids=[A, B, C], query="refund policy"))["matches"]
    ] == [A]
    ranked = execute_text_request(qdrant, request("search", ids=[A, B, C], query="refund"))["matches"]
    assert [m["id"] for m in ranked] == [B, A]
    assert not execute_text_request(qdrant, request("search", ids=[A], query="missing"))["matches"]
    for _ in range(2):
        execute_text_request(qdrant, request("delete", ids=[A]))
    assert not execute_text_request(qdrant, request("get", ids=[A]))["points"]
    assert len(execute_text_request(qdrant, request("get", ids=[B]))["points"]) == 1
    assert not execute_text_request(qdrant, request("search", ids=[A], query="refund"))["matches"]


@pytest.mark.parametrize(("key", "value"), [("tenant_id", C), ("knowledge_space_id", C), ("index_version", "other")])
def test_scope_isolation_and_missing_search_fails_closed(qdrant, key, value):
    execute_text_request(qdrant, request("upsert", points=[point()]))
    scope = {**SCOPE, key: value}
    assert TextScope.model_validate(scope).collection_name != TextScope.model_validate(SCOPE).collection_name
    assert not execute_text_request(qdrant, TextPayload(operation="get", scope=scope, ids=[A]))["points"]
    assert not execute_text_request(qdrant, TextPayload(operation="delete", scope=scope, ids=[A]))["points"]
    with pytest.raises(VectorStoreUnavailableError, match="missing"):
        execute_text_request(qdrant, TextPayload(operation="search", scope=scope, ids=[A], query="refund"))


@pytest.mark.parametrize(
    ("operation", "kwargs"),
    [
        ("upsert", {}),
        ("upsert", {"points": [point(), point()]}),
        ("upsert", {"points": [point()], "query": "x"}),
        ("get", {"ids": []}),
        ("get", {"ids": [A, A]}),
        ("get", {"ids": [A], "query": "x"}),
        ("search", {"ids": [A], "query": " "}),
        ("delete", {"ids": [A], "points": [point()]}),
    ],
)
def test_invalid_operations_rejected(operation, kwargs):
    with pytest.raises(ValidationError):
        request(operation, **kwargs)


@pytest.mark.parametrize("text", [" ", "汉" * (1024 * 1024 // 3 + 1)])
def test_invalid_text_byte_length(text):
    with pytest.raises(ValidationError):
        TextPoint.model_validate(point(text=text))


def test_checksum_and_extra_configuration_rejected():
    with pytest.raises(ValidationError):
        TextPoint.model_validate({**point(), "content_hash": "a" * 64})
    with pytest.raises(ValidationError):
        TextPayload.model_validate({**request("get", ids=[A]).model_dump(), "endpoint": "untrusted"})
    assert TextScope.model_validate(SCOPE).collection_name.startswith("knowledgefs_v1_fts_")
    assert len(TextScope.model_validate(SCOPE).collection_name) <= 56


@pytest.mark.parametrize(
    "result",
    [
        {"points": [point(B)], "matches": []},
        {"points": [point(), point()], "matches": []},
    ],
)
def test_invalid_backend_readback_rejected(result):
    with pytest.raises(VectorStoreUnavailableError):
        execute_text_request(SimpleNamespace(execute=lambda _: result), request("get", ids=[A]))


@pytest.mark.parametrize(
    "matches", [[{"id": B, "score": 1}], [{"id": A, "score": float("nan")}], [{"id": A, "score": 1}] * 2]
)
def test_unauthorized_duplicate_and_nonfinite_matches_rejected(matches):
    with pytest.raises(VectorStoreUnavailableError):
        execute_text_request(
            SimpleNamespace(execute=lambda _: {"points": [], "matches": matches}),
            request("search", ids=[A], query="refund"),
        )
    with pytest.raises(VectorStoreUnavailableError):
        execute_text_request(
            SimpleNamespace(execute=lambda _: {"points": [], "matches": matches * 2}),
            request("search", ids=[A], query="refund", limit=1),
        )


@pytest.mark.parametrize(
    ("backend", "wrapper", "expected"),
    [
        ("elasticsearch", ElasticsearchVectorStore, ElasticsearchTextStore),
        ("weaviate", WeaviateVectorStore, WeaviateTextStore),
    ],
)
def test_selection_reuses_vector_configuration(monkeypatch, backend, wrapper, expected):
    monkeypatch.setattr(dify_config, "VECTOR_STORE", backend)
    native = wrapper(MagicMock())
    with patch(
        "services.knowledge_fs.vector_store.configured_vector_client", return_value=nullcontext(native)
    ) as factory:
        with configured_text_client(A, allow_create=True) as store:
            assert isinstance(store, expected)
            assert store.client is native.client
        factory.assert_called_once_with(A, allow_create=True)


def test_qdrant_selection_and_unsupported_provider(monkeypatch):
    monkeypatch.setattr(dify_config, "VECTOR_STORE", "qdrant")
    native = QdrantClient(":memory:")
    with patch("services.knowledge_fs.vector_store.configured_vector_client", return_value=nullcontext(native)):
        with configured_text_client(A) as store:
            assert isinstance(store, QdrantTextStore)
    native.close()
    with patch("services.knowledge_fs.vector_store.configured_vector_client", return_value=nullcontext(object())):
        with pytest.raises(VectorStoreUnavailableError):
            with configured_text_client(A):
                pass


def test_sparse_weights_are_order_independent_and_normalized():
    indices, values = lexical_sparse_vector("refund 退 款 refund")
    assert (indices, values) == lexical_sparse_vector("款 refund refund 退")
    assert sum(v * v for v in values) == pytest.approx(1)
