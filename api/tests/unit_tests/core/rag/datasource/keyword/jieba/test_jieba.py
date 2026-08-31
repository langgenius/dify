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
from models.dataset import ChildChunk, Dataset, DatasetKeywordTable, DocumentSegment
from models.enums import SegmentType


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
    monkeypatch.setattr(jieba_module.dify_config, "KEYWORD_DATA_SOURCE_TYPE", "database")
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


# =============================================================================
# #40680 regressions: child chunk keyword search + keyword table sync helpers.
# =============================================================================


def _child_chunk(
    *,
    index_node_id: str = "child-node-1",
    content: str = "child content",
    segment_id: str = "segment-1",
    document_id: str = "doc-1",
    dataset_id: str = "dataset-1",
) -> ChildChunk:
    chunk = ChildChunk(
        tenant_id="tenant-1",
        dataset_id=dataset_id,
        document_id=document_id,
        segment_id=segment_id,
        position=1,
        content=content,
        word_count=len(content),
        created_by="user-1",
        type=SegmentType.AUTOMATIC,
        index_node_id=index_node_id,
        index_node_hash=f"hash-{index_node_id}",
    )
    chunk.id = f"child-{index_node_id}"
    return chunk


def test_search_queries_child_chunk_table(monkeypatch: pytest.MonkeyPatch, patched_runtime):
    """Regression for #40680: `Jieba.search` must resolve matching IDs
    from `ChildChunk` as well as `DocumentSegment` so child chunk keyword
    hits are not silently dropped. Pre-fix only `DocumentSegment` was
    queried, which meant a valid keyword table hit on a child chunk's
    `index_node_id` was never materialized as a retrieval document.
    """
    # Persist a ChildChunk row whose `index_node_id` is in the keyword
    # table. Use flush (not commit) to match the working `test_search`
    # pattern in this file and avoid the FK-cascade cost of a commit.
    child = _child_chunk(
        index_node_id="child-uuid-1",
        content="child chunk content",
        segment_id="segment-uuid-1",
    )
    patched_runtime.session.add(child)
    patched_runtime.session.flush()

    # Build a keyword table where the only match points to the child.
    table = {"kw1": {"child-uuid-1"}}
    payload = {"__type__": "keyword_table", "__data__": {"index_id": "dataset-1", "summary": None, "table": table}}
    dkt = _dataset_keyword_table(keyword_table_dict=payload)
    keyword = Jieba(_dataset(dkt))
    # Bypass the actual keyword table extraction so the test is
    # deterministic regardless of the jieba vocabulary shipped with
    # the test environment.
    monkeypatch.setattr(keyword, "_retrieve_ids_by_query", MagicMock(return_value=["child-uuid-1"]))

    documents = keyword.search("kw1", session=patched_runtime.session)

    assert len(documents) == 1
    assert documents[0].page_content == "child chunk content"
    assert documents[0].metadata["doc_id"] == "child-uuid-1"
    assert documents[0].metadata["is_child_chunk"] is True
    assert documents[0].metadata["segment_id"] == "segment-uuid-1"
    assert documents[0].metadata["document_id"] == "doc-1"


def test_search_resolves_mixed_segment_and_child_hits(monkeypatch: pytest.MonkeyPatch, patched_runtime):
    """Regression for #40680: when the keyword table contains both a
    segment and a child chunk index_node_id, the search must return
    both kinds in ranking order. Pre-fix only `DocumentSegment` was
    queried, so the child hit was silently dropped and the result
    list was effectively truncated to the segment subset.
    """
    child = _child_chunk(index_node_id="child-uuid-1", content="child content")
    segment = _segment(index_node_id="segment-uuid-1")
    patched_runtime.session.add(child)
    patched_runtime.session.add(segment)
    patched_runtime.session.flush()

    table = {"kw1": {"child-uuid-1", "segment-uuid-1"}}
    payload = {"__type__": "keyword_table", "__data__": {"index_id": "dataset-1", "summary": None, "table": table}}
    dkt = _dataset_keyword_table(keyword_table_dict=payload)
    keyword = Jieba(_dataset(dkt))
    monkeypatch.setattr(keyword, "_retrieve_ids_by_query", MagicMock(return_value=["child-uuid-1", "segment-uuid-1"]))

    documents = keyword.search("kw1", session=patched_runtime.session)

    assert len(documents) == 2
    by_id = {doc.metadata["doc_id"]: doc for doc in documents}
    assert set(by_id) == {"child-uuid-1", "segment-uuid-1"}
    assert by_id["child-uuid-1"].metadata["is_child_chunk"] is True
    assert by_id["segment-uuid-1"].metadata["is_child_chunk"] is False


def test_search_applies_document_ids_filter_to_child_chunks(monkeypatch: pytest.MonkeyPatch, patched_runtime):
    """Regression for #40680: the `document_ids_filter` must apply to
    child chunk results too. Pre-fix the filter only narrowed the
    `DocumentSegment` query, so a child chunk from a denied document
    would still appear in the result list.
    """
    child_visible = _child_chunk(
        index_node_id="child-uuid-1",
        content="visible child",
        document_id="doc-allowed",
    )
    child_hidden = _child_chunk(
        index_node_id="child-uuid-2",
        content="hidden child",
        document_id="doc-denied",
    )
    patched_runtime.session.add(child_visible)
    patched_runtime.session.add(child_hidden)
    patched_runtime.session.flush()

    table = {"kw1": {"child-uuid-1", "child-uuid-2"}}
    payload = {"__type__": "keyword_table", "__data__": {"index_id": "dataset-1", "summary": None, "table": table}}
    dkt = _dataset_keyword_table(keyword_table_dict=payload)
    keyword = Jieba(_dataset(dkt))
    monkeypatch.setattr(keyword, "_retrieve_ids_by_query", MagicMock(return_value=["child-uuid-1", "child-uuid-2"]))

    documents = keyword.search("kw1", session=patched_runtime.session, document_ids_filter=["doc-allowed"])

    assert len(documents) == 1
    assert documents[0].page_content == "visible child"


def test_add_child_chunk_keywords_inserts_into_table(monkeypatch: pytest.MonkeyPatch, patched_runtime):
    """Regression for #40680: a new child chunk's keywords must be added
    to the dataset keyword table so subsequent searches can find it."""
    keyword = Jieba(_dataset(_dataset_keyword_table(), keyword_number=5))
    handler = MagicMock()
    handler.extract_keywords.return_value = {"alpha", "beta"}
    monkeypatch.setattr(jieba_module, "JiebaKeywordTableHandler", lambda: handler)
    monkeypatch.setattr(keyword, "_get_dataset_keyword_table", MagicMock(return_value={}))
    monkeypatch.setattr(keyword, "_save_dataset_keyword_table", MagicMock())
    monkeypatch.setattr(keyword, "_add_text_to_keyword_table", MagicMock())

    child = _child_chunk(index_node_id="child-uuid-1", content="hello world")
    keyword.add_child_chunk_keywords(child, session=patched_runtime.session)

    handler.extract_keywords.assert_called_once_with("hello world", 5)
    keyword._add_text_to_keyword_table.assert_called_once()
    call_args = keyword._add_text_to_keyword_table.call_args
    assert call_args.args[0] == {}
    assert call_args.args[1] == "child-uuid-1"
    assert set(call_args.args[2]) == {"alpha", "beta"}


def test_delete_child_chunk_keywords_removes_from_table(monkeypatch: pytest.MonkeyPatch, patched_runtime):
    """Regression for #40680: deleting a child chunk must remove its
    index_node_id from every keyword set in the keyword table, otherwise
    future searches would return orphaned hits."""
    keyword = Jieba(_dataset(_dataset_keyword_table()))
    keyword_table = {"alpha": {"child-uuid-1", "other-node"}, "beta": {"child-uuid-1"}}
    monkeypatch.setattr(keyword, "_get_dataset_keyword_table", MagicMock(return_value=keyword_table))
    monkeypatch.setattr(keyword, "_delete_ids_from_keyword_table", MagicMock())
    monkeypatch.setattr(keyword, "_save_dataset_keyword_table", MagicMock())

    child = _child_chunk(index_node_id="child-uuid-1")
    keyword.delete_child_chunk_keywords(child, session=patched_runtime.session)

    # The method delegates to `_delete_ids_from_keyword_table` with the
    # child chunk's index_node_id.
    keyword._delete_ids_from_keyword_table.assert_called_once()
    call_args = keyword._delete_ids_from_keyword_table.call_args
    assert call_args.args[0] == keyword_table
    assert call_args.args[1] == ["child-uuid-1"]


def test_update_child_chunk_keywords_replaces_in_table(monkeypatch: pytest.MonkeyPatch, patched_runtime):
    """Regression for #40680: when a child chunk's content is updated, the
    old keywords for that index_node_id must be removed and the new
    keywords (extracted from the new content) must be inserted."""
    keyword = Jieba(_dataset(_dataset_keyword_table(), keyword_number=5))
    delete_mock = MagicMock()
    add_mock = MagicMock()
    monkeypatch.setattr(keyword, "delete_child_chunk_keywords", delete_mock)
    monkeypatch.setattr(keyword, "add_child_chunk_keywords", add_mock)

    child = _child_chunk(index_node_id="child-uuid-1", content="updated content")
    keyword.update_child_chunk_keywords(child, session=patched_runtime.session)

    delete_mock.assert_called_once_with(child, patched_runtime.session)
    add_mock.assert_called_once_with(child, patched_runtime.session)


def test_add_child_chunk_keywords_skips_when_index_node_id_missing(monkeypatch: pytest.MonkeyPatch, patched_runtime):
    """Guard: a child chunk without an index_node_id (e.g. still being
    inserted) must not crash the keyword sync path."""
    keyword = Jieba(_dataset(_dataset_keyword_table()))
    monkeypatch.setattr(keyword, "_get_dataset_keyword_table", MagicMock())

    child = _child_chunk()
    child.index_node_id = None

    # Should be a no-op, not an exception.
    keyword.add_child_chunk_keywords(child, session=patched_runtime.session)
    keyword._get_dataset_keyword_table.assert_not_called()
