from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import dify_vdb_alibabacloud_mysql.alibabacloud_mysql_vector as alibaba_module
import pytest
from dify_vdb_alibabacloud_mysql.alibabacloud_mysql_vector import AlibabaCloudMySQLVectorFactory


def test_validate_distance_function_accepts_supported_values():
    factory = AlibabaCloudMySQLVectorFactory()

    assert factory._validate_distance_function("cosine") == "cosine"
    assert factory._validate_distance_function("euclidean") == "euclidean"


def test_validate_distance_function_rejects_unsupported_values():
    factory = AlibabaCloudMySQLVectorFactory()

    with pytest.raises(ValueError, match="Invalid distance function"):
        factory._validate_distance_function("dot_product")


def test_factory_init_vector_uses_existing_index_struct_class_prefix(monkeypatch: pytest.MonkeyPatch):
    factory = AlibabaCloudMySQLVectorFactory()
    dataset = SimpleNamespace(
        id="dataset-1",
        index_struct_dict={"vector_store": {"class_prefix": "existing_collection"}},
        index_struct=None,
    )

    monkeypatch.setattr(alibaba_module.dify_config, "ALIBABACLOUD_MYSQL_HOST", "host")
    monkeypatch.setattr(alibaba_module.dify_config, "ALIBABACLOUD_MYSQL_PORT", 3306)
    monkeypatch.setattr(alibaba_module.dify_config, "ALIBABACLOUD_MYSQL_USER", "user")
    monkeypatch.setattr(alibaba_module.dify_config, "ALIBABACLOUD_MYSQL_PASSWORD", "password")
    monkeypatch.setattr(alibaba_module.dify_config, "ALIBABACLOUD_MYSQL_DATABASE", "db")
    monkeypatch.setattr(alibaba_module.dify_config, "ALIBABACLOUD_MYSQL_MAX_CONNECTION", 5)
    monkeypatch.setattr(alibaba_module.dify_config, "ALIBABACLOUD_MYSQL_CHARSET", "utf8mb4")
    monkeypatch.setattr(alibaba_module.dify_config, "ALIBABACLOUD_MYSQL_DISTANCE_FUNCTION", "cosine")
    monkeypatch.setattr(alibaba_module.dify_config, "ALIBABACLOUD_MYSQL_HNSW_M", 6)

    with patch.object(alibaba_module, "AlibabaCloudMySQLVector", return_value="vector") as vector_cls:
        result = factory.init_vector(dataset, attributes=[], embeddings=MagicMock())

    assert result == "vector"
    assert vector_cls.call_args.kwargs["collection_name"] == "existing_collection"


def test_factory_init_vector_generates_collection_name_when_index_struct_is_missing(monkeypatch: pytest.MonkeyPatch):
    factory = AlibabaCloudMySQLVectorFactory()
    dataset = SimpleNamespace(
        id="dataset-2",
        index_struct_dict=None,
        index_struct=None,
    )

    monkeypatch.setattr(alibaba_module.Dataset, "gen_collection_name_by_id", lambda dataset_id: f"COL_{dataset_id}")
    monkeypatch.setattr(alibaba_module.dify_config, "ALIBABACLOUD_MYSQL_HOST", "host")
    monkeypatch.setattr(alibaba_module.dify_config, "ALIBABACLOUD_MYSQL_PORT", 3306)
    monkeypatch.setattr(alibaba_module.dify_config, "ALIBABACLOUD_MYSQL_USER", "user")
    monkeypatch.setattr(alibaba_module.dify_config, "ALIBABACLOUD_MYSQL_PASSWORD", "password")
    monkeypatch.setattr(alibaba_module.dify_config, "ALIBABACLOUD_MYSQL_DATABASE", "db")
    monkeypatch.setattr(alibaba_module.dify_config, "ALIBABACLOUD_MYSQL_MAX_CONNECTION", 5)
    monkeypatch.setattr(alibaba_module.dify_config, "ALIBABACLOUD_MYSQL_CHARSET", "utf8mb4")
    monkeypatch.setattr(alibaba_module.dify_config, "ALIBABACLOUD_MYSQL_DISTANCE_FUNCTION", "euclidean")
    monkeypatch.setattr(alibaba_module.dify_config, "ALIBABACLOUD_MYSQL_HNSW_M", 12)

    with patch.object(alibaba_module, "AlibabaCloudMySQLVector", return_value="vector") as vector_cls:
        result = factory.init_vector(dataset, attributes=[], embeddings=MagicMock())

    assert result == "vector"
    vector_cls.assert_called_once()
    assert vector_cls.call_args.kwargs["collection_name"] == "COL_dataset-2"
    assert dataset.index_struct is not None
