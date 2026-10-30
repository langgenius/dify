import json
from typing import override

import dify_vdb_analyticdb.analyticdb_vector as analyticdb_module
import pytest
from dify_vdb_analyticdb.analyticdb_vector import AnalyticdbVector, AnalyticdbVectorFactory
from dify_vdb_analyticdb.analyticdb_vector_openapi import AnalyticdbVectorOpenAPIConfig
from dify_vdb_analyticdb.analyticdb_vector_sql import AnalyticdbVectorBySqlConfig

from core.rag.embedding.embedding_base import Embeddings
from core.rag.models.document import Document
from models.dataset import Dataset


class RecordingRunner:
    """Stands in for the OpenAPI or SQL implementation and records each call AnalyticdbVector delegates to it."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, tuple[object, ...]]] = []
        self.vector_hits = [Document(page_content="v", metadata={"doc_id": "1"})]
        self.text_hits = [Document(page_content="t", metadata={"doc_id": "2"})]

    def create_collection_if_not_exists(self, embedding_dimension: int) -> None:
        self.calls.append(("create_collection_if_not_exists", (embedding_dimension,)))

    def add_texts(self, documents: list[Document], embeddings: list[list[float]]) -> None:
        self.calls.append(("add_texts", (documents, embeddings)))

    def text_exists(self, id: str) -> bool:
        self.calls.append(("text_exists", (id,)))
        return True

    def delete_by_ids(self, ids: list[str]) -> None:
        self.calls.append(("delete_by_ids", (ids,)))

    def delete_by_metadata_field(self, key: str, value: str) -> None:
        self.calls.append(("delete_by_metadata_field", (key, value)))

    def search_by_vector(self, query_vector: list[float], **kwargs: object) -> list[Document]:
        self.calls.append(("search_by_vector", (query_vector, kwargs)))
        return self.vector_hits

    def search_by_full_text(self, query: str, **kwargs: object) -> list[Document]:
        self.calls.append(("search_by_full_text", (query, kwargs)))
        return self.text_hits

    def delete(self) -> None:
        self.calls.append(("delete", ()))


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


def _api_config() -> AnalyticdbVectorOpenAPIConfig:
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


def _sql_config() -> AnalyticdbVectorBySqlConfig:
    return AnalyticdbVectorBySqlConfig(
        host="localhost",
        port=5432,
        account="account",
        account_password="password",
        min_connection=1,
        max_connection=2,
        namespace="dify",
    )


def test_init_prefers_openapi_when_api_config_is_provided(monkeypatch: pytest.MonkeyPatch) -> None:
    api_config = _api_config()
    runner = RecordingRunner()
    built: list[tuple[str, AnalyticdbVectorOpenAPIConfig]] = []

    def build_openapi(collection_name: str, config: AnalyticdbVectorOpenAPIConfig) -> RecordingRunner:
        built.append((collection_name, config))
        return runner

    monkeypatch.setattr(analyticdb_module, "AnalyticdbVectorOpenAPI", build_openapi)
    vector = AnalyticdbVector("COLLECTION", api_config=api_config, sql_config=None)

    assert vector.analyticdb_vector is runner
    assert built == [("COLLECTION", api_config)]


def test_init_uses_sql_implementation_when_api_config_is_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    sql_config = _sql_config()
    runner = RecordingRunner()
    built: list[tuple[str, AnalyticdbVectorBySqlConfig]] = []

    def build_sql(collection_name: str, config: AnalyticdbVectorBySqlConfig) -> RecordingRunner:
        built.append((collection_name, config))
        return runner

    monkeypatch.setattr(analyticdb_module, "AnalyticdbVectorBySql", build_sql)
    vector = AnalyticdbVector("COLLECTION", api_config=None, sql_config=sql_config)

    assert vector.analyticdb_vector is runner
    assert built == [("COLLECTION", sql_config)]


def test_init_raises_when_both_configs_are_missing() -> None:
    with pytest.raises(ValueError, match="Either api_config or sql_config must be provided"):
        AnalyticdbVector("COLLECTION", api_config=None, sql_config=None)


def test_vector_methods_delegate_to_underlying_implementation(monkeypatch: pytest.MonkeyPatch) -> None:
    runner = RecordingRunner()
    monkeypatch.setattr(analyticdb_module, "AnalyticdbVectorBySql", lambda _collection_name, _config: runner)
    vector = AnalyticdbVector("COLLECTION", api_config=None, sql_config=_sql_config())

    texts = [Document(page_content="hello", metadata={"doc_id": "d1"})]
    vector.create(texts=texts, embeddings=[[0.1, 0.2]])
    vector.add_texts(documents=texts, embeddings=[[0.1, 0.2]])
    assert vector.text_exists("d1") is True
    vector.delete_by_ids(["d1"])
    vector.delete_by_metadata_field("document_id", "doc-1")
    assert vector.search_by_vector([0.1, 0.2], top_k=2) == runner.vector_hits
    assert vector.search_by_full_text("hello", top_k=2) == runner.text_hits
    vector.delete()

    assert runner.calls == [
        ("create_collection_if_not_exists", (2,)),
        ("add_texts", (texts, [[0.1, 0.2]])),
        ("add_texts", (texts, [[0.1, 0.2]])),
        ("text_exists", ("d1",)),
        ("delete_by_ids", (["d1"],)),
        ("delete_by_metadata_field", ("document_id", "doc-1")),
        ("search_by_vector", ([0.1, 0.2], {"top_k": 2})),
        ("search_by_full_text", ("hello", {"top_k": 2})),
        ("delete", ()),
    ]


def test_get_type_is_analyticdb() -> None:
    vector = AnalyticdbVector.__new__(AnalyticdbVector)
    assert vector.get_type() == "analyticdb"


def test_factory_builds_openapi_config_when_host_is_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    factory = AnalyticdbVectorFactory()
    dataset = Dataset(id="dataset-1")

    monkeypatch.setattr(analyticdb_module.Dataset, "gen_collection_name_by_id", lambda _id: "AUTO_COLLECTION")
    monkeypatch.setattr(analyticdb_module.dify_config, "ANALYTICDB_HOST", None)
    monkeypatch.setattr(analyticdb_module.dify_config, "ANALYTICDB_KEY_ID", "ak")
    monkeypatch.setattr(analyticdb_module.dify_config, "ANALYTICDB_KEY_SECRET", "sk")
    monkeypatch.setattr(analyticdb_module.dify_config, "ANALYTICDB_REGION_ID", "cn-hz")
    monkeypatch.setattr(analyticdb_module.dify_config, "ANALYTICDB_INSTANCE_ID", "instance")
    monkeypatch.setattr(analyticdb_module.dify_config, "ANALYTICDB_ACCOUNT", "account")
    monkeypatch.setattr(analyticdb_module.dify_config, "ANALYTICDB_PASSWORD", "password")
    monkeypatch.setattr(analyticdb_module.dify_config, "ANALYTICDB_NAMESPACE", "dify")
    monkeypatch.setattr(analyticdb_module.dify_config, "ANALYTICDB_NAMESPACE_PASSWORD", "ns-password")
    built: list[tuple[str, AnalyticdbVectorOpenAPIConfig | None, AnalyticdbVectorBySqlConfig | None]] = []

    def build_vector(
        collection_name: str,
        api_config: AnalyticdbVectorOpenAPIConfig | None,
        sql_config: AnalyticdbVectorBySqlConfig | None,
    ) -> str:
        built.append((collection_name, api_config, sql_config))
        return "vector"

    monkeypatch.setattr(analyticdb_module, "AnalyticdbVector", build_vector)
    result = factory.init_vector(dataset, attributes=[], embeddings=UnusedEmbeddings(), session=None)

    assert result == "vector"
    assert built == [
        (
            "auto_collection",
            AnalyticdbVectorOpenAPIConfig(
                access_key_id="ak",
                access_key_secret="sk",
                region_id="cn-hz",
                instance_id="instance",
                account="account",
                account_password="password",
                namespace="dify",
                namespace_password="ns-password",
            ),
            None,
        )
    ]
    assert dataset.index_struct is not None


def test_factory_builds_sql_config_when_host_is_present(monkeypatch: pytest.MonkeyPatch) -> None:
    factory = AnalyticdbVectorFactory()
    dataset = Dataset(id="dataset-2", index_struct=json.dumps({"vector_store": {"class_prefix": "EXISTING"}}))

    monkeypatch.setattr(analyticdb_module.dify_config, "ANALYTICDB_HOST", "127.0.0.1")
    monkeypatch.setattr(analyticdb_module.dify_config, "ANALYTICDB_PORT", 5432)
    monkeypatch.setattr(analyticdb_module.dify_config, "ANALYTICDB_ACCOUNT", "account")
    monkeypatch.setattr(analyticdb_module.dify_config, "ANALYTICDB_PASSWORD", "password")
    monkeypatch.setattr(analyticdb_module.dify_config, "ANALYTICDB_MIN_CONNECTION", 1)
    monkeypatch.setattr(analyticdb_module.dify_config, "ANALYTICDB_MAX_CONNECTION", 3)
    monkeypatch.setattr(analyticdb_module.dify_config, "ANALYTICDB_NAMESPACE", "dify")
    built: list[tuple[str, AnalyticdbVectorOpenAPIConfig | None, AnalyticdbVectorBySqlConfig | None]] = []

    def build_vector(
        collection_name: str,
        api_config: AnalyticdbVectorOpenAPIConfig | None,
        sql_config: AnalyticdbVectorBySqlConfig | None,
    ) -> str:
        built.append((collection_name, api_config, sql_config))
        return "vector"

    monkeypatch.setattr(analyticdb_module, "AnalyticdbVector", build_vector)
    result = factory.init_vector(dataset, attributes=[], embeddings=UnusedEmbeddings(), session=None)

    assert result == "vector"
    assert built == [
        (
            "existing",
            None,
            AnalyticdbVectorBySqlConfig(
                host="127.0.0.1",
                port=5432,
                account="account",
                account_password="password",
                min_connection=1,
                max_connection=3,
                namespace="dify",
            ),
        )
    ]
