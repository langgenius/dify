"""Workspace isolation of persistent and Redis embedding caches."""

import base64
import pickle
from types import SimpleNamespace
from unittest.mock import Mock

import numpy as np
import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.rag.embedding import cached_embedding
from core.rag.embedding.cached_embedding import CacheEmbedding
from graphon.model_runtime.entities.model_entities import ModelPropertyKey
from libs import helper
from models.dataset import Embedding


@pytest.fixture
def caches(sqlite_session: Session, monkeypatch: pytest.MonkeyPatch) -> Session:
    monkeypatch.setattr(cached_embedding, "db", SimpleNamespace(session=sqlite_session))
    entries: dict[str, object] = {}
    redis = Mock()
    redis.get.side_effect = entries.get
    redis.setex.side_effect = lambda key, _ttl, value: entries.__setitem__(key, value)
    monkeypatch.setattr(cached_embedding, "redis_client", redis)
    return sqlite_session


def model(tenant_id: str, vector: list[float]) -> Mock:
    instance = Mock(model_name="shared-model", provider="shared-provider", credentials={})
    instance.provider_model_bundle.configuration.tenant_id = tenant_id
    instance.model_type_instance.get_model_schema.return_value = SimpleNamespace(
        model_properties={ModelPropertyKey.MAX_CHUNKS: 10}
    )
    result = SimpleNamespace(embeddings=[np.array(vector)])
    instance.invoke_text_embedding.return_value = result
    instance.invoke_multimodal_embedding.return_value = result
    return instance


def document(cache: CacheEmbedding, image: bool) -> list[float]:
    if image:
        return cache.embed_multimodal_documents([{"file_id": "shared-input"}])[0]
    return cache.embed_documents(["shared-input"])[0]


def query(cache: CacheEmbedding, image: bool) -> list[float]:
    if image:
        return cache.embed_multimodal_query({"file_id": "shared-input"})
    return cache.embed_query("shared-input")


@pytest.mark.parametrize("image", [False, True], ids=["text", "image"])
@pytest.mark.parametrize("second_vector", [[0.0, 1.0], [0.0, 0.0, 1.0]], ids=["same-dimension", "different-dimension"])
def test_document_cache_isolated_by_workspace(caches: Session, image: bool, second_vector: list[float]) -> None:
    first = model("workspace-a", [1.0, 0.0])
    second = model("workspace-b", second_vector)
    a, b = CacheEmbedding(first), CacheEmbedding(second)

    assert document(a, image) == [1.0, 0.0]
    assert document(b, image) == second_vector
    assert document(a, image) == [1.0, 0.0]
    assert document(b, image) == second_vector
    assert len(caches.scalars(select(Embedding)).all()) == 2
    invoke = "invoke_multimodal_embedding" if image else "invoke_text_embedding"
    getattr(first, invoke).assert_called_once()
    getattr(second, invoke).assert_called_once()


@pytest.mark.parametrize("image", [False, True], ids=["text", "image"])
@pytest.mark.parametrize("second_vector", [[0.0, 1.0], [0.0, 0.0, 1.0]], ids=["same-dimension", "different-dimension"])
@pytest.mark.usefixtures("caches")
def test_query_cache_isolated_by_workspace(image: bool, second_vector: list[float]) -> None:
    first = model("workspace-a", [1.0, 0.0])
    second = model("workspace-b", second_vector)
    a, b = CacheEmbedding(first), CacheEmbedding(second)

    assert query(a, image) == [1.0, 0.0]
    assert query(b, image) == second_vector
    assert query(a, image) == [1.0, 0.0]
    assert query(b, image) == second_vector
    invoke = "invoke_multimodal_embedding" if image else "invoke_text_embedding"
    getattr(first, invoke).assert_called_once()
    getattr(second, invoke).assert_called_once()


@pytest.mark.parametrize("image", [False, True], ids=["text", "image"])
def test_legacy_document_cache_is_not_assigned_to_a_workspace(caches: Session, image: bool) -> None:
    caches.add(
        Embedding(
            model_name="shared-model",
            provider_name="shared-provider",
            hash="shared-input" if image else helper.generate_text_hash("shared-input"),
            embedding=pickle.dumps([1.0, 0.0]),
        )
    )
    caches.commit()

    assert document(CacheEmbedding(model("workspace-b", [0.0, 1.0])), image) == [0.0, 1.0]
    assert len(caches.scalars(select(Embedding)).all()) == 2


@pytest.mark.parametrize("image", [False, True], ids=["text", "image"])
@pytest.mark.usefixtures("caches")
def test_legacy_query_cache_is_not_assigned_to_a_workspace(image: bool) -> None:
    suffix = "shared-input" if image else helper.generate_text_hash("shared-input")
    cached_embedding.redis_client.setex(
        f"shared-provider_shared-model_{suffix}",
        600,
        base64.b64encode(np.array([1.0, 0.0]).tobytes()).decode(),
    )

    assert query(CacheEmbedding(model("workspace-b", [0.0, 1.0])), image) == [0.0, 1.0]
