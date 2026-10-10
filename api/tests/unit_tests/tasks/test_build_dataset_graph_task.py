"""The graph backfill extracts exactly the chunks retrieval can return."""

import pytest
from sqlalchemy import event
from sqlalchemy.orm import Session, sessionmaker

from core.rag.models.document import Document as IndexDocument
from models.dataset import Dataset, DatasetGraphExtractionFailure, DocumentSegment
from models.enums import IndexingStatus, SegmentStatus
from tasks import build_dataset_graph_task as module
from tests.unit_tests.repositories.knowledge.test_document_repository import _dataset, _document

_ENABLED = {"enabled": True, "model_provider_name": "provider", "model_name": "model"}


def _segment(
    segment_id: str,
    document_id: str,
    *,
    dataset_id: str = "dataset-1",
    status: SegmentStatus = SegmentStatus.COMPLETED,
    enabled: bool = True,
    indexed: bool = True,
) -> DocumentSegment:
    segment = DocumentSegment(
        tenant_id="workspace-1",
        dataset_id=dataset_id,
        document_id=document_id,
        position=1,
        content=f"text {segment_id}",
        word_count=2,
        tokens=2,
        created_by="account-1",
        status=status,
        enabled=enabled,
        index_node_id=f"node-{segment_id}" if indexed else None,
    )
    segment.id = segment_id
    return segment


def _graph_dataset(dataset_id: str = "dataset-1", setting: dict[str, object] | None = None) -> Dataset:
    dataset = _dataset(dataset_id, "workspace-1")
    dataset.graph_index_setting = _ENABLED if setting is None else setting
    return dataset


@pytest.fixture
def extracted(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> list[list[tuple[str, str, str]]]:
    monkeypatch.setattr(module.session_factory, "create_session", sqlite_session_factory)
    monkeypatch.setattr(module, "mark_graph_build_active", lambda _dataset_id: None)
    monkeypatch.setattr(module, "clear_graph_build", lambda _dataset_id: None)
    calls: list[list[tuple[str, str, str]]] = []

    def build(dataset: Dataset, documents: list[IndexDocument], *, session: Session) -> None:
        assert dataset.id == "dataset-1"
        # Extraction calls the model; no transaction may be held across it.
        assert not session.in_transaction()
        calls.append(
            [
                (document.metadata["doc_id"], document.metadata["document_id"], document.metadata["dataset_id"])
                for document in documents
            ]
        )

    monkeypatch.setattr(module.GraphIndexService, "build_for_documents", build)
    return calls


def test_backfill_covers_only_searchable_chunks(
    sqlite_session_factory: sessionmaker[Session], extracted: list[list[tuple[str, str, str]]]
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                _graph_dataset(),
                _graph_dataset("dataset-2"),
                _document("live"),
                _document("archived", archived=True),
                _document("failed", status=IndexingStatus.ERROR),
                _document("other", dataset_id="dataset-2"),
                _segment("s1", "live"),
                _segment("s2", "live", enabled=False),
                _segment("s3", "live", status=SegmentStatus.INDEXING),
                _segment("s4", "live", indexed=False),
                _segment("s5", "archived"),
                _segment("s6", "failed"),
                _segment("s7", "other", dataset_id="dataset-2"),
            ]
        )

    module.build_dataset_graph_task("dataset-1", "workspace-1", only_failed=False)

    assert extracted == [[("node-s1", "live", "dataset-1")]]


def test_backfill_pages_through_every_chunk_once(
    sqlite_session_factory: sessionmaker[Session],
    extracted: list[list[tuple[str, str, str]]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(module, "_BATCH_SIZE", 2)
    with sqlite_session_factory.begin() as session:
        session.add_all([_graph_dataset(), _document("live"), *(_segment(f"s{i}", "live") for i in range(5))])

    module.build_dataset_graph_task("dataset-1", "workspace-1", only_failed=False)

    assert [len(batch) for batch in extracted] == [2, 2, 1]
    assert [node for batch in extracted for node, _, _ in batch] == [f"node-s{i}" for i in range(5)]


def test_first_page_has_no_cursor_filter(
    sqlite_session_factory: sessionmaker[Session],
    extracted: list[list[tuple[str, str, str]]],
) -> None:
    # Segment ids are UUIDs on PostgreSQL, where `id > ''` is a type error;
    # SQLite accepts it, so pin the query shape instead of the outcome.
    with sqlite_session_factory.begin() as session:
        session.add_all([_graph_dataset(), _document("live"), _segment("s1", "live")])
    statements: list[str] = []
    engine = sqlite_session_factory.kw["bind"]

    def record(_conn: object, _cursor: object, statement: str, *_args: object) -> None:
        if "FROM document_segments" in statement:
            statements.append(statement)

    event.listen(engine, "before_cursor_execute", record)
    try:
        module.build_dataset_graph_task("dataset-1", "workspace-1", only_failed=False)
    finally:
        event.remove(engine, "before_cursor_execute", record)

    assert extracted == [[("node-s1", "live", "dataset-1")]]
    assert "document_segments.id >" not in statements[0]
    assert "document_segments.id >" in statements[1]


def test_turning_the_graph_off_stops_further_model_calls(
    sqlite_session_factory: sessionmaker[Session],
    extracted: list[list[tuple[str, str, str]]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(module, "_BATCH_SIZE", 1)
    with sqlite_session_factory.begin() as session:
        session.add_all([_graph_dataset(), _document("live"), _segment("s1", "live"), _segment("s2", "live")])
    record = module.GraphIndexService.build_for_documents

    def build_then_disable(dataset: Dataset, documents: list[IndexDocument], *, session: Session) -> None:
        record(dataset, documents, session=session)
        with sqlite_session_factory.begin() as writer:
            stored = writer.get(Dataset, "dataset-1")
            assert stored is not None
            stored.graph_index_setting = {**_ENABLED, "enabled": False}

    monkeypatch.setattr(module.GraphIndexService, "build_for_documents", build_then_disable)

    module.build_dataset_graph_task("dataset-1", "workspace-1", only_failed=False)

    assert len(extracted) == 1


@pytest.mark.parametrize(
    ("dataset_id", "tenant_id", "setting"),
    [
        ("dataset-1", "workspace-1", {"enabled": False}),
        # The tenant is part of the owner chain; a foreign one finds nothing.
        ("dataset-1", "workspace-2", None),
        ("missing", "workspace-1", None),
    ],
)
def test_backfill_is_a_no_op_without_an_enabled_owned_dataset(
    sqlite_session_factory: sessionmaker[Session],
    extracted: list[list[tuple[str, str, str]]],
    dataset_id: str,
    tenant_id: str,
    setting: dict[str, object] | None,
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add_all([_graph_dataset(setting=setting), _document("live"), _segment("s1", "live")])

    module.build_dataset_graph_task(dataset_id, tenant_id, only_failed=False)

    assert extracted == []


def test_retry_extracts_only_the_failed_chunks(
    sqlite_session_factory: sessionmaker[Session], extracted: list[list[tuple[str, str, str]]]
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add_all([_graph_dataset(), _document("live"), _segment("s1", "live"), _segment("s2", "live")])
        session.add(
            DatasetGraphExtractionFailure(
                tenant_id="workspace-1",
                dataset_id="dataset-1",
                document_id="live",
                index_node_id="node-s2",
                error="503",
            )
        )

    module.build_dataset_graph_task("dataset-1", "workspace-1", only_failed=True)

    assert extracted == [[("node-s2", "live", "dataset-1")]]


def test_the_building_marker_is_cleared_even_when_the_build_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    cleared: list[str] = []
    monkeypatch.setattr(module, "clear_graph_build", cleared.append)

    def _explode(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("database unavailable")

    monkeypatch.setattr(module, "_build", _explode)

    with pytest.raises(RuntimeError):
        module.build_dataset_graph_task("dataset-1", "workspace-1", only_failed=False)

    # Otherwise the graph page would show "building" until the marker expires.
    assert cleared == ["dataset-1"]
