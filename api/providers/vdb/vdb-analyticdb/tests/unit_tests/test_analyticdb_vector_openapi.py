import json
import sys
import types
from types import SimpleNamespace
from unittest.mock import MagicMock

import dify_vdb_analyticdb.analyticdb_vector_openapi as openapi_module
import pytest
from dify_vdb_analyticdb.analyticdb_vector_openapi import (
    AnalyticdbVectorOpenAPI,
    AnalyticdbVectorOpenAPIConfig,
)

from core.rag.models.document import Document


def _request_class(name: str):
    class _Request:
        def __init__(self, **kwargs):
            for key, value in kwargs.items():
                setattr(self, key, value)

    _Request.__name__ = name
    return _Request


def _install_openapi_stubs(monkeypatch: pytest.MonkeyPatch):
    gpdb_package = types.ModuleType("alibabacloud_gpdb20160503")
    gpdb_package.__path__ = []
    gpdb_models = types.ModuleType("alibabacloud_gpdb20160503.models")
    for class_name in [
        "InitVectorDatabaseRequest",
        "DescribeNamespaceRequest",
        "CreateNamespaceRequest",
        "DescribeCollectionRequest",
        "CreateCollectionRequest",
        "UpsertCollectionDataRequestRows",
        "UpsertCollectionDataRequest",
        "QueryCollectionDataRequest",
        "DeleteCollectionDataRequest",
        "DeleteCollectionRequest",
    ]:
        setattr(gpdb_models, class_name, _request_class(class_name))

    class _Client:
        def __init__(self, config):
            self.config = config

    gpdb_client = types.ModuleType("alibabacloud_gpdb20160503.client")
    gpdb_client.Client = _Client
    gpdb_package.models = gpdb_models

    tea_openapi = types.ModuleType("alibabacloud_tea_openapi")
    tea_openapi.__path__ = []
    tea_openapi_models = types.ModuleType("alibabacloud_tea_openapi.models")

    class OpenApiConfig:
        def __init__(self, **kwargs):
            for key, value in kwargs.items():
                setattr(self, key, value)

    tea_openapi_models.Config = OpenApiConfig
    tea_openapi.models = tea_openapi_models

    tea_package = types.ModuleType("Tea")
    tea_package.__path__ = []
    tea_exceptions = types.ModuleType("Tea.exceptions")

    class TeaError(Exception):
        def __init__(self, status_code=None, **kwargs):
            super().__init__("TeaException")
            status_code = kwargs.get("statusCode", status_code)
            self.statusCode = status_code
            self.status_code = status_code

    tea_exceptions.TeaException = TeaError
    tea_package.exceptions = tea_exceptions

    monkeypatch.setitem(sys.modules, "alibabacloud_gpdb20160503", gpdb_package)
    monkeypatch.setitem(sys.modules, "alibabacloud_gpdb20160503.models", gpdb_models)
    monkeypatch.setitem(sys.modules, "alibabacloud_gpdb20160503.client", gpdb_client)
    monkeypatch.setitem(sys.modules, "alibabacloud_tea_openapi", tea_openapi)
    monkeypatch.setitem(sys.modules, "alibabacloud_tea_openapi.models", tea_openapi_models)
    monkeypatch.setitem(sys.modules, "Tea", tea_package)
    monkeypatch.setitem(sys.modules, "Tea.exceptions", tea_exceptions)

    return SimpleNamespace(models=gpdb_models, TeaException=TeaError, OpenApiConfig=OpenApiConfig)


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
def test_openapi_config_validation(field, value, error_message):
    values = _config().model_dump()
    values[field] = value

    with pytest.raises(ValueError, match=error_message):
        AnalyticdbVectorOpenAPIConfig.model_validate(values)


def test_openapi_config_to_client_params():
    config = _config()
    params = config.to_analyticdb_client_params()

    assert params["access_key_id"] == "ak"
    assert params["access_key_secret"] == "sk"
    assert params["region_id"] == "cn-hangzhou"
    assert params["read_timeout"] == 60000


def test_init_creates_openapi_client_and_runs_initialize(monkeypatch: pytest.MonkeyPatch):
    stubs = _install_openapi_stubs(monkeypatch)
    initialize_mock = MagicMock()
    monkeypatch.setattr(openapi_module.AnalyticdbVectorOpenAPI, "_initialize", initialize_mock)

    vector = AnalyticdbVectorOpenAPI("COLLECTION_1", _config())

    assert vector._collection_name == "collection_1"
    assert isinstance(vector._client_config, stubs.OpenApiConfig)
    assert vector._client_config.user_agent == "dify"
    assert vector._client_config.access_key_id == "ak"
    assert vector._client.config is vector._client_config
    initialize_mock.assert_called_once_with()


def test_initialize_skips_when_cached(monkeypatch: pytest.MonkeyPatch):
    lock = MagicMock()
    lock.__enter__.return_value = None
    lock.__exit__.return_value = None
    monkeypatch.setattr(openapi_module.redis_client, "lock", MagicMock(return_value=lock))
    monkeypatch.setattr(openapi_module.redis_client, "get", MagicMock(return_value=1))
    monkeypatch.setattr(openapi_module.redis_client, "set", MagicMock())

    vector = AnalyticdbVectorOpenAPI.__new__(AnalyticdbVectorOpenAPI)
    vector.config = _config()
    vector._initialize_vector_database = MagicMock()
    vector._create_namespace_if_not_exists = MagicMock()

    vector._initialize()

    vector._initialize_vector_database.assert_not_called()
    vector._create_namespace_if_not_exists.assert_not_called()


def test_initialize_runs_when_cache_is_missing(monkeypatch: pytest.MonkeyPatch):
    lock = MagicMock()
    lock.__enter__.return_value = None
    lock.__exit__.return_value = None
    monkeypatch.setattr(openapi_module.redis_client, "lock", MagicMock(return_value=lock))
    monkeypatch.setattr(openapi_module.redis_client, "get", MagicMock(return_value=None))
    monkeypatch.setattr(openapi_module.redis_client, "set", MagicMock())

    vector = AnalyticdbVectorOpenAPI.__new__(AnalyticdbVectorOpenAPI)
    vector.config = _config()
    vector._initialize_vector_database = MagicMock()
    vector._create_namespace_if_not_exists = MagicMock()

    vector._initialize()

    vector._initialize_vector_database.assert_called_once()
    vector._create_namespace_if_not_exists.assert_called_once()
    openapi_module.redis_client.set.assert_called_once()


def test_initialize_vector_database_calls_openapi_client(monkeypatch: pytest.MonkeyPatch):
    _install_openapi_stubs(monkeypatch)
    vector = AnalyticdbVectorOpenAPI.__new__(AnalyticdbVectorOpenAPI)
    vector.config = _config()
    vector._client = MagicMock()

    vector._initialize_vector_database()

    request = vector._client.init_vector_database.call_args.args[0]
    assert request.dbinstance_id == "instance-1"
    assert request.region_id == "cn-hangzhou"
    assert request.manager_account == "account"
    assert request.manager_account_password == "password"


def test_create_namespace_creates_when_namespace_not_found(monkeypatch: pytest.MonkeyPatch):
    stubs = _install_openapi_stubs(monkeypatch)
    vector = AnalyticdbVectorOpenAPI.__new__(AnalyticdbVectorOpenAPI)
    vector.config = _config()
    vector._client = MagicMock()
    vector._client.describe_namespace.side_effect = stubs.TeaException(statusCode=404)

    vector._create_namespace_if_not_exists()

    vector._client.create_namespace.assert_called_once()


def test_create_namespace_raises_on_unexpected_api_error(monkeypatch: pytest.MonkeyPatch):
    stubs = _install_openapi_stubs(monkeypatch)
    vector = AnalyticdbVectorOpenAPI.__new__(AnalyticdbVectorOpenAPI)
    vector.config = _config()
    vector._client = MagicMock()
    vector._client.describe_namespace.side_effect = stubs.TeaException(statusCode=500)

    with pytest.raises(ValueError, match="failed to create namespace"):
        vector._create_namespace_if_not_exists()


def test_create_namespace_noop_when_namespace_exists(monkeypatch: pytest.MonkeyPatch):
    _install_openapi_stubs(monkeypatch)
    vector = AnalyticdbVectorOpenAPI.__new__(AnalyticdbVectorOpenAPI)
    vector.config = _config()
    vector._client = MagicMock()

    vector._create_namespace_if_not_exists()

    vector._client.describe_namespace.assert_called_once()
    vector._client.create_namespace.assert_not_called()


def test_create_collection_if_not_exists_creates_when_missing(monkeypatch: pytest.MonkeyPatch):
    stubs = _install_openapi_stubs(monkeypatch)
    lock = MagicMock()
    lock.__enter__.return_value = None
    lock.__exit__.return_value = None
    monkeypatch.setattr(openapi_module.redis_client, "lock", MagicMock(return_value=lock))
    monkeypatch.setattr(openapi_module.redis_client, "get", MagicMock(return_value=None))
    monkeypatch.setattr(openapi_module.redis_client, "set", MagicMock())

    vector = AnalyticdbVectorOpenAPI.__new__(AnalyticdbVectorOpenAPI)
    vector._collection_name = "collection_1"
    vector.config = _config()
    vector._client = MagicMock()
    vector._client.describe_collection.side_effect = stubs.TeaException(statusCode=404)

    vector.create_collection_if_not_exists(embedding_dimension=1024)

    vector._client.create_collection.assert_called_once()
    openapi_module.redis_client.set.assert_called_once()


def test_create_collection_if_not_exists_skips_when_cached(monkeypatch: pytest.MonkeyPatch):
    lock = MagicMock()
    lock.__enter__.return_value = None
    lock.__exit__.return_value = None
    monkeypatch.setattr(openapi_module.redis_client, "lock", MagicMock(return_value=lock))
    monkeypatch.setattr(openapi_module.redis_client, "get", MagicMock(return_value=1))
    monkeypatch.setattr(openapi_module.redis_client, "set", MagicMock())

    vector = AnalyticdbVectorOpenAPI.__new__(AnalyticdbVectorOpenAPI)
    vector._collection_name = "collection_1"
    vector.config = _config()
    vector._client = MagicMock()

    vector.create_collection_if_not_exists(embedding_dimension=1024)

    vector._client.describe_collection.assert_not_called()
    vector._client.create_collection.assert_not_called()


def test_create_collection_if_not_exists_raises_on_non_404_errors(monkeypatch: pytest.MonkeyPatch):
    stubs = _install_openapi_stubs(monkeypatch)
    lock = MagicMock()
    lock.__enter__.return_value = None
    lock.__exit__.return_value = None
    monkeypatch.setattr(openapi_module.redis_client, "lock", MagicMock(return_value=lock))
    monkeypatch.setattr(openapi_module.redis_client, "get", MagicMock(return_value=None))
    monkeypatch.setattr(openapi_module.redis_client, "set", MagicMock())

    vector = AnalyticdbVectorOpenAPI.__new__(AnalyticdbVectorOpenAPI)
    vector._collection_name = "collection_1"
    vector.config = _config()
    vector._client = MagicMock()
    vector._client.describe_collection.side_effect = stubs.TeaException(statusCode=500)

    with pytest.raises(ValueError, match="failed to create collection collection_1"):
        vector.create_collection_if_not_exists(embedding_dimension=512)


def test_openapi_add_delete_and_search_methods(monkeypatch: pytest.MonkeyPatch):
    _install_openapi_stubs(monkeypatch)
    vector = AnalyticdbVectorOpenAPI.__new__(AnalyticdbVectorOpenAPI)
    vector._collection_name = "collection_1"
    vector.config = _config()
    vector._client = MagicMock()

    documents = [
        Document(page_content="doc 1", metadata={"doc_id": "d1", "document_id": "doc-1"}),
        SimpleNamespace(page_content="doc 2", metadata=None),
    ]
    embeddings = [[0.1, 0.2], [0.2, 0.3]]
    vector.add_texts(documents, embeddings)

    upsert_request = vector._client.upsert_collection_data.call_args.args[0]
    assert upsert_request.collection == "collection_1"
    assert len(upsert_request.rows) == 1

    vector._client.query_collection_data.return_value = SimpleNamespace(
        body=SimpleNamespace(matches=SimpleNamespace(match=[SimpleNamespace()]))
    )
    assert vector.text_exists("d1") is True

    vector.delete_by_ids(["d1", "d2"])
    request = vector._client.delete_collection_data.call_args.args[0]
    assert request.collection_data_filter == "ref_doc_id IN ('d1','d2')"

    vector.delete_by_metadata_field("document_id", "doc-1")
    request = vector._client.delete_collection_data.call_args.args[0]
    assert request.collection_data_filter == "metadata_ ->> 'document_id' = 'doc-1'"

    match_high = SimpleNamespace(
        score=0.9,
        metadata={"metadata_": json.dumps({"document_id": "doc-1"}), "page_content": "high"},
        values=SimpleNamespace(value=[1.0, 2.0]),
    )
    match_low = SimpleNamespace(
        score=0.1,
        metadata={"metadata_": json.dumps({"document_id": "doc-2"}), "page_content": "low"},
        values=SimpleNamespace(value=[3.0, 4.0]),
    )
    vector._client.query_collection_data.return_value = SimpleNamespace(
        body=SimpleNamespace(matches=SimpleNamespace(match=[match_low, match_high]))
    )

    docs_by_vector = vector.search_by_vector([0.1, 0.2], top_k=2, score_threshold=0.5, document_ids_filter=["doc-1"])
    assert len(docs_by_vector) == 1
    assert docs_by_vector[0].page_content == "high"
    assert docs_by_vector[0].metadata["score"] == 0.9

    docs_by_text = vector.search_by_full_text("hello", top_k=2, score_threshold=0.2)
    assert len(docs_by_text) == 1
    assert docs_by_text[0].page_content == "high"


def test_text_exists_returns_false_when_matches_empty(monkeypatch: pytest.MonkeyPatch):
    _install_openapi_stubs(monkeypatch)
    vector = AnalyticdbVectorOpenAPI.__new__(AnalyticdbVectorOpenAPI)
    vector._collection_name = "collection_1"
    vector.config = _config()
    vector._client = MagicMock()
    vector._client.query_collection_data.return_value = SimpleNamespace(
        body=SimpleNamespace(matches=SimpleNamespace(match=[]))
    )

    assert vector.text_exists("missing-id") is False


def test_openapi_delete_success(monkeypatch: pytest.MonkeyPatch):
    _install_openapi_stubs(monkeypatch)
    vector = AnalyticdbVectorOpenAPI.__new__(AnalyticdbVectorOpenAPI)
    vector._collection_name = "collection_1"
    vector.config = _config()
    vector._client = MagicMock()

    vector.delete()
    vector._client.delete_collection.assert_called_once()


def test_openapi_delete_propagates_errors(monkeypatch: pytest.MonkeyPatch):
    _install_openapi_stubs(monkeypatch)
    vector = AnalyticdbVectorOpenAPI.__new__(AnalyticdbVectorOpenAPI)
    vector._collection_name = "collection_1"
    vector.config = _config()
    vector._client = MagicMock()
    vector._client.delete_collection.side_effect = RuntimeError("boom")

    with pytest.raises(RuntimeError, match="boom"):
        vector.delete()
