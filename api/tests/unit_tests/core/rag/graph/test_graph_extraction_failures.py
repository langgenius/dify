"""Extraction failures are recorded so the console can explain an empty graph."""

from collections.abc import Callable, Iterator

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.rag.graph import graph_index_service as module
from core.rag.graph.entities import ChunkExtractionBatch, ChunkExtractionFailure
from core.rag.graph.graph_index_service import GraphIndexService
from core.rag.models.document import Document
from models.dataset import Dataset, DatasetGraphExtractionFailure

_CONFIGURED = {"enabled": True, "model_provider_name": "openai", "model_name": "gpt-4o-mini"}


def _dataset() -> Dataset:
    return Dataset(id="dataset-1", tenant_id="tenant-1", name="kb", created_by="u", graph_index_setting=_CONFIGURED)


def _chunk(node: str, document: str = "doc-1") -> Document:
    return Document(page_content=f"text {node}", metadata={"doc_id": node, "document_id": document})


@pytest.fixture
def session(sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch) -> Iterator[Session]:
    monkeypatch.setattr(module.session_factory, "create_session", sqlite_session_factory)
    with sqlite_session_factory() as session:
        yield session


def _install(monkeypatch: pytest.MonkeyPatch, outcome: ChunkExtractionBatch | Exception) -> None:
    class _Extractor:
        def __init__(self, **_kwargs: object) -> None:
            pass

        def extract_documents(self, _documents: list[Document]) -> ChunkExtractionBatch:
            if isinstance(outcome, Exception):
                raise outcome
            return outcome

    monkeypatch.setattr(module, "EntityRelationExtractor", _Extractor)


def _recorded(session: Session) -> dict[str, str]:
    session.expire_all()
    rows = session.scalars(select(DatasetGraphExtractionFailure)).all()
    return {row.index_node_id: row.error for row in rows}


def _failure(node: str, error: str = "503 overloaded", document: str = "doc-1") -> ChunkExtractionFailure:
    return ChunkExtractionFailure(index_node_id=node, document_id=document, error=error)


def test_failed_chunks_are_recorded_with_their_reason(session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    _install(monkeypatch, ChunkExtractionBatch(failures=[_failure("node-1")], succeeded=["node-2"]))

    GraphIndexService.build_for_documents(_dataset(), [_chunk("node-1"), _chunk("node-2")], session=session)

    assert _recorded(session) == {"node-1": "503 overloaded"}


def test_a_later_success_clears_the_record(session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    _install(monkeypatch, ChunkExtractionBatch(failures=[_failure("node-1")]))
    GraphIndexService.build_for_documents(_dataset(), [_chunk("node-1")], session=session)
    _install(monkeypatch, ChunkExtractionBatch(succeeded=["node-1"]))

    GraphIndexService.build_for_documents(_dataset(), [_chunk("node-1")], session=session)

    assert _recorded(session) == {}


def test_a_repeated_failure_keeps_one_row_with_the_newest_reason(
    session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    _install(monkeypatch, ChunkExtractionBatch(failures=[_failure("node-1", "location not supported")]))
    GraphIndexService.build_for_documents(_dataset(), [_chunk("node-1")], session=session)
    _install(monkeypatch, ChunkExtractionBatch(failures=[_failure("node-1", "503 overloaded")]))

    GraphIndexService.build_for_documents(_dataset(), [_chunk("node-1")], session=session)

    assert _recorded(session) == {"node-1": "503 overloaded"}


def test_a_whole_batch_failure_marks_every_citable_chunk(session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    _install(monkeypatch, RuntimeError("model not found"))
    orphan = Document(page_content="no provenance", metadata={})

    GraphIndexService.build_for_documents(_dataset(), [_chunk("node-1"), orphan], session=session)

    assert _recorded(session) == {"node-1": "model not found"}


def test_stats_report_failures_so_an_empty_graph_is_explained(
    session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    _install(monkeypatch, ChunkExtractionBatch(failures=[_failure("node-1"), _failure("node-2")]))
    GraphIndexService.build_for_documents(_dataset(), [_chunk("node-1"), _chunk("node-2")], session=session)

    stats = GraphIndexService.get_stats(_dataset(), session=session)

    assert stats.entity_count == 0
    assert stats.failed_chunk_count == 2
    assert stats.last_error == "503 overloaded"
    assert stats.last_failed_at is not None


def test_stats_without_failures_mean_a_genuinely_empty_graph(session: Session) -> None:
    stats = GraphIndexService.get_stats(_dataset(), session=session)

    assert (stats.failed_chunk_count, stats.last_error, stats.last_failed_at) == (0, None, None)


@pytest.mark.parametrize(
    "remove",
    [
        lambda dataset, session: GraphIndexService.delete_by_index_node_ids(dataset, ["node-1"], session=session),
        lambda dataset, session: GraphIndexService.delete_by_document_ids(dataset, ["doc-1"], session=session),
        lambda dataset, session: GraphIndexService.delete_all(dataset, session=session),
        lambda dataset, session: GraphIndexService.purge_dataset(dataset, session=session),
    ],
)
def test_removing_chunks_drops_their_failure_records(
    session: Session, monkeypatch: pytest.MonkeyPatch, remove: Callable[[Dataset, Session], None]
) -> None:
    # A deleted chunk can never be retried; its failure must not keep the
    # graph page in an error state.
    _install(monkeypatch, ChunkExtractionBatch(failures=[_failure("node-1")]))
    GraphIndexService.build_for_documents(_dataset(), [_chunk("node-1")], session=session)

    remove(_dataset(), session)
    session.commit()

    assert _recorded(session) == {}


def test_a_bookkeeping_error_never_reaches_indexing(session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    _install(monkeypatch, ChunkExtractionBatch(failures=[_failure("node-1")]))

    def _broken() -> Session:
        raise RuntimeError("database unavailable")

    monkeypatch.setattr(module.session_factory, "create_session", _broken)

    GraphIndexService.build_for_documents(_dataset(), [_chunk("node-1")], session=session)
