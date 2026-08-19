import array
import importlib
import sys
import types
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import numpy
import pytest
from pydantic import ValidationError

from core.rag.models.document import Document


def _build_fake_oracle_modules():
    jieba = types.ModuleType("jieba")
    jieba_posseg = types.ModuleType("jieba.posseg")
    jieba_posseg.cut = MagicMock(return_value=[])
    jieba.posseg = jieba_posseg

    oracledb = types.ModuleType("oracledb")
    oracledb_connection = types.ModuleType("oracledb.connection")

    class Connection:
        pass

    oracledb_connection.Connection = Connection
    oracledb.defaults = SimpleNamespace(fetch_lobs=True)
    oracledb.DB_TYPE_VECTOR = object()
    oracledb.create_pool = MagicMock(return_value=MagicMock(release=MagicMock()))
    oracledb.connect = MagicMock()

    return {
        "jieba": jieba,
        "jieba.posseg": jieba_posseg,
        "oracledb": oracledb,
        "oracledb.connection": oracledb_connection,
    }


def _connection_with_cursor(cursor):
    cursor_ctx = MagicMock()
    cursor_ctx.__enter__.return_value = cursor
    cursor_ctx.__exit__.return_value = None

    connection = MagicMock()
    connection.__enter__.return_value = connection
    connection.__exit__.return_value = None
    connection.cursor.return_value = cursor_ctx
    return connection


@pytest.fixture
def oracle_module(monkeypatch: pytest.MonkeyPatch):
    for name, module in _build_fake_oracle_modules().items():
        monkeypatch.setitem(sys.modules, name, module)

    import dify_vdb_oracle.oraclevector as module

    return importlib.reload(module)


def _config(module, **overrides):
    values = {
        "user": "system",
        "password": "oracle",
        "dsn": "oracle:1521/freepdb1",
        "is_autonomous": False,
    }
    values.update(overrides)
    return module.OracleVectorConfig.model_validate(values)


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("user", "", "config ORACLE_USER is required"),
        ("password", "", "config ORACLE_PASSWORD is required"),
        ("dsn", "", "config ORACLE_DSN is required"),
    ],
)
def test_oracle_config_validation_required_fields(oracle_module, field, value, message):
    values = _config(oracle_module).model_dump()
    values[field] = value

    with pytest.raises(ValidationError, match=message):
        oracle_module.OracleVectorConfig.model_validate(values)


def test_oracle_config_validation_autonomous_requirements(oracle_module):
    with pytest.raises(ValidationError, match="config_dir is required"):
        oracle_module.OracleVectorConfig.model_validate(
            {"user": "u", "password": "p", "dsn": "d", "is_autonomous": True}
        )


def test_init_and_get_type(oracle_module, monkeypatch: pytest.MonkeyPatch):
    pool = MagicMock()
    monkeypatch.setattr(oracle_module.oracledb, "create_pool", MagicMock(return_value=pool))
    vector = oracle_module.OracleVector("collection_1", _config(oracle_module))

    assert vector.get_type() == "oracle"
    assert vector.table_name == "embedding_collection_1"
    assert vector.pool is pool


def test_numpy_converters_and_type_handlers(oracle_module):
    vector = oracle_module.OracleVector.__new__(oracle_module.OracleVector)

    in_float64 = vector.numpy_converter_in(numpy.array([0.1], dtype=numpy.float64))
    in_float32 = vector.numpy_converter_in(numpy.array([0.1], dtype=numpy.float32))
    in_int8 = vector.numpy_converter_in(numpy.array([1], dtype=numpy.int8))
    assert in_float64.typecode == "d"
    assert in_float32.typecode == "f"
    assert in_int8.typecode == "b"

    cursor = MagicMock()
    vector.input_type_handler(cursor, numpy.array([0.1], dtype=numpy.float32), 2)
    cursor.var.assert_called_with(
        oracle_module.oracledb.DB_TYPE_VECTOR,
        arraysize=2,
        inconverter=vector.numpy_converter_in,
    )

    metadata = SimpleNamespace(type_code=oracle_module.oracledb.DB_TYPE_VECTOR)
    cursor.arraysize = 3
    vector.output_type_handler(cursor, metadata)
    cursor.var.assert_called_with(
        metadata.type_code,
        arraysize=3,
        outconverter=vector.numpy_converter_out,
    )

    out_int8 = vector.numpy_converter_out(array.array("b", [1]))
    assert out_int8.dtype == numpy.int8
    out_float32 = vector.numpy_converter_out(array.array("f", [1.0]))
    assert out_float32.dtype == numpy.float32
    out_float64 = vector.numpy_converter_out(array.array("d", [1.0]))
    assert out_float64.dtype == numpy.float64


def test_get_connection_supports_standard_and_autonomous_paths(oracle_module, monkeypatch: pytest.MonkeyPatch):
    connect = MagicMock(return_value="connection")
    monkeypatch.setattr(oracle_module.oracledb, "connect", connect)

    vector = oracle_module.OracleVector.__new__(oracle_module.OracleVector)
    vector.config = _config(oracle_module)
    assert vector._get_connection() == "connection"
    connect.assert_called_with(user="system", password="oracle", dsn="oracle:1521/freepdb1")

    vector.config = _config(
        oracle_module,
        is_autonomous=True,
        config_dir="/wallet",
        wallet_location="/wallet",
        wallet_password="pw",
    )
    vector._get_connection()
    assert connect.call_args.kwargs["config_dir"] == "/wallet"
    assert connect.call_args.kwargs["wallet_location"] == "/wallet"


def test_create_delegates_collection_and_insert(oracle_module):
    vector = oracle_module.OracleVector.__new__(oracle_module.OracleVector)
    vector._create_collection = MagicMock()
    vector.add_texts = MagicMock(return_value=["seg-1"])
    docs = [Document(page_content="doc", metadata={"doc_id": "seg-1"})]

    result = vector.create(docs, [[0.1, 0.2]])

    assert result == ["seg-1"]
    vector._create_collection.assert_called_once_with(2)
    vector.add_texts.assert_called_once_with(docs, [[0.1, 0.2]])


def test_add_texts_inserts_and_logs_on_failures(oracle_module, monkeypatch: pytest.MonkeyPatch):
    vector = oracle_module.OracleVector.__new__(oracle_module.OracleVector)
    vector.table_name = "embedding_collection_1"
    vector.input_type_handler = MagicMock()
    vector.output_type_handler = MagicMock()

    cursor = MagicMock()
    cursor.execute.side_effect = [None, RuntimeError("insert failed")]
    connection = _connection_with_cursor(cursor)
    vector._get_connection = MagicMock(return_value=connection)

    monkeypatch.setattr(oracle_module.uuid, "uuid4", lambda: "generated-uuid")
    docs = [
        Document(page_content="a", metadata={"doc_id": "doc-a"}),
        Document(page_content="b", metadata={"document_id": "doc-b"}),
        SimpleNamespace(page_content="c", metadata=None),
    ]

    ids = vector.add_texts(docs, [[0.1], [0.2], [0.3]])

    assert ids == ["doc-a", "generated-uuid"]
    assert cursor.execute.call_count == 2
    assert connection.commit.call_count >= 1
    connection.close.assert_called()


def test_text_exists_and_get_by_ids(oracle_module):
    vector = oracle_module.OracleVector.__new__(oracle_module.OracleVector)
    vector.table_name = "embedding_collection_1"
    vector.pool = MagicMock()

    cursor = MagicMock()
    cursor.fetchone.return_value = ("id-1",)
    cursor.__iter__.return_value = iter([({"doc_id": "1"}, "text-1"), ({"doc_id": "2"}, "text-2")])
    vector._get_connection = MagicMock(return_value=_connection_with_cursor(cursor))

    assert vector.text_exists("id-1") is True
    docs = vector.get_by_ids(["id-1", "id-2"])
    assert len(docs) == 2
    assert docs[0].page_content == "text-1"
    vector.pool.release.assert_called_once()
    assert vector.get_by_ids([]) == []


def test_delete_methods(oracle_module):
    vector = oracle_module.OracleVector.__new__(oracle_module.OracleVector)
    vector.table_name = "embedding_collection_1"

    cursor = MagicMock()
    vector._get_connection = MagicMock(return_value=_connection_with_cursor(cursor))

    vector.delete_by_ids([])
    vector._get_connection.assert_not_called()

    vector.delete_by_ids(["id-1", "id-2"])
    vector.delete_by_metadata_field("document_id", "doc-1")
    vector.delete()

    executed_sql = [call.args[0] for call in cursor.execute.call_args_list]
    assert any("DELETE FROM embedding_collection_1 WHERE id IN" in sql for sql in executed_sql)
    assert any("JSON_VALUE(meta" in sql for sql in executed_sql)
    assert any("DROP TABLE IF EXISTS embedding_collection_1" in sql for sql in executed_sql)


def test_search_by_vector_with_threshold_and_filter(oracle_module):
    vector = oracle_module.OracleVector.__new__(oracle_module.OracleVector)
    vector.table_name = "embedding_collection_1"
    vector.input_type_handler = MagicMock()
    vector.output_type_handler = MagicMock()

    cursor = MagicMock()
    cursor.__iter__.return_value = iter([({"doc_id": "1"}, "doc-1", 0.1), ({"doc_id": "2"}, "doc-2", 0.8)])
    connection = _connection_with_cursor(cursor)
    vector._get_connection = MagicMock(return_value=connection)

    docs = vector.search_by_vector(
        [0.1, 0.2],
        top_k=0,
        score_threshold=0.5,
        document_ids_filter=["d-1", "d-2"],
    )

    assert len(docs) == 1
    assert docs[0].metadata["score"] == pytest.approx(0.9)
    sql = cursor.execute.call_args.args[0]
    assert "fetch first 4 rows only" in sql
    assert "JSON_VALUE(meta, '$.document_id') IN (:2, :3)" in sql


def _fake_nltk_module(*, missing_data=False):
    nltk = types.ModuleType("nltk")
    nltk_corpus = types.ModuleType("nltk.corpus")

    class _Data:
        @staticmethod
        def find(_path):
            if missing_data:
                raise LookupError("missing")
            return True

    nltk.data = _Data()
    nltk.word_tokenize = lambda text: text.split()
    nltk_corpus.stopwords = SimpleNamespace(words=lambda _lang: ["and", "the"])
    return nltk, nltk_corpus


def test_search_by_full_text_chinese_and_english_paths(oracle_module, monkeypatch: pytest.MonkeyPatch):
    vector = oracle_module.OracleVector.__new__(oracle_module.OracleVector)
    vector.table_name = "embedding_collection_1"

    cursor = MagicMock()
    cursor.__iter__.return_value = iter([({"doc_id": "1"}, "text-1", [0.1, 0.2])])
    vector._get_connection = MagicMock(return_value=_connection_with_cursor(cursor))

    monkeypatch.setattr(oracle_module.pseg, "cut", MagicMock(return_value=[("张", "nr"), ("三", "nr"), ("。", "x")]))
    zh_docs = vector.search_by_full_text("张三", top_k=2)
    assert len(zh_docs) == 1
    zh_params = cursor.execute.call_args.args[1]
    assert zh_params["kk"] == "张三"

    nltk, nltk_corpus = _fake_nltk_module(missing_data=False)
    monkeypatch.setitem(sys.modules, "nltk", nltk)
    monkeypatch.setitem(sys.modules, "nltk.corpus", nltk_corpus)
    cursor.__iter__.return_value = iter([({"doc_id": "2"}, "text-2", [0.3, 0.4])])
    en_docs = vector.search_by_full_text("alice and bob", top_k=-1, document_ids_filter=["d-1"])
    assert len(en_docs) == 1
    en_sql = cursor.execute.call_args.args[0]
    en_params = cursor.execute.call_args.args[1]
    assert "fetch first 5 rows only" in en_sql
    assert "doc_id_0" in en_params


def test_search_by_full_text_empty_query_and_missing_nltk(oracle_module, monkeypatch: pytest.MonkeyPatch):
    vector = oracle_module.OracleVector.__new__(oracle_module.OracleVector)
    vector.table_name = "embedding_collection_1"
    vector._get_connection = MagicMock()

    empty_result = vector.search_by_full_text("")
    assert empty_result[0].page_content == ""

    nltk, nltk_corpus = _fake_nltk_module(missing_data=True)
    monkeypatch.setitem(sys.modules, "nltk", nltk)
    monkeypatch.setitem(sys.modules, "nltk.corpus", nltk_corpus)
    with pytest.raises(LookupError, match="required NLTK data package"):
        vector.search_by_full_text("english query")


def test_create_collection_cache_and_execute_path(oracle_module, monkeypatch: pytest.MonkeyPatch):
    lock = MagicMock()
    lock.__enter__.return_value = None
    lock.__exit__.return_value = None
    monkeypatch.setattr(oracle_module.redis_client, "lock", MagicMock(return_value=lock))
    monkeypatch.setattr(oracle_module.redis_client, "set", MagicMock())

    vector = oracle_module.OracleVector.__new__(oracle_module.OracleVector)
    vector._collection_name = "collection_1"
    vector.table_name = "embedding_collection_1"

    cursor = MagicMock()
    vector._get_connection = MagicMock(return_value=_connection_with_cursor(cursor))

    monkeypatch.setattr(oracle_module.redis_client, "get", MagicMock(return_value=1))
    vector._create_collection(2)
    cursor.execute.assert_not_called()

    monkeypatch.setattr(oracle_module.redis_client, "get", MagicMock(return_value=None))
    vector._create_collection(2)
    executed_sql = [call.args[0] for call in cursor.execute.call_args_list]
    assert any("CREATE TABLE IF NOT EXISTS embedding_collection_1" in sql for sql in executed_sql)
    assert any("CREATE INDEX IF NOT EXISTS idx_docs_embedding_collection_1" in sql for sql in executed_sql)
    oracle_module.redis_client.set.assert_called_once()


def test_oracle_factory_init_vector_uses_existing_or_generated_collection(
    oracle_module, monkeypatch: pytest.MonkeyPatch
):
    factory = oracle_module.OracleVectorFactory()
    dataset_with_index = SimpleNamespace(
        id="dataset-1",
        index_struct_dict={"vector_store": {"class_prefix": "EXISTING_COLLECTION"}},
        index_struct=None,
    )
    dataset_without_index = SimpleNamespace(id="dataset-2", index_struct_dict=None, index_struct=None)

    monkeypatch.setattr(oracle_module.Dataset, "gen_collection_name_by_id", lambda _id: "AUTO_COLLECTION")
    monkeypatch.setattr(oracle_module.dify_config, "ORACLE_USER", "system")
    monkeypatch.setattr(oracle_module.dify_config, "ORACLE_PASSWORD", "oracle")
    monkeypatch.setattr(oracle_module.dify_config, "ORACLE_DSN", "oracle:1521/freepdb1")
    monkeypatch.setattr(oracle_module.dify_config, "ORACLE_CONFIG_DIR", None)
    monkeypatch.setattr(oracle_module.dify_config, "ORACLE_WALLET_LOCATION", None)
    monkeypatch.setattr(oracle_module.dify_config, "ORACLE_WALLET_PASSWORD", None)
    monkeypatch.setattr(oracle_module.dify_config, "ORACLE_IS_AUTONOMOUS", False)

    with patch.object(oracle_module, "OracleVector", return_value="vector") as vector_cls:
        result_1 = factory.init_vector(dataset_with_index, attributes=[], embeddings=MagicMock())
        result_2 = factory.init_vector(dataset_without_index, attributes=[], embeddings=MagicMock())

    assert result_1 == "vector"
    assert result_2 == "vector"
    assert vector_cls.call_args_list[0].kwargs["collection_name"] == "EXISTING_COLLECTION"
    assert vector_cls.call_args_list[1].kwargs["collection_name"] == "AUTO_COLLECTION"
    assert dataset_without_index.index_struct is not None
