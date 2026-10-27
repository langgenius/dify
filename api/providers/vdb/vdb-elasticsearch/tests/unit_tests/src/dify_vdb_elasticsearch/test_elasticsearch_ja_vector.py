import json
from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass
from typing import override

import dify_vdb_elasticsearch.elasticsearch_ja_vector as ja_module
import dify_vdb_elasticsearch.elasticsearch_vector as base_module
import pytest
from dify_vdb_elasticsearch.elasticsearch_ja_vector import ElasticSearchJaVector, ElasticSearchJaVectorFactory
from dify_vdb_elasticsearch.elasticsearch_vector import ElasticSearchConfig
from flask import Flask

from core.rag.datasource.vdb.field import Field
from core.rag.embedding.embedding_base import Embeddings
from models.dataset import Dataset


@dataclass(frozen=True)
class IndexCreation:
    """The arguments of one ``indices.create`` call."""

    index: str
    settings: dict[str, object]
    mappings: dict[str, dict[str, dict[str, object]]]


class FakeIndices:
    """The index API of the fake client: tracks which indices exist and records each creation."""

    def __init__(self) -> None:
        self.existing: set[str] = set()
        self.created: list[IndexCreation] = []

    def exists(self, *, index: str) -> bool:
        return index in self.existing

    def create(
        self, *, index: str, settings: dict[str, object], mappings: dict[str, dict[str, dict[str, object]]]
    ) -> None:
        self.created.append(IndexCreation(index, settings, mappings))
        self.existing.add(index)


class FakeElasticsearch:
    """Stands in for the Elasticsearch client: a reachable 8.x server with an in-memory index list."""

    def __init__(self) -> None:
        self.indices = FakeIndices()

    def ping(self) -> bool:
        return True

    def info(self) -> dict[str, dict[str, str]]:
        return {"version": {"number": "8.12.0"}}


class FakeRedis:
    """The parts of ``redis_client`` that index creation uses, returning one cached value for every key."""

    def __init__(self, cached: object = None) -> None:
        self.cached = cached
        self.set_calls: list[tuple[str, object, int | None]] = []

    @contextmanager
    def lock(self, name: str, timeout: int) -> Generator[None]:
        yield

    def get(self, key: str) -> object:
        return self.cached

    def set(self, key: str, value: object, ex: int | None = None) -> None:
        self.set_calls.append((key, value, ex))


class UnusedEmbeddings(Embeddings):
    """Embeddings the factory only passes on to the vector store."""

    @override
    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        raise NotImplementedError

    @override
    def embed_multimodal_documents(self, multimodel_documents: list[dict[str, object]]) -> list[list[float]]:
        raise NotImplementedError

    @override
    def embed_query(self, text: str) -> list[float]:
        raise NotImplementedError

    @override
    def embed_multimodal_query(self, multimodel_document: dict[str, object]) -> list[float]:
        raise NotImplementedError


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> FakeElasticsearch:
    client = FakeElasticsearch()
    monkeypatch.setattr(base_module, "Elasticsearch", lambda **_kwargs: client)
    return client


@pytest.fixture
def fake_redis(monkeypatch: pytest.MonkeyPatch) -> FakeRedis:
    redis = FakeRedis()
    monkeypatch.setattr(ja_module, "redis_client", redis)
    return redis


@pytest.fixture
def vector(client: FakeElasticsearch) -> ElasticSearchJaVector:
    vector = ElasticSearchJaVector(
        index_name="test",
        config=ElasticSearchConfig(host="localhost", port=9200, username="elastic", password="secret"),
        attributes=[],
    )
    assert vector._client is client
    return vector


def test_create_collection_cache_hit(
    vector: ElasticSearchJaVector, client: FakeElasticsearch, fake_redis: FakeRedis
) -> None:
    fake_redis.cached = 1

    vector.create_collection([[0.1, 0.2]], [{}])

    assert client.indices.created == []
    assert fake_redis.set_calls == []


def test_create_collection_create_and_exists_paths(
    vector: ElasticSearchJaVector, client: FakeElasticsearch, fake_redis: FakeRedis
) -> None:
    vector.create_collection([[0.1, 0.2, 0.3]], [{}])

    (creation,) = client.indices.created
    assert creation.index == "test"
    assert creation.mappings["properties"][Field.VECTOR]["dims"] == 3
    assert creation.mappings["properties"][Field.CONTENT_KEY]["analyzer"] == "ja_analyzer"
    assert fake_redis.set_calls == [("vector_indexing_test", 1, 3600)]

    # The index now exists, so only the cache marker is written again.
    vector.create_collection([[0.1, 0.2]], [{}])

    assert len(client.indices.created) == 1
    assert fake_redis.set_calls == [("vector_indexing_test", 1, 3600)] * 2


def test_ja_factory_uses_existing_or_generated_collection(monkeypatch: pytest.MonkeyPatch) -> None:
    factory = ElasticSearchJaVectorFactory()
    dataset_with_index = Dataset(
        id="dataset-1", index_struct=json.dumps({"vector_store": {"class_prefix": "EXISTING_COLLECTION"}})
    )
    dataset_without_index = Dataset(id="dataset-2")

    monkeypatch.setattr(ja_module.Dataset, "gen_collection_name_by_id", lambda _id: "AUTO_COLLECTION")
    app = Flask(__name__)
    app.config.update(
        ELASTICSEARCH_HOST="localhost",
        ELASTICSEARCH_PORT=9200,
        ELASTICSEARCH_USERNAME="elastic",
        ELASTICSEARCH_PASSWORD="secret",
    )
    built: list[tuple[str, ElasticSearchConfig]] = []

    def build_vector(*, index_name: str, config: ElasticSearchConfig, attributes: list[str]) -> str:
        built.append((index_name, config))
        return "vector"

    monkeypatch.setattr(ja_module, "ElasticSearchJaVector", build_vector)
    with app.app_context():
        result_1 = factory.init_vector(dataset_with_index, attributes=[], embeddings=UnusedEmbeddings(), session=None)
        result_2 = factory.init_vector(
            dataset_without_index, attributes=[], embeddings=UnusedEmbeddings(), session=None
        )

    # test_elasticsearch_vector.py reloads these modules, so build the expected config from the current class.
    expected_config = ja_module.ElasticSearchConfig(host="localhost", port=9200, username="elastic", password="secret")
    assert result_1 == "vector"
    assert result_2 == "vector"
    assert built == [("EXISTING_COLLECTION", expected_config), ("AUTO_COLLECTION", expected_config)]
    assert dataset_without_index.index_struct is not None
