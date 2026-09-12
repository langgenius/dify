from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass, field

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.rag.datasource.keyword.jieba import jieba as jieba_module
from core.rag.datasource.keyword.jieba import keyword_table as table_module
from core.rag.datasource.keyword.jieba.jieba import Jieba
from core.rag.models.document import Document
from models.dataset import Dataset, DatasetKeywordTable, DocumentSegment
from tests.unit_tests.config_override import apply_config_overrides


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
        row = self.dataset.get_dataset_keyword_table(session=self.session)
        assert row is not None
        payload = row.get_keyword_table_dict(session=self.session)
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
    monkeypatch.setattr(table_module, "storage", storage)
    apply_config_overrides(monkeypatch, KEYWORD_DATA_SOURCE_TYPE=request.param)
    dataset = Dataset(id="dataset-1", tenant_id="tenant-1", name="Test", created_by="author", keyword_number=2)
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
    row = runtime.dataset.get_dataset_keyword_table(session=runtime.session)
    assert row is not None
    payload = row.get_keyword_table_dict(session=runtime.session)
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
    row = runtime.dataset.get_dataset_keyword_table(session=runtime.session)
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
