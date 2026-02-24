import importlib
import sys
import types
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from pydantic import ValidationError
from sqlalchemy.types import UserDefinedType

from core.rag.models.document import Document


def _build_fake_pgvecto_modules():
    pgvecto_rs = types.ModuleType("pgvecto_rs")
    pgvecto_rs_sqlalchemy = types.ModuleType("pgvecto_rs.sqlalchemy")

    class VECTOR(UserDefinedType):
        def __init__(self, dim):
            self.dim = dim

    pgvecto_rs_sqlalchemy.VECTOR = VECTOR
    return {
        "pgvecto_rs": pgvecto_rs,
        "pgvecto_rs.sqlalchemy": pgvecto_rs_sqlalchemy,
    }


class _FakeSessionContext:
    def __init__(self, calls, execute_results=None):
        self.calls = calls
        self.execute_results = execute_results or []
        self.execute = MagicMock(side_effect=self._execute_side_effect)
        self.commit = MagicMock()

    def _execute_side_effect(self, *args, **kwargs):
        self.calls.append((args, kwargs))
        if self.execute_results:
            return self.execute_results.pop(0)
        return MagicMock()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return None


def _session_factory(calls, execute_results=None):
    def _session(_client):
        return _FakeSessionContext(calls=calls, execute_results=execute_results)

    return _session


@pytest.fixture
def pgvecto_module(monkeypatch):
    for name, module in _build_fake_pgvecto_modules().items():
        monkeypatch.setitem(sys.modules, name, module)

    import core.rag.datasource.vdb.pgvecto_rs.collection as collection_module
    import core.rag.datasource.vdb.pgvecto_rs.pgvecto_rs as module

    return importlib.reload(module), importlib.reload(collection_module)


def _config(module, **overrides):
    values = {
        "host": "localhost",
        "port": 5432,
        "user": "postgres",
        "password": "secret",
        "database": "postgres",
    }
    values.update(overrides)
    return module.PgvectoRSConfig.model_validate(values)


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("host", "", "config PGVECTO_RS_HOST is required"),
        ("port", 0, "config PGVECTO_RS_PORT is required"),
        ("user", "", "config PGVECTO_RS_USER is required"),
        ("password", "", "config PGVECTO_RS_PASSWORD is required"),
        ("database", "", "config PGVECTO_RS_DATABASE is required"),
    ],
)
def test_pgvecto_config_validation(pgvecto_module, field, value, message):
    module, _ = pgvecto_module
    values = _config(module).model_dump()
    values[field] = value

    with pytest.raises(ValidationError, match=message):
        module.PgvectoRSConfig.model_validate(values)


def test_collection_base_has_expected_annotations(pgvecto_module):
    _, collection_module = pgvecto_module
    annotations = collection_module.CollectionORM.__annotations__
    assert {"id", "text", "meta", "vector"} <= set(annotations)


def test_init_get_type_and_create_delegate(pgvecto_module, monkeypatch):
    module, _ = pgvecto_module
    session_calls = []
    monkeypatch.setattr(module, "create_engine", MagicMock(return_value="engine"))
    monkeypatch.setattr(module, "Session", _session_factory(session_calls))

    vector = module.PGVectoRS("collection_1", _config(module), dim=3)
    vector.create_collection = MagicMock()
    vector.add_texts = MagicMock()
    docs = [Document(page_content="hello", metadata={"doc_id": "1"})]
    vector.create(docs, [[0.1, 0.2]])

    assert vector.get_type() == module.VectorType.PGVECTO_RS
    module.create_engine.assert_called_once_with("postgresql+psycopg2://postgres:secret@localhost:5432/postgres")
    assert any("CREATE EXTENSION IF NOT EXISTS vectors" in str(args[0]) for args, _ in session_calls)
    vector.create_collection.assert_called_once_with(2)
    vector.add_texts.assert_called_once_with(docs, [[0.1, 0.2]])


def test_create_collection_cache_and_sql_execution(pgvecto_module, monkeypatch):
    module, _ = pgvecto_module
    session_calls = []
    monkeypatch.setattr(module, "create_engine", MagicMock(return_value="engine"))
    monkeypatch.setattr(module, "Session", _session_factory(session_calls))

    lock = MagicMock()
    lock.__enter__.return_value = None
    lock.__exit__.return_value = None
    monkeypatch.setattr(module.redis_client, "lock", MagicMock(return_value=lock))
    monkeypatch.setattr(module.redis_client, "set", MagicMock())

    vector = module.PGVectoRS("collection_1", _config(module), dim=3)
    monkeypatch.setattr(module.redis_client, "get", MagicMock(return_value=1))
    vector.create_collection(3)
    assert not any("CREATE TABLE IF NOT EXISTS collection_1" in str(args[0]) for args, _ in session_calls)

    monkeypatch.setattr(module.redis_client, "get", MagicMock(return_value=None))
    vector.create_collection(3)
    assert any("CREATE TABLE IF NOT EXISTS collection_1" in str(args[0]) for args, _ in session_calls)
    assert any("CREATE INDEX IF NOT EXISTS collection_1_embedding_index" in str(args[0]) for args, _ in session_calls)
    module.redis_client.set.assert_called()


def test_add_texts_get_ids_and_delete_methods(pgvecto_module, monkeypatch):
    module, _ = pgvecto_module
    init_calls = []
    runtime_calls = []
    execute_results = [SimpleNamespace(fetchall=lambda: [("id-1",), ("id-2",)]), SimpleNamespace(fetchall=lambda: [])]

    monkeypatch.setattr(module, "create_engine", MagicMock(return_value="engine"))
    monkeypatch.setattr(module, "Session", _session_factory(init_calls))
    vector = module.PGVectoRS("collection_1", _config(module), dim=3)

    monkeypatch.setattr(module, "Session", _session_factory(runtime_calls, execute_results=list(execute_results)))

    class _InsertBuilder:
        def __init__(self, table):
            self.table = table

        def values(self, **kwargs):
            return ("insert", kwargs)

    monkeypatch.setattr(module, "insert", lambda table: _InsertBuilder(table))
    monkeypatch.setattr(module, "uuid4", MagicMock(side_effect=["uuid-1", "uuid-2"]))
    docs = [
        Document(page_content="a", metadata={"doc_id": "1"}),
        Document(page_content="b", metadata={"doc_id": "2"}),
    ]

    ids = vector.add_texts(docs, [[0.1], [0.2]])
    assert ids == ["uuid-1", "uuid-2"]
    assert any(call[0][0][0] == "insert" for call in runtime_calls if call[0])

    monkeypatch.setattr(
        module,
        "Session",
        _session_factory(runtime_calls, execute_results=[SimpleNamespace(fetchall=lambda: [("id-1",), ("id-2",)])]),
    )
    assert vector.get_ids_by_metadata_field("document_id", "doc-1") == ["id-1", "id-2"]

    monkeypatch.setattr(
        module,
        "Session",
        _session_factory(runtime_calls, execute_results=[SimpleNamespace(fetchall=lambda: [])]),
    )
    assert vector.get_ids_by_metadata_field("document_id", "doc-1") is None

    vector.get_ids_by_metadata_field = MagicMock(return_value=["id-1"])
    vector.delete_by_metadata_field("document_id", "doc-1")
    assert any("DELETE FROM collection_1 WHERE id = ANY(:ids)" in str(args[0]) for args, _ in runtime_calls)

    runtime_calls.clear()
    monkeypatch.setattr(
        module,
        "Session",
        _session_factory(
            runtime_calls,
            execute_results=[
                SimpleNamespace(fetchall=lambda: [("row-id-1",)]),
                MagicMock(),
            ],
        ),
    )
    vector.delete_by_ids(["doc-1"])
    assert any("meta->>'doc_id' = ANY (:doc_ids)" in str(args[0]) for args, _ in runtime_calls)
    assert any("DELETE FROM collection_1 WHERE id = ANY(:ids)" in str(args[0]) for args, _ in runtime_calls)

    runtime_calls.clear()
    monkeypatch.setattr(module, "Session", _session_factory(runtime_calls, execute_results=[MagicMock()]))
    vector.delete()
    assert any("DROP TABLE IF EXISTS collection_1" in str(args[0]) for args, _ in runtime_calls)


def test_text_exists_search_and_full_text(pgvecto_module, monkeypatch):
    module, _ = pgvecto_module
    init_calls = []
    monkeypatch.setattr(module, "create_engine", MagicMock(return_value="engine"))
    monkeypatch.setattr(module, "Session", _session_factory(init_calls))
    vector = module.PGVectoRS("collection_1", _config(module), dim=3)

    runtime_calls = []
    monkeypatch.setattr(
        module,
        "Session",
        _session_factory(
            runtime_calls,
            execute_results=[
                SimpleNamespace(fetchall=lambda: [("id-1",)]),
                SimpleNamespace(fetchall=lambda: []),
            ],
        ),
    )
    assert vector.text_exists("doc-1") is True
    assert vector.text_exists("doc-1") is False

    class _DistanceExpr:
        def label(self, _name):
            return self

    class _VectorColumn:
        def op(self, _operator, return_type=None):
            def _call(_query_vector):
                return _DistanceExpr()

            return _call

    class _MetaFilter:
        def in_(self, values):
            return ("in", values)

    class _MetaColumn:
        def __getitem__(self, _item):
            return _MetaFilter()

    class _Stmt:
        def __init__(self):
            self.where_called = False

        def limit(self, _value):
            return self

        def order_by(self, _value):
            return self

        def where(self, _value):
            self.where_called = True
            return self

    stmt = _Stmt()
    monkeypatch.setattr(module, "select", lambda *_args: stmt)

    vector._table = SimpleNamespace(vector=_VectorColumn(), meta=_MetaColumn())
    rows = [
        (SimpleNamespace(meta={"doc_id": "1"}, text="text-1"), 0.1),
        (SimpleNamespace(meta={"doc_id": "2"}, text="text-2"), 0.8),
    ]
    monkeypatch.setattr(module, "Session", _session_factory(runtime_calls, execute_results=[rows]))

    docs = vector.search_by_vector([0.1, 0.2], top_k=2, score_threshold=0.5, document_ids_filter=["d-1"])
    assert len(docs) == 1
    assert docs[0].metadata["score"] == pytest.approx(0.9)
    assert stmt.where_called is True
    assert vector.search_by_full_text("hello") == []


def test_factory_uses_existing_or_generated_collection(pgvecto_module, monkeypatch):
    module, _ = pgvecto_module
    factory = module.PGVectoRSFactory()
    dataset_with_index = SimpleNamespace(
        id="dataset-1",
        index_struct_dict={"vector_store": {"class_prefix": "EXISTING_COLLECTION"}},
        index_struct=None,
    )
    dataset_without_index = SimpleNamespace(id="dataset-2", index_struct_dict=None, index_struct=None)

    monkeypatch.setattr(module.Dataset, "gen_collection_name_by_id", lambda _id: "AUTO_COLLECTION")
    monkeypatch.setattr(module.dify_config, "PGVECTO_RS_HOST", "localhost")
    monkeypatch.setattr(module.dify_config, "PGVECTO_RS_PORT", 5432)
    monkeypatch.setattr(module.dify_config, "PGVECTO_RS_USER", "postgres")
    monkeypatch.setattr(module.dify_config, "PGVECTO_RS_PASSWORD", "secret")
    monkeypatch.setattr(module.dify_config, "PGVECTO_RS_DATABASE", "postgres")

    embeddings = MagicMock()
    embeddings.embed_query.return_value = [0.1, 0.2, 0.3]

    with patch.object(module, "PGVectoRS", return_value="vector") as vector_cls:
        result_1 = factory.init_vector(dataset_with_index, attributes=[], embeddings=embeddings)
        result_2 = factory.init_vector(dataset_without_index, attributes=[], embeddings=embeddings)

    assert result_1 == "vector"
    assert result_2 == "vector"
    assert vector_cls.call_args_list[0].kwargs["collection_name"] == "existing_collection"
    assert vector_cls.call_args_list[1].kwargs["collection_name"] == "auto_collection"
    assert dataset_without_index.index_struct is not None
