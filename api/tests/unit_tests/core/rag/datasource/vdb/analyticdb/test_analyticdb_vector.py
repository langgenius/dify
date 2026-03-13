from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

import core.rag.datasource.vdb.analyticdb.analyticdb_vector as analyticdb_module
from core.rag.datasource.vdb.analyticdb.analyticdb_vector import AnalyticdbVector, AnalyticdbVectorFactory
from core.rag.datasource.vdb.analyticdb.analyticdb_vector_openapi import AnalyticdbVectorOpenAPIConfig
from core.rag.datasource.vdb.analyticdb.analyticdb_vector_sql import AnalyticdbVectorBySqlConfig
from core.rag.models.document import Document


def test_init_prefers_openapi_when_api_config_is_provided():
    api_config = AnalyticdbVectorOpenAPIConfig(
        access_key_id="ak",
        access_key_secret="sk",
        region_id="cn-hangzhou",
        instance_id="instance-1",
        account="account",
        account_password="password",
        namespace="dify",
        namespace_password="ns-password",
    )

    with patch.object(analyticdb_module, "AnalyticdbVectorOpenAPI", return_value="openapi_runner") as openapi_cls:
        vector = AnalyticdbVector("COLLECTION", api_config=api_config, sql_config=None)

    assert vector.analyticdb_vector == "openapi_runner"
    openapi_cls.assert_called_once_with("COLLECTION", api_config)


def test_init_uses_sql_implementation_when_api_config_is_missing():
    sql_config = AnalyticdbVectorBySqlConfig(
        host="localhost",
        port=5432,
        account="account",
        account_password="password",
        min_connection=1,
        max_connection=2,
        namespace="dify",
    )

    with patch.object(analyticdb_module, "AnalyticdbVectorBySql", return_value="sql_runner") as sql_cls:
        vector = AnalyticdbVector("COLLECTION", api_config=None, sql_config=sql_config)

    assert vector.analyticdb_vector == "sql_runner"
    sql_cls.assert_called_once_with("COLLECTION", sql_config)


def test_init_raises_when_both_configs_are_missing():
    with pytest.raises(ValueError, match="Either api_config or sql_config must be provided"):
        AnalyticdbVector("COLLECTION", api_config=None, sql_config=None)


def test_vector_methods_delegate_to_underlying_implementation():
    runner = MagicMock()
    runner.search_by_vector.return_value = [Document(page_content="v", metadata={"doc_id": "1"})]
    runner.search_by_full_text.return_value = [Document(page_content="t", metadata={"doc_id": "2"})]
    runner.text_exists.return_value = True

    vector = AnalyticdbVector.__new__(AnalyticdbVector)
    vector.analyticdb_vector = runner

    texts = [Document(page_content="hello", metadata={"doc_id": "d1"})]
    vector.create(texts=texts, embeddings=[[0.1, 0.2]])
    vector.add_texts(documents=texts, embeddings=[[0.1, 0.2]])
    assert vector.text_exists("d1") is True
    vector.delete_by_ids(["d1"])
    vector.delete_by_metadata_field("document_id", "doc-1")
    assert vector.search_by_vector([0.1, 0.2], top_k=2) == runner.search_by_vector.return_value
    assert vector.search_by_full_text("hello", top_k=2) == runner.search_by_full_text.return_value
    vector.delete()

    runner._create_collection_if_not_exists.assert_called_once_with(2)
    runner.add_texts.assert_any_call(texts, [[0.1, 0.2]])
    runner.delete_by_ids.assert_called_once_with(["d1"])
    runner.delete_by_metadata_field.assert_called_once_with("document_id", "doc-1")
    runner.delete.assert_called_once()


def test_get_type_is_analyticdb():
    vector = AnalyticdbVector.__new__(AnalyticdbVector)
    assert vector.get_type() == "analyticdb"


def test_factory_builds_openapi_config_when_host_is_missing(monkeypatch):
    factory = AnalyticdbVectorFactory()
    dataset = SimpleNamespace(id="dataset-1", index_struct_dict=None, index_struct=None)

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

    with patch.object(analyticdb_module, "AnalyticdbVector", return_value="vector") as vector_cls:
        result = factory.init_vector(dataset, attributes=[], embeddings=MagicMock())

    assert result == "vector"
    args = vector_cls.call_args.args
    assert args[0] == "auto_collection"
    assert isinstance(args[1], AnalyticdbVectorOpenAPIConfig)
    assert args[2] is None
    assert dataset.index_struct is not None


def test_factory_builds_sql_config_when_host_is_present(monkeypatch):
    factory = AnalyticdbVectorFactory()
    dataset = SimpleNamespace(
        id="dataset-2", index_struct_dict={"vector_store": {"class_prefix": "EXISTING"}}, index_struct=None
    )

    monkeypatch.setattr(analyticdb_module.dify_config, "ANALYTICDB_HOST", "127.0.0.1")
    monkeypatch.setattr(analyticdb_module.dify_config, "ANALYTICDB_PORT", 5432)
    monkeypatch.setattr(analyticdb_module.dify_config, "ANALYTICDB_ACCOUNT", "account")
    monkeypatch.setattr(analyticdb_module.dify_config, "ANALYTICDB_PASSWORD", "password")
    monkeypatch.setattr(analyticdb_module.dify_config, "ANALYTICDB_MIN_CONNECTION", 1)
    monkeypatch.setattr(analyticdb_module.dify_config, "ANALYTICDB_MAX_CONNECTION", 3)
    monkeypatch.setattr(analyticdb_module.dify_config, "ANALYTICDB_NAMESPACE", "dify")

    with patch.object(analyticdb_module, "AnalyticdbVector", return_value="vector") as vector_cls:
        result = factory.init_vector(dataset, attributes=[], embeddings=MagicMock())

    assert result == "vector"
    args = vector_cls.call_args.args
    assert args[0] == "existing"
    assert args[1] is None
    assert isinstance(args[2], AnalyticdbVectorBySqlConfig)
