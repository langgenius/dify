import json
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

import core.rag.datasource.keyword.jieba.jieba as jieba_module
from core.rag.datasource.keyword.jieba.jieba import Jieba, dumps_with_sets, set_orjson_default
from core.rag.models.document import Document


class _DummyLock:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


class _Field:
    def __init__(self, name: str):
        self._name = name

    def __eq__(self, other):
        return ("eq", self._name, other)

    def in_(self, values):
        return ("in", self._name, tuple(values))


class _FakeQuery:
    def __init__(self):
        self.where_calls: list[tuple] = []

    def where(self, *conditions):
        self.where_calls.append(conditions)
        return self


class _FakeExecuteResult:
    def __init__(self, segments: list[SimpleNamespace]):
        self._segments = segments

    def scalars(self):
        return self

    def all(self):
        return self._segments


class _FakeSelect:
    def __init__(self):
        self.where_conditions: tuple | None = None

    def where(self, *conditions):
        self.where_conditions = conditions
        return self


def _dataset_keyword_table(data_source_type: str = "database", keyword_table_dict: dict | None = None):
    return SimpleNamespace(
        data_source_type=data_source_type,
        keyword_table_dict=keyword_table_dict,
        keyword_table="",
    )


def _dataset(dataset_keyword_table=None, keyword_number=None):
    return SimpleNamespace(
        id="dataset-1",
        tenant_id="tenant-1",
        keyword_number=keyword_number,
        dataset_keyword_table=dataset_keyword_table,
    )


@pytest.fixture
def patched_runtime(monkeypatch):
    session = MagicMock()
    db = SimpleNamespace(session=session)
    storage = MagicMock()
    lock = MagicMock(return_value=_DummyLock())
    redis_client = SimpleNamespace(lock=lock)

    monkeypatch.setattr(jieba_module, "db", db)
    monkeypatch.setattr(jieba_module, "storage", storage)
    monkeypatch.setattr(jieba_module, "redis_client", redis_client)

    return SimpleNamespace(session=session, storage=storage, lock=lock)


def test_create_indexes_documents_and_returns_self(monkeypatch, patched_runtime):
    dataset = _dataset(_dataset_keyword_table(), keyword_number=2)
    keyword = Jieba(dataset)
    handler = MagicMock()
    handler.extract_keywords.return_value = {"kw1", "kw2"}

    monkeypatch.setattr(jieba_module, "JiebaKeywordTableHandler", lambda: handler)
    monkeypatch.setattr(keyword, "_get_dataset_keyword_table", MagicMock(return_value={}))
    monkeypatch.setattr(keyword, "_update_segment_keywords", MagicMock())
    monkeypatch.setattr(keyword, "_save_dataset_keyword_table", MagicMock())

    result = keyword.create(
        [
            Document(page_content="alpha", metadata={"doc_id": "node-1"}),
            SimpleNamespace(page_content="ignored", metadata=None),
        ]
    )

    assert result is keyword
    keyword._update_segment_keywords.assert_called_once()
    call_args = keyword._update_segment_keywords.call_args.args
    assert call_args[0] == "dataset-1"
    assert call_args[1] == "node-1"
    assert set(call_args[2]) == {"kw1", "kw2"}
    saved_table = keyword._save_dataset_keyword_table.call_args.args[0]
    assert saved_table["kw1"] == {"node-1"}
    assert saved_table["kw2"] == {"node-1"}
    patched_runtime.lock.assert_called_once_with("keyword_indexing_lock_dataset-1", timeout=600)


def test_add_texts_supports_keywords_list_and_extract_fallback(monkeypatch, patched_runtime):
    keyword = Jieba(_dataset(_dataset_keyword_table(), keyword_number=3))
    handler = MagicMock()
    handler.extract_keywords.return_value = {"auto"}

    monkeypatch.setattr(jieba_module, "JiebaKeywordTableHandler", lambda: handler)
    monkeypatch.setattr(keyword, "_get_dataset_keyword_table", MagicMock(return_value={}))
    monkeypatch.setattr(keyword, "_update_segment_keywords", MagicMock())
    monkeypatch.setattr(keyword, "_save_dataset_keyword_table", MagicMock())

    texts = [
        Document(page_content="extract-this", metadata={"doc_id": "node-1"}),
        Document(page_content="use-manual", metadata={"doc_id": "node-2"}),
    ]
    keyword.add_texts(texts, keywords_list=[[], ["manual"]])

    assert keyword._update_segment_keywords.call_count == 2
    first_call = keyword._update_segment_keywords.call_args_list[0].args
    second_call = keyword._update_segment_keywords.call_args_list[1].args
    assert set(first_call[2]) == {"auto"}
    assert second_call[2] == ["manual"]
    keyword._save_dataset_keyword_table.assert_called_once()


def test_add_texts_without_keywords_list_always_uses_extractor(monkeypatch, patched_runtime):
    keyword = Jieba(_dataset(_dataset_keyword_table(), keyword_number=1))
    handler = MagicMock()
    handler.extract_keywords.return_value = {"from-extractor"}

    monkeypatch.setattr(jieba_module, "JiebaKeywordTableHandler", lambda: handler)
    monkeypatch.setattr(keyword, "_get_dataset_keyword_table", MagicMock(return_value={}))
    monkeypatch.setattr(keyword, "_update_segment_keywords", MagicMock())
    monkeypatch.setattr(keyword, "_save_dataset_keyword_table", MagicMock())

    keyword.add_texts([Document(page_content="content", metadata={"doc_id": "node-1"})])

    handler.extract_keywords.assert_called_once_with("content", 1)
    assert set(keyword._update_segment_keywords.call_args.args[2]) == {"from-extractor"}


def test_text_exists_handles_missing_and_existing_keyword_table(monkeypatch):
    keyword = Jieba(_dataset(_dataset_keyword_table()))

    monkeypatch.setattr(keyword, "_get_dataset_keyword_table", MagicMock(return_value=None))
    assert keyword.text_exists("node-1") is False

    monkeypatch.setattr(keyword, "_get_dataset_keyword_table", MagicMock(return_value={"k": {"node-1", "node-2"}}))
    assert keyword.text_exists("node-2") is True
    assert keyword.text_exists("node-x") is False


def test_delete_by_ids_updates_table_when_present(monkeypatch, patched_runtime):
    keyword = Jieba(_dataset(_dataset_keyword_table()))
    monkeypatch.setattr(keyword, "_get_dataset_keyword_table", MagicMock(return_value={"k": {"node-1", "node-2"}}))
    monkeypatch.setattr(keyword, "_delete_ids_from_keyword_table", MagicMock(return_value={"k": {"node-2"}}))
    monkeypatch.setattr(keyword, "_save_dataset_keyword_table", MagicMock())

    keyword.delete_by_ids(["node-1"])

    keyword._delete_ids_from_keyword_table.assert_called_once_with({"k": {"node-1", "node-2"}}, ["node-1"])
    keyword._save_dataset_keyword_table.assert_called_once_with({"k": {"node-2"}})


def test_delete_by_ids_saves_none_when_keyword_table_is_missing(monkeypatch, patched_runtime):
    keyword = Jieba(_dataset(_dataset_keyword_table()))
    monkeypatch.setattr(keyword, "_get_dataset_keyword_table", MagicMock(return_value=None))
    monkeypatch.setattr(keyword, "_delete_ids_from_keyword_table", MagicMock())
    monkeypatch.setattr(keyword, "_save_dataset_keyword_table", MagicMock())

    keyword.delete_by_ids(["node-1"])

    keyword._delete_ids_from_keyword_table.assert_not_called()
    keyword._save_dataset_keyword_table.assert_called_once_with(None)


def test_search_returns_documents_in_rank_order_and_applies_filter(monkeypatch, patched_runtime):
    class _FakeDocumentSegment:
        dataset_id = _Field("dataset_id")
        index_node_id = _Field("index_node_id")
        document_id = _Field("document_id")

    keyword = Jieba(_dataset(_dataset_keyword_table()))
    query_stmt = _FakeQuery()
    patched_runtime.session.query.return_value = query_stmt
    patched_runtime.session.execute.return_value = _FakeExecuteResult(
        [
            SimpleNamespace(
                index_node_id="node-2",
                content="segment-content",
                index_node_hash="hash-2",
                document_id="doc-2",
                dataset_id="dataset-1",
            )
        ]
    )

    monkeypatch.setattr(jieba_module, "DocumentSegment", _FakeDocumentSegment)
    monkeypatch.setattr(keyword, "_get_dataset_keyword_table", MagicMock(return_value={"k": {"node-1", "node-2"}}))
    monkeypatch.setattr(keyword, "_retrieve_ids_by_query", MagicMock(return_value=["node-1", "node-2"]))

    documents = keyword.search("query", top_k=2, document_ids_filter=["doc-2"])

    assert len(query_stmt.where_calls) == 2
    assert len(documents) == 1
    assert documents[0].page_content == "segment-content"
    assert documents[0].metadata["doc_id"] == "node-2"
    assert documents[0].metadata["doc_hash"] == "hash-2"


def test_delete_removes_keyword_table_and_optional_file(monkeypatch, patched_runtime):
    db_keyword = _dataset_keyword_table(data_source_type="database")
    file_keyword = _dataset_keyword_table(data_source_type="object_storage")

    keyword_db = Jieba(_dataset(db_keyword))
    keyword_db.delete()
    patched_runtime.storage.delete.assert_not_called()

    keyword_file = Jieba(_dataset(file_keyword))
    keyword_file.delete()

    patched_runtime.storage.delete.assert_called_once_with("keyword_files/tenant-1/dataset-1.txt")
    assert patched_runtime.session.delete.call_count == 2
    assert patched_runtime.session.commit.call_count == 2


def test_save_dataset_keyword_table_to_database(monkeypatch, patched_runtime):
    dataset_keyword_table = _dataset_keyword_table(data_source_type="database")
    keyword = Jieba(_dataset(dataset_keyword_table))

    keyword._save_dataset_keyword_table({"kw": {"node-1"}})

    assert '"__type__":"keyword_table"' in dataset_keyword_table.keyword_table
    assert '"index_id":"dataset-1"' in dataset_keyword_table.keyword_table
    patched_runtime.session.commit.assert_called_once()


def test_save_dataset_keyword_table_to_file_storage(monkeypatch, patched_runtime):
    dataset_keyword_table = _dataset_keyword_table(data_source_type="file")
    keyword = Jieba(_dataset(dataset_keyword_table))
    patched_runtime.storage.exists.return_value = True

    keyword._save_dataset_keyword_table({"kw": {"node-1"}})

    patched_runtime.storage.delete.assert_called_once_with("keyword_files/tenant-1/dataset-1.txt")
    patched_runtime.storage.save.assert_called_once()
    save_args = patched_runtime.storage.save.call_args.args
    assert save_args[0] == "keyword_files/tenant-1/dataset-1.txt"
    assert isinstance(save_args[1], bytes)


def test_get_dataset_keyword_table_returns_existing_table_data(monkeypatch, patched_runtime):
    existing = _dataset_keyword_table(
        keyword_table_dict={"__type__": "keyword_table", "__data__": {"table": {"kw": ["node-1"]}}}
    )
    keyword = Jieba(_dataset(existing))
    assert keyword._get_dataset_keyword_table() == {"kw": ["node-1"]}

    missing_payload = _dataset_keyword_table(keyword_table_dict=None)
    keyword_with_missing_payload = Jieba(_dataset(missing_payload))
    assert keyword_with_missing_payload._get_dataset_keyword_table() == {}


def test_get_dataset_keyword_table_creates_table_when_missing(monkeypatch, patched_runtime):
    created_tables: list[SimpleNamespace] = []

    def _fake_dataset_keyword_table(**kwargs):
        kwargs.setdefault("keyword_table", "")
        kwargs.setdefault("keyword_table_dict", None)
        table = SimpleNamespace(**kwargs)
        created_tables.append(table)
        return table

    keyword = Jieba(_dataset(dataset_keyword_table=None))
    monkeypatch.setattr(jieba_module, "DatasetKeywordTable", _fake_dataset_keyword_table)
    monkeypatch.setattr(jieba_module.dify_config, "KEYWORD_DATA_SOURCE_TYPE", "database")

    result = keyword._get_dataset_keyword_table()

    assert result == {}
    assert len(created_tables) == 1
    assert created_tables[0].dataset_id == "dataset-1"
    assert created_tables[0].data_source_type == "database"
    assert '"index_id":"dataset-1"' in created_tables[0].keyword_table
    patched_runtime.session.add.assert_called_once_with(created_tables[0])
    patched_runtime.session.commit.assert_called_once()


def test_add_and_delete_ids_from_keyword_table_helpers():
    keyword = Jieba(_dataset(_dataset_keyword_table()))
    keyword_table = {"kw1": {"node-1"}, "kw2": {"node-1", "node-2"}}

    updated = keyword._add_text_to_keyword_table(keyword_table, "node-3", ["kw1", "kw3"])
    assert updated["kw1"] == {"node-1", "node-3"}
    assert updated["kw3"] == {"node-3"}

    deleted = keyword._delete_ids_from_keyword_table(updated, ["node-1", "node-3"])
    assert "kw3" not in deleted
    assert "kw1" not in deleted
    assert deleted["kw2"] == {"node-2"}


def test_retrieve_ids_by_query_ranks_by_keyword_frequency(monkeypatch):
    keyword = Jieba(_dataset(_dataset_keyword_table()))
    handler = MagicMock()
    handler.extract_keywords.return_value = ["kw-a", "kw-b"]
    monkeypatch.setattr(jieba_module, "JiebaKeywordTableHandler", lambda: handler)

    ranked_ids = keyword._retrieve_ids_by_query(
        {"kw-a": {"node-1", "node-2"}, "kw-b": {"node-2"}, "kw-c": {"node-3"}},
        "query",
        k=1,
    )

    assert ranked_ids == ["node-2"]


def test_update_segment_keywords_updates_when_segment_exists(monkeypatch, patched_runtime):
    class _FakeDocumentSegment:
        dataset_id = _Field("dataset_id")
        index_node_id = _Field("index_node_id")

    monkeypatch.setattr(jieba_module, "DocumentSegment", _FakeDocumentSegment)
    monkeypatch.setattr(jieba_module, "select", lambda *_: _FakeSelect())

    keyword = Jieba(_dataset(_dataset_keyword_table()))
    segment = SimpleNamespace(keywords=[])
    patched_runtime.session.scalar.return_value = segment

    keyword._update_segment_keywords("dataset-1", "node-1", ["kw1", "kw2"])

    assert segment.keywords == ["kw1", "kw2"]
    patched_runtime.session.add.assert_called_once_with(segment)
    patched_runtime.session.commit.assert_called_once()

    patched_runtime.session.reset_mock()
    patched_runtime.session.scalar.return_value = None

    keyword._update_segment_keywords("dataset-1", "node-missing", ["kw3"])

    patched_runtime.session.add.assert_not_called()
    patched_runtime.session.commit.assert_not_called()


def test_create_segment_keywords_and_update_segment_keywords_index(monkeypatch):
    keyword = Jieba(_dataset(_dataset_keyword_table()))
    monkeypatch.setattr(keyword, "_get_dataset_keyword_table", MagicMock(return_value={}))
    monkeypatch.setattr(keyword, "_update_segment_keywords", MagicMock())
    monkeypatch.setattr(keyword, "_save_dataset_keyword_table", MagicMock())

    keyword.create_segment_keywords("node-1", ["kw"])
    keyword._update_segment_keywords.assert_called_once_with("dataset-1", "node-1", ["kw"])
    keyword._save_dataset_keyword_table.assert_called_once()

    keyword._save_dataset_keyword_table.reset_mock()
    keyword.update_segment_keywords_index("node-2", ["kw2"])
    keyword._save_dataset_keyword_table.assert_called_once()


def test_multi_create_segment_keywords_uses_provided_and_extracted_keywords(monkeypatch):
    keyword = Jieba(_dataset(_dataset_keyword_table(), keyword_number=2))
    handler = MagicMock()
    handler.extract_keywords.return_value = {"auto"}
    monkeypatch.setattr(jieba_module, "JiebaKeywordTableHandler", lambda: handler)
    monkeypatch.setattr(keyword, "_get_dataset_keyword_table", MagicMock(return_value={}))
    monkeypatch.setattr(keyword, "_save_dataset_keyword_table", MagicMock())

    first_segment = SimpleNamespace(index_node_id="node-1", content="first content", keywords=None)
    second_segment = SimpleNamespace(index_node_id="node-2", content="second content", keywords=None)

    keyword.multi_create_segment_keywords(
        [
            {"segment": first_segment, "keywords": ["manual"]},
            {"segment": second_segment, "keywords": []},
        ]
    )

    assert first_segment.keywords == ["manual"]
    assert second_segment.keywords == ["auto"]
    saved_table = keyword._save_dataset_keyword_table.call_args.args[0]
    assert saved_table["manual"] == {"node-1"}
    assert saved_table["auto"] == {"node-2"}


def test_set_orjson_default_and_dumps_with_sets():
    assert set(set_orjson_default({"a", "b"})) == {"a", "b"}

    with pytest.raises(TypeError, match="is not JSON serializable"):
        set_orjson_default(("not", "a", "set"))

    payload = {"items": {"a", "b"}}
    json_payload = dumps_with_sets(payload)
    decoded = json.loads(json_payload)
    assert set(decoded["items"]) == {"a", "b"}
