from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import asdict, dataclass, field
from unittest.mock import MagicMock

import pytest
from sqlalchemy import Engine, event, select
from sqlalchemy.orm import Session

from core.rag.datasource.keyword.jieba import jieba as jieba_module
from core.rag.datasource.keyword.jieba.jieba import Jieba, KeywordSearchDiagnostics
from core.rag.models.document import Document
from models.dataset import ChildChunk, Dataset, DatasetKeywordTable, DocumentSegment
from repositories.knowledge.dataset_read_repository import get_dataset_keyword_table
from repositories.knowledge.keyword_table_repository import load_keyword_table
from tests.unit_tests.config_override import apply_config_overrides
from tests.unit_tests.model_factories import make_dataset


@dataclass
class KeywordStorage:
    files: dict[str, bytes] = field(default_factory=dict)
    reads: list[str] = field(default_factory=list)
    writes: list[str] = field(default_factory=list)

    def load_once(self, key: str) -> bytes:
        self.reads.append(key)
        if key not in self.files:
            raise FileNotFoundError(key)
        return self.files[key]

    def exists(self, key: str) -> bool:
        return key in self.files

    def save(self, key: str, data: bytes) -> None:
        self.files[key] = data
        self.writes.append(key)

    def delete(self, key: str) -> None:
        del self.files[key]


@dataclass
class KeywordLocks:
    acquired: list[str] = field(default_factory=list)
    held: bool = False

    @contextmanager
    def lock(self, name: str, *, timeout: int) -> Generator[None]:
        assert timeout == 600
        assert not self.held
        self.acquired.append(name)
        self.held = True
        try:
            yield
        finally:
            self.held = False


@dataclass
class KeywordRuntime:
    session: Session
    dataset: Dataset
    storage: KeywordStorage
    locks: KeywordLocks
    extracted: list[tuple[str, int]]

    def table(self) -> dict[str, set[str]]:
        row = get_dataset_keyword_table(self.dataset, session=self.session)
        assert row is not None
        payload = load_keyword_table(
            storage=self.storage,
            tenant_id=self.dataset.tenant_id,
            dataset_id=self.dataset.id,
            storage_type=row.data_source_type,
            data=row.keyword_table,
        )
        assert payload is not None
        return payload["__data__"]["table"]


@pytest.fixture(params=["database", "file"])
def runtime(request: pytest.FixtureRequest, sqlite_session: Session, monkeypatch: pytest.MonkeyPatch) -> KeywordRuntime:
    storage = KeywordStorage()
    locks = KeywordLocks()
    extracted: list[tuple[str, int]] = []

    class KeywordExtractor:
        def extract_keywords(self, text: str, keyword_number: int = 10) -> set[str]:
            extracted.append((text, keyword_number))
            return set(text.split()[:keyword_number])

    monkeypatch.setattr(jieba_module, "JiebaKeywordTableHandler", KeywordExtractor)
    monkeypatch.setattr(jieba_module, "redis_client", locks)
    monkeypatch.setattr(jieba_module, "storage", storage)
    apply_config_overrides(monkeypatch, KEYWORD_DATA_SOURCE_TYPE=request.param)
    dataset = make_dataset(name="Test", created_by="author", keyword_number=2)
    sqlite_session.add(dataset)
    sqlite_session.commit()
    return KeywordRuntime(sqlite_session, dataset, storage, locks, extracted)


def segment(node_id: str, *, tenant_id: str = "tenant-1") -> DocumentSegment:
    return DocumentSegment(
        tenant_id=tenant_id,
        dataset_id="dataset-1",
        document_id="document-1",
        position=1,
        content=node_id,
        word_count=len(node_id),
        tokens=0,
        created_by="author",
        index_node_id=node_id,
    )


def child(node_id: str, parent: DocumentSegment, *, content: str) -> ChildChunk:
    return ChildChunk(
        tenant_id=parent.tenant_id,
        dataset_id=parent.dataset_id,
        document_id=parent.document_id,
        segment_id=parent.id,
        position=1,
        content=content,
        word_count=len(content),
        created_by="author",
        index_node_id=node_id,
        index_node_hash=f"hash-{node_id}",
    )


def test_create_extracts_keywords_and_persists_the_shared_format(runtime: KeywordRuntime) -> None:
    chunk = segment("node-1")
    foreign = segment("node-1", tenant_id="tenant-2")
    runtime.session.add_all([chunk, foreign])
    keyword = Jieba(runtime.dataset)
    result = keyword.create(
        [Document(page_content="中文 alpha ignored", metadata={"doc_id": "node-1"})], runtime.session
    )
    runtime.session.commit()

    assert result is keyword
    assert set(chunk.keywords) == {"中文", "alpha"}
    assert foreign.keywords is None
    assert runtime.table() == {"中文": {"node-1"}, "alpha": {"node-1"}}
    assert runtime.extracted == [("中文 alpha ignored", 2)]
    assert runtime.locks.acquired == ["keyword_indexing_lock_dataset-1"]
    assert runtime.locks.held is False
    row = get_dataset_keyword_table(runtime.dataset, session=runtime.session)
    assert row is not None
    payload = load_keyword_table(
        storage=runtime.storage,
        tenant_id=runtime.dataset.tenant_id,
        dataset_id=runtime.dataset.id,
        storage_type=row.data_source_type,
        data=row.keyword_table,
    )
    assert payload is not None
    assert payload["__type__"] == "keyword_table"
    assert payload["__data__"]["index_id"] == "dataset-1"
    if row.data_source_type == "file":
        assert row.keyword_table == ""
        assert runtime.storage.writes == ["keyword_files/tenant-1/dataset-1.txt"]
    else:
        assert runtime.storage.reads == []
        assert runtime.storage.writes == []


def test_add_uses_manual_keywords_and_extracts_empty_selections(runtime: KeywordRuntime) -> None:
    chunks = [segment("node-1"), segment("node-2")]
    runtime.session.add_all(chunks)
    keyword = Jieba(runtime.dataset)
    keyword.add_texts(
        [
            Document(page_content="automatic", metadata={"doc_id": "node-1"}),
            Document(page_content="ignored", metadata={"doc_id": "node-2"}),
        ],
        runtime.session,
        keywords_list=[[], ["manual"]],
    )
    runtime.session.commit()
    assert runtime.table() == {"automatic": {"node-1"}, "manual": {"node-2"}}
    assert runtime.extracted == [("automatic", 2)]
    assert chunks[0].keywords == ["automatic"]
    assert chunks[1].keywords == ["manual"]


def test_delete_ids_preserves_unrelated_entries(runtime: KeywordRuntime) -> None:
    keyword = Jieba(runtime.dataset)
    keyword.add_texts(
        [
            Document(page_content="shared first", metadata={"doc_id": "node-1"}),
            Document(page_content="shared second", metadata={"doc_id": "node-2"}),
        ],
        runtime.session,
    )
    runtime.session.commit()
    keyword.delete_by_ids(["node-1"], runtime.session)
    runtime.session.commit()
    assert runtime.table() == {"shared": {"node-2"}, "second": {"node-2"}}
    assert keyword.text_exists("node-1", session=runtime.session) is False
    assert keyword.text_exists("node-2", session=runtime.session) is True
    keyword.delete_by_ids(["node-2"], runtime.session)
    runtime.session.commit()
    assert runtime.table() == {}
    assert keyword.text_exists("node-2", session=runtime.session) is False


def test_delete_without_an_existing_table_is_idempotent(runtime: KeywordRuntime) -> None:
    keyword = Jieba(runtime.dataset)
    assert keyword.text_exists("missing", session=runtime.session) is False
    keyword.delete_by_ids(["missing"], runtime.session)
    runtime.session.commit()
    keyword.delete_by_ids(["missing"], runtime.session)
    runtime.session.commit()
    assert runtime.table() == {}


def test_search_preserves_ranking_and_document_filters(runtime: KeywordRuntime) -> None:
    first, second = segment("node-1"), segment("node-2")
    second.document_id = "document-2"
    runtime.session.add_all([first, second])
    keyword = Jieba(runtime.dataset)
    keyword.add_texts(
        [
            Document(page_content="alpha", metadata={"doc_id": "node-1"}),
            Document(page_content="alpha beta", metadata={"doc_id": "node-2"}),
        ],
        runtime.session,
    )
    runtime.session.commit()
    documents = keyword.search("alpha beta", session=runtime.session, top_k=2)
    assert [doc.metadata["doc_id"] for doc in documents] == ["node-2", "node-1"]
    documents = keyword.search("alpha beta", session=runtime.session, top_k=2, document_ids_filter=["document-1"])
    assert [doc.metadata["doc_id"] for doc in documents] == ["node-1"]


def test_search_materializes_ranked_child_hits_and_applies_document_filter(runtime: KeywordRuntime) -> None:
    first_parent, second_parent = segment("parent-1"), segment("parent-2")
    second_parent.document_id = "document-2"
    runtime.session.add_all([first_parent, second_parent])
    runtime.session.flush()
    runtime.session.add_all(
        [
            child("child-1", first_parent, content="alpha beta"),
            child("child-2", second_parent, content="alpha"),
        ]
    )
    keyword = Jieba(runtime.dataset)
    keyword.add_texts(
        [
            Document(page_content="alpha beta", metadata={"doc_id": "child-1"}),
            Document(page_content="alpha", metadata={"doc_id": "child-2"}),
        ],
        runtime.session,
    )
    runtime.session.commit()

    documents = keyword.search("alpha beta", session=runtime.session, top_k=2)
    assert [document.metadata["doc_id"] for document in documents] == ["child-1", "child-2"]
    assert [document.page_content for document in documents] == ["alpha beta", "alpha"]
    filtered = keyword.search("alpha beta", session=runtime.session, top_k=2, document_ids_filter=["document-1"])
    assert [document.metadata["doc_id"] for document in filtered] == ["child-1"]
    assert first_parent.keywords is None
    assert second_parent.keywords is None


@pytest.mark.parametrize(
    ("keyword_hits", "materialized", "filter_applied", "status", "filtered_out", "unresolved"),
    [
        (0, 0, False, "empty_valid", 0, 0),
        (0, 0, True, "empty_valid", 0, 0),
        (2, 2, False, "ok", 0, 0),
        (2, 2, True, "ok", 0, 0),
        (2, 1, False, "partial", 0, 1),
        (2, 0, False, "broken_empty", 0, 2),
        (2, 1, True, "filter_indeterminate", None, None),
        (2, 0, True, "filter_indeterminate", None, None),
    ],
)
def test_keyword_search_diagnostics_classify_known_and_ambiguous_outcomes(
    keyword_hits, materialized, filter_applied, status, filtered_out, unresolved
) -> None:
    diagnostics = KeywordSearchDiagnostics.from_counts(
        keyword_hits=keyword_hits, materialized=materialized, filter_applied=filter_applied
    )
    assert asdict(diagnostics) == {
        "keyword_hits": keyword_hits,
        "materialized": materialized,
        "filtered_out": filtered_out,
        "unresolved": unresolved,
        "filter_applied": filter_applied,
        "status": status,
    }


@pytest.mark.parametrize("filtered", [False, True])
def test_search_keeps_partial_results_and_logs_accurate_diagnostics(
    runtime: KeywordRuntime, monkeypatch: pytest.MonkeyPatch, filtered: bool
) -> None:
    runtime.session.add(segment("present-node"))
    keyword = Jieba(runtime.dataset)
    keyword.add_texts(
        [
            Document(page_content="shared", metadata={"doc_id": "present-node"}),
            Document(page_content="shared", metadata={"doc_id": "missing-node"}),
        ],
        runtime.session,
    )
    runtime.session.commit()
    logger = MagicMock()
    monkeypatch.setattr(jieba_module, "logger", logger)

    documents = keyword.search(
        "shared", session=runtime.session, top_k=2, **({"document_ids_filter": ["document-1"]} if filtered else {})
    )

    assert [document.metadata["doc_id"] for document in documents] == ["present-node"]
    logged = logger.debug if filtered else logger.warning
    logged.assert_called_once()
    diagnostics = logged.call_args.kwargs["extra"]["keyword_search_diagnostics"]
    assert diagnostics == {
        "keyword_hits": 2,
        "materialized": 1,
        "filtered_out": None if filtered else 0,
        "unresolved": None if filtered else 1,
        "filter_applied": filtered,
        "status": "filter_indeterminate" if filtered else "partial",
    }
    (logger.warning if filtered else logger.debug).assert_not_called()


def test_empty_keyword_hits_skip_materialization_queries(runtime: KeywordRuntime, sqlite_engine: Engine) -> None:
    statements: list[str] = []

    def record_sql(_conn, _cursor, statement, _parameters, _context, _executemany):
        statements.append(statement)

    event.listen(sqlite_engine, "before_cursor_execute", record_sql)
    try:
        result = Jieba(runtime.dataset)._search_with_diagnostics("unmatched", session=runtime.session)
    finally:
        event.remove(sqlite_engine, "before_cursor_execute", record_sql)

    assert result.results == []
    assert result.diagnostics.status == "empty_valid"
    assert not any(
        "FROM child_chunks" in statement or "FROM document_segments" in statement for statement in statements
    )


def test_delete_removes_the_database_record_and_file(runtime: KeywordRuntime) -> None:
    keyword = Jieba(runtime.dataset)
    keyword.create([Document(page_content="alpha", metadata={"doc_id": "node-1"})], runtime.session)
    runtime.session.commit()
    keyword.delete(session=runtime.session)
    assert runtime.session.scalar(select(DatasetKeywordTable)) is None
    assert runtime.storage.files == {}


def test_mutation_does_not_replace_an_unreadable_table(
    runtime: KeywordRuntime, monkeypatch: pytest.MonkeyPatch
) -> None:
    keyword = Jieba(runtime.dataset)
    keyword.create([Document(page_content="original", metadata={"doc_id": "node-1"})], runtime.session)
    runtime.session.commit()
    row = get_dataset_keyword_table(runtime.dataset, session=runtime.session)
    assert row is not None
    stored_files = dict(runtime.storage.files)
    writes = list(runtime.storage.writes)
    if row.data_source_type == "database":
        row.keyword_table = "invalid json"
        runtime.session.commit()
        expected_error = ValueError
    else:

        def fail_read(_key: str) -> bytes:
            raise OSError("storage unavailable")

        monkeypatch.setattr(runtime.storage, "load_once", fail_read)
        expected_error = OSError
    with pytest.raises(expected_error):
        keyword.add_texts([Document(page_content="replacement", metadata={"doc_id": "node-1"})], runtime.session)
    runtime.session.rollback()
    assert runtime.storage.files == stored_files
    assert runtime.storage.writes == writes
    assert runtime.locks.held is False
    if row.data_source_type == "database":
        assert row.keyword_table == "invalid json"


def test_deletion_does_not_initialize_the_keyword_extractor(
    runtime: KeywordRuntime, monkeypatch: pytest.MonkeyPatch
) -> None:
    keyword = Jieba(runtime.dataset)
    keyword.create([Document(page_content="original", metadata={"doc_id": "node-1"})], runtime.session)
    runtime.session.commit()

    def unexpected_extractor() -> None:
        pytest.fail("Index cleanup must not initialize the text extractor")

    monkeypatch.setattr(jieba_module, "JiebaKeywordTableHandler", unexpected_extractor)
    keyword.delete_by_ids(["node-1"], runtime.session)
    runtime.session.commit()
    assert runtime.table() == {}
