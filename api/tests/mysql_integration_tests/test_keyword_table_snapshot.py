from collections.abc import Callable, Generator
from contextlib import contextmanager
from dataclasses import dataclass, field
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.rag.datasource.keyword.jieba import jieba as jieba_module
from core.rag.datasource.keyword.jieba.jieba import Jieba
from core.rag.models.document import Document
from models.dataset import Dataset, DatasetKeywordTable, DocumentSegment
from repositories.knowledge.dataset_read_repository import get_dataset_keyword_table
from repositories.knowledge.keyword_table_repository import load_keyword_table


@dataclass
class KeywordStorage:
    files: dict[str, bytes] = field(default_factory=dict)

    def load_once(self, key: str) -> bytes:
        if key not in self.files:
            raise FileNotFoundError(key)
        return self.files[key]

    def save(self, key: str, data: bytes) -> None:
        self.files[key] = data

    def delete(self, key: str) -> None:
        del self.files[key]


class ImmediateLocks:
    @contextmanager
    def lock(self, _name: str, *, timeout: int) -> Generator[None]:
        assert timeout == 600
        yield


@dataclass
class CommitOnFirstLock:
    action: Callable[[], None]
    triggered: bool = False

    @contextmanager
    def lock(self, _name: str, *, timeout: int) -> Generator[None]:
        assert timeout == 600
        if not self.triggered:
            self.triggered = True
            self.action()
        yield


def _repeatable_read_sessions(mysql_session: Session) -> sessionmaker[Session]:
    engine = mysql_session.get_bind().execution_options(isolation_level="REPEATABLE READ")
    return sessionmaker(bind=engine, expire_on_commit=False)


def _segment(*, tenant_id: str, dataset_id: str, node_id: str) -> DocumentSegment:
    return DocumentSegment(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        document_id=str(uuid4()),
        position=1,
        content=node_id,
        word_count=len(node_id),
        tokens=0,
        created_by=str(uuid4()),
        index_node_id=node_id,
    )


@pytest.mark.parametrize("storage_type", ["database", "file"])
def test_keyword_update_refreshes_repeatable_read_snapshot_after_lock(
    mysql_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    storage_type: str,
) -> None:
    sessions = _repeatable_read_sessions(mysql_session)
    tenant_id = str(uuid4())
    dataset_id = str(uuid4())
    storage = KeywordStorage()
    monkeypatch.setattr(jieba_module, "storage", storage)
    monkeypatch.setattr(jieba_module, "redis_client", ImmediateLocks())
    monkeypatch.setattr(jieba_module.dify_config, "KEYWORD_DATA_SOURCE_TYPE", storage_type)
    with sessions.begin() as session:
        session.add(Dataset(id=dataset_id, tenant_id=tenant_id, name="Keyword snapshot", created_by=str(uuid4())))
        session.add_all(
            [
                _segment(tenant_id=tenant_id, dataset_id=dataset_id, node_id="node-1"),
                _segment(tenant_id=tenant_id, dataset_id=dataset_id, node_id="node-2"),
                _segment(tenant_id=tenant_id, dataset_id=dataset_id, node_id="node-3"),
            ]
        )

    with sessions() as seed:
        dataset = seed.get(Dataset, dataset_id)
        assert dataset is not None
        Jieba(dataset).add_texts(
            [Document(page_content="alpha", metadata={"doc_id": "node-1"})],
            seed,
            keywords_list=[["alpha"]],
        )
        seed.commit()

    with sessions() as caller:
        dataset = caller.get(Dataset, dataset_id)
        assert dataset is not None
        stale_row = get_dataset_keyword_table(dataset, session=caller)
        assert stale_row is not None
        stale_data = stale_row.keyword_table

        def commit_concurrent_update() -> None:
            with sessions() as writer:
                concurrent_dataset = writer.get(Dataset, dataset_id)
                assert concurrent_dataset is not None
                Jieba(concurrent_dataset).add_texts(
                    [Document(page_content="beta", metadata={"doc_id": "node-2"})],
                    writer,
                    keywords_list=[["beta"]],
                )
                writer.commit()

        locks = CommitOnFirstLock(commit_concurrent_update)
        monkeypatch.setattr(jieba_module, "redis_client", locks)
        Jieba(dataset).add_texts(
            [Document(page_content="gamma", metadata={"doc_id": "node-3"})],
            caller,
            keywords_list=[["gamma"]],
        )
        assert stale_row.keyword_table == stale_data
        caller.commit()

    assert locks.triggered is True
    with sessions() as verifier:
        dataset = verifier.get(Dataset, dataset_id)
        assert dataset is not None
        row = get_dataset_keyword_table(dataset, session=verifier)
        assert row is not None
        payload = load_keyword_table(
            storage=storage,
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            storage_type=row.data_source_type,
            data=row.keyword_table,
        )
        assert payload is not None
        assert payload["__data__"]["table"] == {
            "alpha": {"node-1"},
            "beta": {"node-2"},
            "gamma": {"node-3"},
        }
    if storage_type == "file":
        assert len(storage.files) == 1


@pytest.mark.parametrize("storage_type", ["database", "file"])
@pytest.mark.parametrize("consumer", ["search", "text_exists"])
def test_keyword_read_current_reads_after_repeatable_read_snapshot(
    mysql_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    storage_type: str,
    consumer: str,
) -> None:
    sessions = _repeatable_read_sessions(mysql_session)
    tenant_id = str(uuid4())
    dataset_id = str(uuid4())
    storage = KeywordStorage()
    monkeypatch.setattr(jieba_module, "storage", storage)
    monkeypatch.setattr(jieba_module, "redis_client", ImmediateLocks())
    monkeypatch.setattr(jieba_module.dify_config, "KEYWORD_DATA_SOURCE_TYPE", storage_type)
    with sessions.begin() as session:
        session.add(Dataset(id=dataset_id, tenant_id=tenant_id, name="Keyword read", created_by=str(uuid4())))
        session.add_all(
            [
                _segment(tenant_id=tenant_id, dataset_id=dataset_id, node_id="node-1"),
                _segment(tenant_id=tenant_id, dataset_id=dataset_id, node_id="node-2"),
            ]
        )

    with sessions() as seed:
        dataset = seed.get(Dataset, dataset_id)
        assert dataset is not None
        Jieba(dataset).add_texts(
            [Document(page_content="alpha", metadata={"doc_id": "node-1"})],
            seed,
            keywords_list=[["alpha"]],
        )
        seed.commit()

    with sessions() as caller:
        dataset = caller.get(Dataset, dataset_id)
        assert dataset is not None
        stale_row = get_dataset_keyword_table(dataset, session=caller)
        assert stale_row is not None
        stale_data = stale_row.keyword_table

        def commit_concurrent_update() -> None:
            with sessions() as writer:
                concurrent_dataset = writer.get(Dataset, dataset_id)
                assert concurrent_dataset is not None
                Jieba(concurrent_dataset).add_texts(
                    [Document(page_content="beta", metadata={"doc_id": "node-2"})],
                    writer,
                    keywords_list=[["beta"]],
                )
                writer.commit()

        locks = CommitOnFirstLock(commit_concurrent_update)
        monkeypatch.setattr(jieba_module, "redis_client", locks)
        keyword = Jieba(dataset)
        if consumer == "search":
            assert [document.metadata["doc_id"] for document in keyword.search("beta", session=caller)] == ["node-2"]
        else:
            assert keyword.text_exists("node-2", session=caller)
        assert stale_row.keyword_table != stale_data
        caller.commit()

    assert locks.triggered is True


@pytest.mark.parametrize("storage_type", ["database", "file"])
def test_keyword_delete_current_reads_a_row_created_after_repeatable_read_snapshot(
    mysql_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    storage_type: str,
) -> None:
    sessions = _repeatable_read_sessions(mysql_session)
    tenant_id = str(uuid4())
    dataset_id = str(uuid4())
    storage = KeywordStorage()
    monkeypatch.setattr(jieba_module, "storage", storage)
    monkeypatch.setattr(jieba_module.dify_config, "KEYWORD_DATA_SOURCE_TYPE", storage_type)
    with sessions.begin() as session:
        session.add(Dataset(id=dataset_id, tenant_id=tenant_id, name="Keyword delete", created_by=str(uuid4())))
        session.add(_segment(tenant_id=tenant_id, dataset_id=dataset_id, node_id="node-1"))

    with sessions() as caller:
        dataset = caller.get(Dataset, dataset_id)
        assert dataset is not None
        assert get_dataset_keyword_table(dataset, session=caller) is None

        def commit_concurrent_create() -> None:
            with sessions() as writer:
                concurrent_dataset = writer.get(Dataset, dataset_id)
                assert concurrent_dataset is not None
                Jieba(concurrent_dataset).add_texts(
                    [Document(page_content="alpha", metadata={"doc_id": "node-1"})],
                    writer,
                    keywords_list=[["alpha"]],
                )
                writer.commit()

        locks = CommitOnFirstLock(commit_concurrent_create)
        monkeypatch.setattr(jieba_module, "redis_client", locks)
        Jieba(dataset).delete(session=caller)
        caller.commit()

    assert locks.triggered is True
    with sessions() as verifier:
        assert verifier.scalar(select(DatasetKeywordTable).where(DatasetKeywordTable.dataset_id == dataset_id)) is None
    assert storage.files == {}
