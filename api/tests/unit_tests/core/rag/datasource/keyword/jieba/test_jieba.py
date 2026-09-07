import json
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import pytest
from sqlalchemy import event, select
from sqlalchemy.orm import Session

import core.rag.datasource.keyword.jieba.jieba as jieba_module
from core.rag.datasource.keyword.jieba.jieba import Jieba, dumps_with_sets, set_orjson_default
from core.rag.models.document import Document
from models.dataset import Dataset, DatasetKeywordTable, DocumentSegment


class _DummyLock:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


def _dataset_keyword_table(
    data_source_type: str = "database", keyword_table_dict: dict[str, Any] | None = None
) -> DatasetKeywordTable:
    keyword_table = DatasetKeywordTable(
        dataset_id="dataset-1",
        data_source_type=data_source_type,
        keyword_table="",
    )
    keyword_table.get_keyword_table_dict = MagicMock(return_value=keyword_table_dict)
    return keyword_table


def _dataset(dataset_keyword_table: DatasetKeywordTable | None = None, keyword_number: int | None = None) -> Dataset:
    dataset = Dataset(
        id="dataset-1",
        tenant_id="tenant-1",
        keyword_number=keyword_number,
    )
    dataset.get_dataset_keyword_table = MagicMock(return_value=dataset_keyword_table)
    return dataset


@pytest.fixture
def patched_runtime(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session):
    storage = MagicMock()
    lock = MagicMock(return_value=_DummyLock())
    redis_client = SimpleNamespace(lock=lock)

    monkeypatch.setattr(jieba_module, "storage", storage)
    monkeypatch.setattr(jieba_module, "redis_client", redis_client)

    return SimpleNamespace(session=sqlite_session, storage=storage, lock=lock)


def _segment(*, index_node_id: str = "node-2") -> DocumentSegment:
    segment = DocumentSegment(
        tenant_id="tenant-1",
        dataset_id="dataset-1",
        document_id="doc-2",
        position=1,
        content="segment-content",
        word_count=1,
        tokens=1,
        created_by="user-1",
        enabled=True,
        keywords=[],
        answer=None,
        index_node_id=index_node_id,
        index_node_hash="hash-2",
        status="completed",
    )
    segment.id = "segment-1"
    return segment


def test_create_indexes_documents_and_returns_self(monkeypatch: pytest.MonkeyPatch, patched_runtime):
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
        ],
        patched_runtime.session,
    )

    assert result is keyword
    keyword._update_segment_keywords.assert_called_once()
    call_args = keyword._update_segment_keywords.call_args.args
    assert call_args[0] == "dataset-1"
    assert call_args[1] == "node-1"
    assert set(call_args[2]) == {"kw1", "kw2"}
    assert call_args[3] is patched_runtime.session
    saved_table = keyword._save_dataset_keyword_table.call_args.args[0]
    assert saved_table["kw1"] == {"node-1"}
    assert saved_table["kw2"] == {"node-1"}
    patched_runtime.lock.assert_called_once_with("keyword_indexing_lock_dataset-1", timeout=600)


def test_add_texts_supports_keywords_list_and_extract_fallback(monkeypatch: pytest.MonkeyPatch, patched_runtime):
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
    keyword.add_texts(texts, patched_runtime.session, keywords_list=[[], ["manual"]])

    assert keyword._update_segment_keywords.call_count == 2
    first_call = keyword._update_segment_keywords.call_args_list[0].args
    second_call = keyword._update_segment_keywords.call_args_list[1].args
    assert set(first_call[2]) == {"auto"}
    assert second_call[2] == ["manual"]
    assert first_call[3] is patched_runtime.session
    assert second_call[3] is patched_runtime.session
    keyword._save_dataset_keyword_table.assert_called_once_with(
        {"auto": {"node-1"}, "manual": {"node-2"}}, patched_runtime.session
    )


def test_add_texts_without_keywords_list_always_uses_extractor(monkeypatch: pytest.MonkeyPatch, patched_runtime):
    keyword = Jieba(_dataset(_dataset_keyword_table(), keyword_number=1))
    handler = MagicMock()
    handler.extract_keywords.return_value = {"from-extractor"}

    monkeypatch.setattr(jieba_module, "JiebaKeywordTableHandler", lambda: handler)
    monkeypatch.setattr(keyword, "_get_dataset_keyword_table", MagicMock(return_value={}))
    monkeypatch.setattr(keyword, "_update_segment_keywords", MagicMock())
    monkeypatch.setattr(keyword, "_save_dataset_keyword_table", MagicMock())

    keyword.add_texts([Document(page_content="content", metadata={"doc_id": "node-1"})], patched_runtime.session)

    handler.extract_keywords.assert_called_once_with("content", 1)
    assert set(keyword._update_segment_keywords.call_args.args[2]) == {"from-extractor"}
    assert keyword._update_segment_keywords.call_args.args[3] is patched_runtime.session


def test_text_exists_handles_missing_and_existing_keyword_table(
    monkeypatch: pytest.MonkeyPatch, unbound_session: Session
):
    keyword = Jieba(_dataset(_dataset_keyword_table(keyword_table_dict=None)))
    session = unbound_session
    assert keyword.text_exists("node-1", session=session) is False

    keyword = Jieba(
        _dataset(
            _dataset_keyword_table(
                keyword_table_dict={"__type__": "keyword_table", "__data__": {"table": {"k": {"node-1", "node-2"}}}}
            )
        )
    )
    assert keyword.text_exists("node-2", session=session) is True
    assert keyword.text_exists("node-x", session=session) is False


def test_delete_by_ids_updates_table_when_present(monkeypatch: pytest.MonkeyPatch, patched_runtime):
    keyword = Jieba(
        _dataset(
            _dataset_keyword_table(
                keyword_table_dict={"__type__": "keyword_table", "__data__": {"table": {"k": {"node-1", "node-2"}}}}
            )
        )
    )
    monkeypatch.setattr(keyword, "_get_dataset_keyword_table", MagicMock(return_value={"k": {"node-1", "node-2"}}))
    monkeypatch.setattr(keyword, "_delete_ids_from_keyword_table", MagicMock(return_value={"k": {"node-2"}}))
    monkeypatch.setattr(keyword, "_save_dataset_keyword_table", MagicMock())

    keyword.delete_by_ids(["node-1"], patched_runtime.session)

    keyword._get_dataset_keyword_table.assert_called_once_with(patched_runtime.session)
    keyword._delete_ids_from_keyword_table.assert_called_once_with({"k": {"node-1", "node-2"}}, ["node-1"])
    keyword._save_dataset_keyword_table.assert_called_once_with({"k": {"node-2"}}, patched_runtime.session)


def test_delete_by_ids_saves_none_when_keyword_table_is_missing(monkeypatch: pytest.MonkeyPatch, patched_runtime):
    keyword = Jieba(_dataset(_dataset_keyword_table()))
    monkeypatch.setattr(keyword, "_get_dataset_keyword_table", MagicMock(return_value=None))
    monkeypatch.setattr(keyword, "_delete_ids_from_keyword_table", MagicMock())
    monkeypatch.setattr(keyword, "_save_dataset_keyword_table", MagicMock())

    keyword.delete_by_ids(["node-1"], patched_runtime.session)

    keyword._get_dataset_keyword_table.assert_called_once_with(patched_runtime.session)
    keyword._delete_ids_from_keyword_table.assert_not_called()
    keyword._save_dataset_keyword_table.assert_called_once_with(None, patched_runtime.session)


def test_search_returns_documents_in_rank_order_and_applies_filter(monkeypatch: pytest.MonkeyPatch, patched_runtime):
    keyword = Jieba(_dataset(_dataset_keyword_table()))
    patched_runtime.session.add(_segment())
    patched_runtime.session.flush()
    monkeypatch.setattr(keyword, "_retrieve_ids_by_query", MagicMock(return_value=["node-1", "node-2"]))

    documents = keyword.search("query", session=patched_runtime.session, top_k=2, document_ids_filter=["doc-2"])

    assert len(documents) == 1
    assert documents[0].page_content == "segment-content"
    assert documents[0].metadata["doc_id"] == "node-2"
    assert documents[0].metadata["doc_hash"] == "hash-2"


def test_delete_removes_keyword_table_and_optional_file(patched_runtime):
    db_keyword = DatasetKeywordTable(dataset_id="dataset-1", keyword_table="", data_source_type="database")
    patched_runtime.session.add(db_keyword)
    patched_runtime.session.commit()
    commits: list[str] = []
    event.listen(patched_runtime.session, "after_commit", lambda _session: commits.append("commit"))

    keyword_db = Jieba(_dataset(db_keyword))
    keyword_db.delete(session=patched_runtime.session)
    patched_runtime.storage.delete.assert_not_called()
    assert patched_runtime.session.get(DatasetKeywordTable, db_keyword.id) is None

    file_keyword = DatasetKeywordTable(dataset_id="dataset-1", keyword_table="", data_source_type="object_storage")
    patched_runtime.session.add(file_keyword)
    patched_runtime.session.commit()
    keyword_file = Jieba(_dataset(file_keyword))
    keyword_file.delete(session=patched_runtime.session)

    patched_runtime.storage.delete.assert_called_once_with("keyword_files/tenant-1/dataset-1.txt")
    assert patched_runtime.session.get(DatasetKeywordTable, file_keyword.id) is None
    assert commits == ["commit", "commit", "commit"]


def test_save_dataset_keyword_table_to_database(patched_runtime):
    dataset_keyword_table = DatasetKeywordTable(dataset_id="dataset-1", keyword_table="", data_source_type="database")
    patched_runtime.session.add(dataset_keyword_table)
    patched_runtime.session.flush()
    keyword = Jieba(_dataset(dataset_keyword_table))

    keyword._save_dataset_keyword_table({"kw": {"node-1"}}, patched_runtime.session)

    assert '"__type__":"keyword_table"' in dataset_keyword_table.keyword_table
    assert '"index_id":"dataset-1"' in dataset_keyword_table.keyword_table


def test_save_dataset_keyword_table_to_file_storage(patched_runtime):
    dataset_keyword_table = DatasetKeywordTable(dataset_id="dataset-1", keyword_table="", data_source_type="file")
    patched_runtime.session.add(dataset_keyword_table)
    patched_runtime.session.flush()
    keyword = Jieba(_dataset(dataset_keyword_table))
    patched_runtime.storage.exists.return_value = True

    keyword._save_dataset_keyword_table({"kw": {"node-1"}}, patched_runtime.session)

    patched_runtime.storage.delete.assert_called_once_with("keyword_files/tenant-1/dataset-1.txt")
    patched_runtime.storage.save.assert_called_once()
    save_args = patched_runtime.storage.save.call_args.args
    assert save_args[0] == "keyword_files/tenant-1/dataset-1.txt"
    assert isinstance(save_args[1], bytes)


def test_get_dataset_keyword_table_returns_existing_table_data(patched_runtime):
    existing = DatasetKeywordTable(
        dataset_id="dataset-1",
        keyword_table="",
        data_source_type="database",
    )
    existing.get_keyword_table_dict = MagicMock(
        return_value={"__type__": "keyword_table", "__data__": {"table": {"kw": ["node-1"]}}}
    )
    patched_runtime.session.add(existing)
    patched_runtime.session.flush()
    keyword = Jieba(_dataset(existing))
    assert keyword._get_dataset_keyword_table(patched_runtime.session) == {"kw": ["node-1"]}

    existing.get_keyword_table_dict = MagicMock(return_value=None)
    keyword_with_missing_payload = Jieba(_dataset(existing))
    assert keyword_with_missing_payload._get_dataset_keyword_table(patched_runtime.session) == {}


def test_get_dataset_keyword_table_creates_table_when_missing(monkeypatch: pytest.MonkeyPatch, patched_runtime):
    keyword = Jieba(_dataset(dataset_keyword_table=None))
    from tests.unit_tests.config_override import apply_config_overrides

    apply_config_overrides(monkeypatch, KEYWORD_DATA_SOURCE_TYPE="database")
    result = keyword._get_dataset_keyword_table(patched_runtime.session)

    assert result == {}
    created_table = patched_runtime.session.scalar(
        select(DatasetKeywordTable).where(DatasetKeywordTable.dataset_id == "dataset-1")
    )
    assert created_table is not None
    assert created_table.dataset_id == "dataset-1"
    assert created_table.data_source_type == "database"
    assert '"index_id":"dataset-1"' in created_table.keyword_table


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


def test_retrieve_ids_by_query_ranks_by_keyword_frequency(monkeypatch: pytest.MonkeyPatch):
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


def test_update_segment_keywords_updates_when_segment_exists(patched_runtime):
    keyword = Jieba(_dataset(_dataset_keyword_table()))
    segment = _segment(index_node_id="node-1")
    patched_runtime.session.add(segment)
    patched_runtime.session.flush()

    keyword._update_segment_keywords("dataset-1", "node-1", ["kw1", "kw2"], patched_runtime.session)

    assert segment.keywords == ["kw1", "kw2"]

    keyword._update_segment_keywords("dataset-1", "node-missing", ["kw3"], patched_runtime.session)
    assert segment.keywords == ["kw1", "kw2"]


def test_create_segment_keywords_and_update_segment_keywords_index(monkeypatch: pytest.MonkeyPatch, patched_runtime):
    keyword = Jieba(_dataset(_dataset_keyword_table()))
    monkeypatch.setattr(keyword, "_get_dataset_keyword_table", MagicMock(return_value={}))
    monkeypatch.setattr(keyword, "_update_segment_keywords", MagicMock())
    monkeypatch.setattr(keyword, "_save_dataset_keyword_table", MagicMock())

    keyword.create_segment_keywords("node-1", ["kw"], patched_runtime.session)
    keyword._get_dataset_keyword_table.assert_called_once_with(patched_runtime.session)
    keyword._update_segment_keywords.assert_called_once_with("dataset-1", "node-1", ["kw"], patched_runtime.session)
    keyword._save_dataset_keyword_table.assert_called_once_with({"kw": {"node-1"}}, patched_runtime.session)

    keyword._get_dataset_keyword_table.reset_mock()
    keyword._save_dataset_keyword_table.reset_mock()
    keyword.update_segment_keywords_index("node-2", ["kw2"], patched_runtime.session)
    keyword._get_dataset_keyword_table.assert_called_once_with(patched_runtime.session)
    keyword._save_dataset_keyword_table.assert_called_once_with({"kw2": {"node-2"}}, patched_runtime.session)


def test_multi_create_segment_keywords_uses_provided_and_extracted_keywords(
    monkeypatch: pytest.MonkeyPatch, patched_runtime
):
    keyword = Jieba(_dataset(_dataset_keyword_table(), keyword_number=2))
    handler = MagicMock()
    handler.extract_keywords.return_value = {"auto"}
    monkeypatch.setattr(jieba_module, "JiebaKeywordTableHandler", lambda: handler)
    monkeypatch.setattr(keyword, "_get_dataset_keyword_table", MagicMock(return_value={}))
    monkeypatch.setattr(keyword, "_save_dataset_keyword_table", MagicMock())

    first_segment = _segment(index_node_id="node-1")
    first_segment.content = "first content"
    first_segment.keywords = None
    second_segment = _segment(index_node_id="node-2")
    second_segment.content = "second content"
    second_segment.keywords = None

    keyword.multi_create_segment_keywords(
        [
            {"segment": first_segment, "keywords": ["manual"]},
            {"segment": second_segment, "keywords": []},
        ],
        patched_runtime.session,
    )

    assert first_segment.keywords == ["manual"]
    assert second_segment.keywords == ["auto"]
    saved_table = keyword._save_dataset_keyword_table.call_args.args[0]
    assert saved_table["manual"] == {"node-1"}
    assert saved_table["auto"] == {"node-2"}
    assert keyword._save_dataset_keyword_table.call_args.args[1] is patched_runtime.session


def test_set_orjson_default_and_dumps_with_sets():
    assert set(set_orjson_default({"a", "b"})) == {"a", "b"}

    with pytest.raises(TypeError, match="is not JSON serializable"):
        set_orjson_default(("not", "a", "set"))

    payload = {"items": {"a", "b"}}
    json_payload = dumps_with_sets(payload)
    decoded = json.loads(json_payload)
    assert set(decoded["items"]) == {"a", "b"}
