"""Verify keyword persistence across real SQLite transactions and indexing entry points."""

from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

import core.rag.datasource.keyword.jieba.jieba as jieba_module
from core.indexing_runner import IndexingRunner
from core.rag.datasource.keyword.keyword_factory import Keyword
from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from core.rag.index_processor.index_processor import IndexProcessor
from core.rag.index_processor.processor.parent_child_index_processor import ParentChildIndexProcessor
from core.rag.models.document import Document
from models.dataset import ChildChunk, Dataset, DatasetKeywordTable, DocumentSegment
from models.dataset import Document as DatasetDocument
from models.enums import SegmentStatus
from services.dataset_service import SegmentService
from services.entities.knowledge_entities.knowledge_entities import ChildChunkUpdateArgs
from services.errors.chunk import ChildChunkIndexingError
from tests.unit_tests.config_override import apply_config_overrides
from tests.unit_tests.model_factories import make_account, make_dataset, make_document, make_tenant


@pytest.fixture
def keyword_scope(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session) -> tuple[Dataset, DatasetDocument]:
    apply_config_overrides(monkeypatch, KEYWORD_STORE="jieba", KEYWORD_DATA_SOURCE_TYPE="database")
    dataset = make_dataset(
        indexing_technique=IndexTechniqueType.ECONOMY,
        chunk_structure=IndexStructureType.PARENT_CHILD_INDEX,
    )
    document = make_document(doc_form=IndexStructureType.PARENT_CHILD_INDEX)
    sqlite_session.add_all([dataset, document])
    sqlite_session.commit()

    # Only external dependencies are substituted; all keyword and child rows are real.
    handler = MagicMock()
    handler.extract_keywords.side_effect = lambda text, *_args: set(text.split())
    monkeypatch.setattr(jieba_module, "JiebaKeywordTableHandler", lambda: handler)
    account = make_account(tenant=make_tenant())
    monkeypatch.setattr("services.dataset_service.current_user", account)
    monkeypatch.setattr(
        "core.rag.index_processor.processor.parent_child_index_processor.AccountService.load_user",
        MagicMock(return_value=account),
    )
    monkeypatch.setattr(ParentChildIndexProcessor, "_get_content_files", MagicMock(return_value=[]))
    monkeypatch.setattr(
        "core.rag.index_processor.processor.parent_child_index_processor.calculate_segment_token_counts",
        MagicMock(side_effect=lambda **kwargs: [1] * len(kwargs["documents"])),
    )
    return dataset, document


def _parent(session: Session, dataset: Dataset, document: DatasetDocument, node_id: str) -> DocumentSegment:
    segment = DocumentSegment(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=document.id,
        position=1,
        content="parent",
        word_count=1,
        tokens=1,
        created_by=document.created_by,
        index_node_id=node_id,
        keywords=[],
        enabled=True,
        status=SegmentStatus.COMPLETED,
    )
    session.add(segment)
    session.flush()
    return segment


def _child(session: Session, parent: DocumentSegment, word: str) -> ChildChunk:
    child = ChildChunk(
        tenant_id=parent.tenant_id,
        dataset_id=parent.dataset_id,
        document_id=parent.document_id,
        segment_id=parent.id,
        position=1,
        content=word,
        word_count=len(word),
        created_by=parent.created_by,
        index_node_id=f"child-{word}",
    )
    session.add(child)
    session.flush()
    return child


def _hits(factory: sessionmaker[Session], dataset_id: str, query: str) -> list[str]:
    with factory() as session:
        dataset = session.get(Dataset, dataset_id)
        assert dataset is not None
        return [hit.page_content for hit in Keyword(dataset).search(query, session=session, top_k=10)]


@pytest.mark.parametrize("technique", [IndexTechniqueType.ECONOMY, IndexTechniqueType.HIGH_QUALITY])
def test_pipeline_indexes_child_keywords_and_commits(
    technique: IndexTechniqueType,
    keyword_scope: tuple[Dataset, DatasetDocument],
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    dataset, document = keyword_scope
    dataset.indexing_technique = technique
    chunks = {
        "parent_child_chunks": [
            {"parent_content": "first parent", "child_contents": ["alpha", "beta"]},
            {"parent_content": "second parent", "child_contents": ["gamma"]},
        ]
    }
    with patch("core.rag.index_processor.processor.parent_child_index_processor.Vector") as vector:
        result = IndexProcessor().index_and_clean(dataset.id, document.id, "", chunks, "batch", session=sqlite_session)
        sqlite_session.commit()

    assert result["display_status"] == "completed"
    for word in ("alpha", "beta", "gamma"):
        assert _hits(sqlite_session_factory, dataset.id, word) == [word]
    with sqlite_session_factory() as read_session:
        children = read_session.scalars(select(ChildChunk)).all()
        assert len(children) == 3
        parents = read_session.scalars(select(DocumentSegment)).all()
        assert len(parents) == 2
        assert all(parent.status == SegmentStatus.COMPLETED and parent.enabled for parent in parents)
    if technique == IndexTechniqueType.ECONOMY:
        vector.assert_not_called()
    else:
        vector.return_value.create.assert_called_once()
        assert len(vector.return_value.create.call_args.args[0]) == 3


def test_pipeline_economy_reindex_removes_old_rows_and_keywords(
    keyword_scope: tuple[Dataset, DatasetDocument],
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    dataset, document = keyword_scope
    processor = IndexProcessor()
    for original_document_id, word in (("", "oldword"), (document.id, "newword")):
        processor.index_and_clean(
            dataset.id,
            document.id,
            original_document_id,
            {"parent_child_chunks": [{"parent_content": "parent", "child_contents": [word]}]},
            "batch",
            session=sqlite_session,
        )
        sqlite_session.commit()
        assert _hits(sqlite_session_factory, dataset.id, word) == [word]

    assert _hits(sqlite_session_factory, dataset.id, "oldword") == []
    with sqlite_session_factory() as read_session:
        children = read_session.scalars(select(ChildChunk)).all()
        parents = read_session.scalars(select(DocumentSegment)).all()
        assert len(children) == len(parents) == 1
        assert children[0].content == "newword"
        assert children[0].segment_id == parents[0].id


@pytest.mark.parametrize("technique", [IndexTechniqueType.ECONOMY, IndexTechniqueType.HIGH_QUALITY])
@pytest.mark.parametrize("dataset_wide", [False, True])
@pytest.mark.parametrize("delete_rows", [False, True])
def test_cleanup_respects_scope_and_row_deletion_for_both_techniques(
    technique: IndexTechniqueType,
    dataset_wide: bool,
    delete_rows: bool,
    keyword_scope: tuple[Dataset, DatasetDocument],
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    dataset, document = keyword_scope
    dataset.indexing_technique = technique
    parent = _parent(sqlite_session, dataset, document, "parent-target")
    sibling = _parent(sqlite_session, dataset, document, "parent-sibling")
    target = _child(sqlite_session, parent, "target")
    keep = _child(sqlite_session, sibling, "keep")
    other_dataset = make_dataset(dataset_id="other-dataset", tenant_id="other-tenant")
    other_document = make_document(
        document_id="other-document", dataset_id=other_dataset.id, tenant_id=other_dataset.tenant_id
    )
    sqlite_session.add_all([other_dataset, other_document])
    outsider = _child(sqlite_session, _parent(sqlite_session, other_dataset, other_document, "other-parent"), "outside")
    Keyword(dataset).add_texts(
        [Document(page_content=child.content, metadata={"doc_id": child.index_node_id}) for child in (target, keep)],
        sqlite_session,
        update_segment_keywords=False,
    )
    sqlite_session.commit()

    assert parent.index_node_id is not None
    with patch("core.rag.index_processor.processor.parent_child_index_processor.Vector") as vector:
        ParentChildIndexProcessor().clean(
            dataset,
            None if dataset_wide else [parent.index_node_id],
            delete_child_chunks=delete_rows,
            session=sqlite_session,
        )
        sqlite_session.commit()

    if technique == IndexTechniqueType.ECONOMY:
        vector.assert_not_called()
    elif dataset_wide:
        vector.return_value.delete.assert_called_once()
    else:
        vector.return_value.delete_by_ids.assert_called_once_with([target.index_node_id])
    with sqlite_session_factory() as read_session:
        assert (read_session.get(ChildChunk, target.id) is None) == delete_rows
        assert (read_session.get(ChildChunk, keep.id) is None) == (delete_rows and dataset_wide)
        assert read_session.get(ChildChunk, outsider.id) is not None
    assert _hits(sqlite_session_factory, dataset.id, "target") == []
    assert _hits(sqlite_session_factory, dataset.id, "keep") == ([] if dataset_wide else ["keep"])


@pytest.mark.parametrize("precomputed", [[], ["child-target"]])
def test_economy_cleanup_honors_precomputed_ids_after_parent_deletion(
    precomputed: list[str],
    keyword_scope: tuple[Dataset, DatasetDocument],
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    dataset, document = keyword_scope
    parent = _parent(sqlite_session, dataset, document, "parent-target")
    child = _child(sqlite_session, parent, "target")
    sqlite_session.commit()
    sqlite_session.delete(parent)
    sqlite_session.commit()
    ParentChildIndexProcessor().clean(
        dataset,
        ["parent-target"],
        delete_child_chunks=True,
        precomputed_child_node_ids=precomputed,
        session=sqlite_session,
    )
    sqlite_session.commit()
    with sqlite_session_factory() as read_session:
        assert (read_session.get(ChildChunk, child.id) is None) == bool(precomputed)


@pytest.mark.parametrize("technique", [IndexTechniqueType.ECONOMY, IndexTechniqueType.HIGH_QUALITY])
def test_child_crud_keywords_are_visible_from_fresh_sessions(
    technique: IndexTechniqueType,
    keyword_scope: tuple[Dataset, DatasetDocument],
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    dataset, document = keyword_scope
    dataset.indexing_technique = technique
    parent = _parent(sqlite_session, dataset, document, "parent-node")
    sqlite_session.commit()
    with patch("services.vector_service.Vector"):
        first = SegmentService.create_child_chunk("alpha", parent, document, dataset, sqlite_session)
        second = SegmentService.create_child_chunk("beta", parent, document, dataset, sqlite_session)
        assert _hits(sqlite_session_factory, dataset.id, "alpha") == ["alpha"]
        assert _hits(sqlite_session_factory, dataset.id, "beta") == ["beta"]

        SegmentService.update_child_chunk("gamma", first, parent, document, dataset, sqlite_session)
        assert _hits(sqlite_session_factory, dataset.id, "alpha") == []
        assert _hits(sqlite_session_factory, dataset.id, "gamma") == ["gamma"]

        updated = SegmentService.update_child_chunks(
            [ChildChunkUpdateArgs(id=first.id, content="delta"), ChildChunkUpdateArgs(content="epsilon")],
            parent,
            document,
            dataset,
            sqlite_session,
        )
        assert _hits(sqlite_session_factory, dataset.id, "beta") == []
        assert _hits(sqlite_session_factory, dataset.id, "gamma") == []
        assert _hits(sqlite_session_factory, dataset.id, "delta") == ["delta"]
        assert _hits(sqlite_session_factory, dataset.id, "epsilon") == ["epsilon"]
        with sqlite_session_factory() as read_session:
            assert read_session.get(ChildChunk, second.id) is None

        for child in updated:
            SegmentService.delete_child_chunk(child, dataset, sqlite_session)
        assert _hits(sqlite_session_factory, dataset.id, "delta") == []
        assert _hits(sqlite_session_factory, dataset.id, "epsilon") == []


def test_child_update_rolls_back_keyword_removal_on_keyword_failure(
    keyword_scope: tuple[Dataset, DatasetDocument],
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    dataset, document = keyword_scope
    parent = _parent(sqlite_session, dataset, document, "parent-node")
    child = SegmentService.create_child_chunk("oldword", parent, document, dataset, sqlite_session)
    with (
        patch.object(Keyword, "add_texts", side_effect=RuntimeError("keyword unavailable")),
        pytest.raises(ChildChunkIndexingError, match="keyword unavailable"),
    ):
        SegmentService.update_child_chunk("newword", child, parent, document, dataset, sqlite_session)

    assert _hits(sqlite_session_factory, dataset.id, "oldword") == ["oldword"]
    assert _hits(sqlite_session_factory, dataset.id, "newword") == []
    with sqlite_session_factory() as read_session:
        stored = read_session.get(ChildChunk, child.id)
        assert stored is not None
        assert stored.content == "oldword"


@pytest.mark.parametrize("parent_child", [False, True])
def test_initial_keyword_worker_commits_index_and_parent_completion(
    parent_child: bool,
    app: Flask,
    keyword_scope: tuple[Dataset, DatasetDocument],
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    dataset, document = keyword_scope
    parent = _parent(sqlite_session, dataset, document, "parent-node")
    parent.status = SegmentStatus.INDEXING
    if parent_child:
        child = _child(sqlite_session, parent, "childword")
        content, node_id = child.content, child.index_node_id
    else:
        document.doc_form = IndexStructureType.PARAGRAPH_INDEX
        content, node_id = parent.content, parent.index_node_id
    sqlite_session.commit()

    assert parent.index_node_id is not None
    IndexingRunner._process_keyword_index(
        app,
        dataset.id,
        document.id,
        [Document(page_content=content, metadata={"doc_id": node_id})],
        [parent.index_node_id],
        update_segment_keywords=not parent_child,
    )

    assert _hits(sqlite_session_factory, dataset.id, content) == [content]
    with sqlite_session_factory() as read_session:
        stored_parent = read_session.get(DocumentSegment, parent.id)
        assert stored_parent is not None
        assert stored_parent.status == SegmentStatus.COMPLETED
        assert stored_parent.keywords == ([] if parent_child else ["parent"])
        assert (
            read_session.scalar(select(DatasetKeywordTable).where(DatasetKeywordTable.dataset_id == dataset.id))
            is not None
        )
