from unittest.mock import MagicMock, patch

import pytest
from dify_vdb_mongodb.mongodb_vector import (
    MONGODB_INDEX_ALREADY_EXISTS,
    MongoDBVector,
    _sanitize_uri_for_logging,
)
from pymongo.errors import ConnectionFailure, OperationFailure

from core.rag.models.document import Document


def _make_config(**overrides: object) -> MagicMock:
    defaults = {
        "MONGODB_CONNECT_URI": "mongodb://localhost:27017",
        "MONGODB_DATABASE": "test_db",
        "MONGODB_VECTOR_INDEX_NAME": "test_index",
        "MONGODB_SERVER_SELECTION_TIMEOUT_MS": 5000,
        "MONGODB_CONNECTION_RETRY_ATTEMPTS": 3,
        "MONGODB_CONNECTION_RETRY_BACKOFF_BASE": 0.01,
        "MONGODB_CONNECTION_RETRY_MAX_WAIT": 0.05,
        "MONGODB_INDEX_READY_TIMEOUT": 300,
        "MONGODB_INDEX_READY_CHECK_DELAY": 0.01,
        "MONGODB_INDEX_READY_MAX_DELAY": 0.05,
    }
    defaults.update(overrides)
    return MagicMock(**defaults)


@patch("dify_vdb_mongodb.mongodb_vector.MongoClient")
def test_initialization_success(mock_client_cls: MagicMock) -> None:
    mock_instance = MagicMock()
    mock_client_cls.return_value = mock_instance

    vector = MongoDBVector("col", "grp", _make_config())

    mock_client_cls.assert_called_with("mongodb://localhost:27017", serverSelectionTimeoutMS=5000)
    mock_instance.admin.command.assert_called_with("ping")
    assert vector is not None


@patch("dify_vdb_mongodb.mongodb_vector.MongoClient")
def test_initialization_connection_failure(mock_client_cls: MagicMock) -> None:
    mock_instance = MagicMock()
    mock_client_cls.return_value = mock_instance
    mock_instance.admin.command.side_effect = ConnectionFailure("fail")

    with pytest.raises(ConnectionFailure):
        MongoDBVector("col", "grp", _make_config())


@patch("dify_vdb_mongodb.mongodb_vector.MongoClient")
def test_retries_disabled(mock_client_cls: MagicMock) -> None:
    mock_instance = MagicMock()
    mock_client_cls.return_value = mock_instance
    mock_instance.admin.command.side_effect = ConnectionFailure("fail")

    with pytest.raises(ConnectionFailure):
        MongoDBVector("col", "grp", _make_config(MONGODB_CONNECTION_RETRY_ATTEMPTS=0))

    assert mock_instance.admin.command.call_count == 1


@patch("dify_vdb_mongodb.mongodb_vector.MongoClient")
def test_retries_succeed_on_third_attempt(mock_client_cls: MagicMock) -> None:
    mock_instance = MagicMock()
    mock_client_cls.return_value = mock_instance
    mock_instance.admin.command.side_effect = [
        ConnectionFailure("fail"),
        ConnectionFailure("fail"),
        None,
    ]

    vector = MongoDBVector("col", "grp", _make_config())
    assert vector is not None
    assert mock_instance.admin.command.call_count == 3


@patch("dify_vdb_mongodb.mongodb_vector.MongoClient")
def test_add_texts(mock_client_cls: MagicMock) -> None:
    mock_instance = MagicMock()
    mock_client_cls.return_value = mock_instance
    mock_db = MagicMock()
    mock_instance.__getitem__.return_value = mock_db
    mock_collection = MagicMock()
    mock_db.__getitem__.return_value = mock_collection

    vector = MongoDBVector("col", "grp", _make_config())
    docs = [Document(page_content="hello", metadata={"doc_id": "1"})]
    vector.add_texts(docs, [[0.1, 0.2]])

    mock_collection.insert_many.assert_called_once()
    inserted = mock_collection.insert_many.call_args[0][0]
    assert len(inserted) == 1
    assert inserted[0]["text"] == "hello"
    assert inserted[0]["group_id"] == "grp"


@patch("dify_vdb_mongodb.mongodb_vector.MongoClient")
def test_search_by_vector(mock_client_cls: MagicMock) -> None:
    mock_instance = MagicMock()
    mock_client_cls.return_value = mock_instance
    mock_db = MagicMock()
    mock_instance.__getitem__.return_value = mock_db
    mock_collection = MagicMock()
    mock_db.__getitem__.return_value = mock_collection
    mock_collection.aggregate.return_value = [{"text": "result", "metadata": {"doc_id": "1"}, "score": 0.95}]

    vector = MongoDBVector("col", "grp", _make_config())
    results = vector.search_by_vector([0.1, 0.2])

    assert len(results) == 1
    assert results[0].page_content == "result"
    assert results[0].metadata["score"] == 0.95


@patch("dify_vdb_mongodb.mongodb_vector.MongoClient")
def test_search_by_vector_applies_score_threshold(mock_client_cls: MagicMock) -> None:
    mock_instance = MagicMock()
    mock_client_cls.return_value = mock_instance
    mock_db = MagicMock()
    mock_instance.__getitem__.return_value = mock_db
    mock_collection = MagicMock()
    mock_db.__getitem__.return_value = mock_collection
    mock_collection.aggregate.return_value = [
        {"text": "high-score", "metadata": {"doc_id": "1"}, "score": 0.95},
        {"text": "low-score", "metadata": {"doc_id": "2"}, "score": 0.6},
    ]

    vector = MongoDBVector("col", "grp", _make_config())
    results = vector.search_by_vector([0.1, 0.2], score_threshold=0.9)

    assert len(results) == 1
    assert results[0].page_content == "high-score"
    assert results[0].metadata["doc_id"] == "1"
    assert results[0].metadata["score"] == 0.95


@patch("dify_vdb_mongodb.mongodb_vector.MongoClient")
def test_create_collection_and_index(mock_client_cls: MagicMock) -> None:
    mock_instance = MagicMock()
    mock_client_cls.return_value = mock_instance
    mock_db = MagicMock()
    mock_instance.__getitem__.return_value = mock_db
    mock_collection = MagicMock()
    mock_db.__getitem__.return_value = mock_collection
    mock_db.list_collection_names.return_value = []
    mock_collection.aggregate.return_value = [{"queryable": True, "status": "READY"}]
    mock_collection.name = "col"

    vector = MongoDBVector("col", "grp", _make_config())
    docs = [Document(page_content="test", metadata={"doc_id": "1"})]
    vector.create(docs, [[0.1, 0.2]])

    mock_db.create_collection.assert_called_with("col")
    mock_collection.create_search_index.assert_called_once()
    mock_collection.insert_many.assert_called_once()


@patch("dify_vdb_mongodb.mongodb_vector.MongoClient")
def test_index_already_exists(mock_client_cls: MagicMock) -> None:
    mock_instance = MagicMock()
    mock_client_cls.return_value = mock_instance
    mock_db = MagicMock()
    mock_instance.__getitem__.return_value = mock_db
    mock_collection = MagicMock()
    mock_db.__getitem__.return_value = mock_collection
    mock_db.list_collection_names.return_value = ["col"]
    mock_collection.create_search_index.side_effect = OperationFailure(
        "IndexAlreadyExists", code=MONGODB_INDEX_ALREADY_EXISTS
    )
    mock_collection.aggregate.return_value = [{"queryable": True, "status": "READY"}]

    vector = MongoDBVector("col", "grp", _make_config())
    vector._create_vector_index(128)

    mock_collection.create_search_index.assert_called_once()


# --- Delete / existence tests ---


@patch("dify_vdb_mongodb.mongodb_vector.MongoClient")
def test_text_exists_returns_true(mock_client_cls: MagicMock) -> None:
    mock_instance = MagicMock()
    mock_client_cls.return_value = mock_instance
    mock_db = MagicMock()
    mock_instance.__getitem__.return_value = mock_db
    mock_collection = MagicMock()
    mock_db.__getitem__.return_value = mock_collection
    mock_collection.find_one.return_value = {"text": "found"}

    vector = MongoDBVector("col", "grp", _make_config())
    assert vector.text_exists("d1") is True
    mock_collection.find_one.assert_called_once_with({"metadata.doc_id": "d1", "group_id": "grp"})


@patch("dify_vdb_mongodb.mongodb_vector.MongoClient")
def test_text_exists_returns_false(mock_client_cls: MagicMock) -> None:
    mock_instance = MagicMock()
    mock_client_cls.return_value = mock_instance
    mock_db = MagicMock()
    mock_instance.__getitem__.return_value = mock_db
    mock_collection = MagicMock()
    mock_db.__getitem__.return_value = mock_collection
    mock_collection.find_one.return_value = None

    vector = MongoDBVector("col", "grp", _make_config())
    assert vector.text_exists("missing") is False


@patch("dify_vdb_mongodb.mongodb_vector.MongoClient")
def test_delete_by_ids(mock_client_cls: MagicMock) -> None:
    mock_instance = MagicMock()
    mock_client_cls.return_value = mock_instance
    mock_db = MagicMock()
    mock_instance.__getitem__.return_value = mock_db
    mock_collection = MagicMock()
    mock_db.__getitem__.return_value = mock_collection

    vector = MongoDBVector("col", "grp", _make_config())
    vector.delete_by_ids(["id1", "id2"])

    mock_collection.delete_many.assert_called_once_with(
        {"metadata.doc_id": {"$in": ["id1", "id2"]}, "group_id": "grp"}
    )


@patch("dify_vdb_mongodb.mongodb_vector.MongoClient")
def test_delete_by_metadata_field(mock_client_cls: MagicMock) -> None:
    mock_instance = MagicMock()
    mock_client_cls.return_value = mock_instance
    mock_db = MagicMock()
    mock_instance.__getitem__.return_value = mock_db
    mock_collection = MagicMock()
    mock_db.__getitem__.return_value = mock_collection

    vector = MongoDBVector("col", "grp", _make_config())
    vector.delete_by_metadata_field("document_id", "doc-abc")

    mock_collection.delete_many.assert_called_once_with(
        {"metadata.document_id": "doc-abc", "group_id": "grp"}
    )


@patch("dify_vdb_mongodb.mongodb_vector.MongoClient")
def test_delete(mock_client_cls: MagicMock) -> None:
    mock_instance = MagicMock()
    mock_client_cls.return_value = mock_instance
    mock_db = MagicMock()
    mock_instance.__getitem__.return_value = mock_db
    mock_collection = MagicMock()
    mock_db.__getitem__.return_value = mock_collection

    vector = MongoDBVector("col", "grp", _make_config())
    vector.delete()

    mock_collection.delete_many.assert_called_once_with({"group_id": "grp"})


# --- URI sanitization tests ---


def test_sanitize_uri_with_credentials() -> None:
    result = _sanitize_uri_for_logging("mongodb://user:secret@host:27017/db")
    assert "user" in result
    assert "***" in result
    assert "secret" not in result


def test_sanitize_uri_without_credentials() -> None:
    result = _sanitize_uri_for_logging("mongodb://host:27017/db")
    assert "host" in result


def test_sanitize_uri_srv_scheme() -> None:
    result = _sanitize_uri_for_logging("mongodb+srv://user:pw@cluster.net/db")
    assert "mongodb+srv://" in result
    assert "pw" not in result


def test_sanitize_uri_malformed() -> None:
    assert _sanitize_uri_for_logging("") == "***"
    assert _sanitize_uri_for_logging("no-scheme") == "***"
    assert _sanitize_uri_for_logging(None) == "***"  # type: ignore[arg-type]


# --- Config tests ---


def test_config_uri_takes_precedence() -> None:
    from configs.middleware.vdb.mongodb_config import MongoDBConfig

    config = MongoDBConfig(
        MONGODB_URI="mongodb://override:27017",
        MONGODB_HOST="ignored",
        MONGODB_PORT=9999,
    )
    assert config.MONGODB_CONNECT_URI == "mongodb://override:27017"


def test_config_build_from_components() -> None:
    from configs.middleware.vdb.mongodb_config import MongoDBConfig

    config = MongoDBConfig(
        MONGODB_HOST="myhost",
        MONGODB_PORT=27017,
        MONGODB_USERNAME="user",
        MONGODB_PASSWORD="pass",
    )
    uri = config.MONGODB_CONNECT_URI
    assert "myhost" in uri
    assert "user" in uri


def test_config_default_localhost() -> None:
    from configs.middleware.vdb.mongodb_config import MongoDBConfig

    config = MongoDBConfig()
    assert config.MONGODB_CONNECT_URI == "mongodb://localhost:27017"


def test_config_mismatched_credentials_rejected() -> None:
    from configs.middleware.vdb.mongodb_config import MongoDBConfig

    with pytest.raises(ValueError, match="Both MONGODB_USERNAME and MONGODB_PASSWORD"):
        MongoDBConfig(MONGODB_HOST="localhost", MONGODB_USERNAME="user")

    with pytest.raises(ValueError, match="Both MONGODB_USERNAME and MONGODB_PASSWORD"):
        MongoDBConfig(MONGODB_HOST="localhost", MONGODB_PASSWORD="pass")
