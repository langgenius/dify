"""SQLite-backed tests for segment and child-chunk dataset services."""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy.orm import Session

from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from models import Account
from models.account import Tenant
from models.dataset import (
    ChildChunk,
    Dataset,
    Document,
    DocumentSegment,
)
from models.enums import DataSourceType, DocumentCreatedFrom, SegmentStatus
from services.dataset_ref_service import DatasetRefService
from services.dataset_service import SegmentService
from services.knowledge.resource_scope import DatasetRef, DocumentRef, SegmentRef


def _account(*, account_id: str = "user-1", tenant_id: str = "tenant-1") -> Account:
    account = Account(name="User", email=f"{account_id}@example.com")
    account.id = account_id
    tenant = Tenant(name="Tenant")
    tenant.id = tenant_id
    account._current_tenant = tenant
    return account


def _dataset(*, dataset_id: str = "dataset-1", tenant_id: str = "tenant-1") -> Dataset:
    return Dataset(
        id=dataset_id,
        tenant_id=tenant_id,
        name="Dataset",
        description="",
        provider="vendor",
        created_by="user-1",
        maintainer="user-1",
        indexing_technique=IndexTechniqueType.HIGH_QUALITY,
        embedding_model_provider="provider",
        embedding_model="embedding-model",
        chunk_structure=IndexStructureType.PARAGRAPH_INDEX,
    )


def _document(
    *,
    document_id: str = "document-1",
    dataset_id: str = "dataset-1",
    tenant_id: str = "tenant-1",
    doc_form: str = IndexStructureType.PARAGRAPH_INDEX,
    word_count: int = 20,
) -> Document:
    return Document(
        id=document_id,
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        batch="batch-1",
        name="Document",
        created_from=DocumentCreatedFrom.API,
        created_by="user-1",
        created_at=datetime(2026, 1, 1),
        updated_at=datetime(2026, 1, 2),
        indexing_status="completed",
        doc_form=doc_form,
        word_count=word_count,
    )


def _segment(
    *,
    segment_id: str = "segment-1",
    dataset_id: str = "dataset-1",
    document_id: str = "document-1",
    tenant_id: str = "tenant-1",
    position: int = 1,
    content: str = "segment content",
    enabled: bool = True,
) -> DocumentSegment:
    segment = DocumentSegment(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        document_id=document_id,
        position=position,
        content=content,
        word_count=len(content),
        tokens=0,
        created_by="user-1",
        enabled=enabled,
        keywords=[],
        answer=None,
        index_node_id=f"node-{segment_id}",
        status=SegmentStatus.COMPLETED,
    )
    segment.id = segment_id
    return segment


def _child(
    *,
    child_id: str = "child-1",
    segment_id: str = "segment-1",
    dataset_id: str = "dataset-1",
    document_id: str = "document-1",
    tenant_id: str = "tenant-1",
    position: int = 1,
    content: str = "child content",
) -> ChildChunk:
    child = ChildChunk(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        document_id=document_id,
        segment_id=segment_id,
        position=position,
        index_node_id=f"node-{child_id}",
        index_node_hash=f"hash-{child_id}",
        content=content,
        word_count=len(content),
        created_by="user-1",
    )
    child.id = child_id
    return child


def _persist_chain(session: Session) -> tuple[Dataset, Document, DocumentSegment]:
    dataset = _dataset()
    document = _document()
    segment = _segment()
    session.add_all([dataset, document, segment])
    session.commit()
    return dataset, document, segment


class TestDatasetRefService:
    def test_dataset_ref_is_plain_named_tuple(self) -> None:
        assert DatasetRef("tenant-1", "dataset-1") == ("tenant-1", "dataset-1")

    @pytest.mark.parametrize(
        ("document_dataset_id", "document_tenant_id"),
        [("dataset-2", "tenant-1"), ("dataset-1", "tenant-2")],
    )
    def test_create_document_ref_rejects_document_outside_dataset(
        self, document_dataset_id: str, document_tenant_id: str
    ) -> None:
        dataset_ref = DatasetRef("tenant-1", "dataset-1")
        document = _document(dataset_id=document_dataset_id, tenant_id=document_tenant_id)

        assert DatasetRefService.create_document_ref(dataset_ref, document) is None

    def test_create_segment_ref_carries_full_parent_chain(self) -> None:
        document_ref = DocumentRef(DatasetRef("tenant-1", "dataset-1"), "document-1")

        assert DatasetRefService.create_segment_ref(document_ref, "segment-1") == SegmentRef(document_ref, "segment-1")


class TestSegmentServiceQueries:
    def test_get_child_chunks_filters_owner_keyword_and_paginates(self, sqlite_session: Session) -> None:
        _persist_chain(sqlite_session)
        sqlite_session.add_all(
            [
                _child(child_id="child-1", position=1, content="alpha match"),
                _child(child_id="child-2", position=2, content="beta"),
                _child(child_id="child-3", position=3, content="alpha second"),
                _child(child_id="foreign", tenant_id="tenant-2", position=4, content="alpha foreign"),
            ]
        )
        sqlite_session.commit()

        with patch("services.dataset_service.current_user", _account()):
            page = SegmentService.get_child_chunks(
                "segment-1",
                "document-1",
                "dataset-1",
                page=1,
                limit=1,
                keyword="alpha",
                session=sqlite_session,
            )

        assert page.total == 2
        assert [child.id for child in page.items] == ["child-1"]

    def test_get_child_chunk_by_id_scopes_tenant(self, sqlite_session: Session) -> None:
        owned = _child()
        sqlite_session.add(owned)
        sqlite_session.commit()

        assert SegmentService.get_child_chunk_by_id(owned.id, "tenant-1", sqlite_session) is owned
        assert SegmentService.get_child_chunk_by_id(owned.id, "tenant-2", sqlite_session) is None

    def test_get_child_chunk_by_segment_ref_enforces_full_chain(self, sqlite_session: Session) -> None:
        child = _child()
        sqlite_session.add(child)
        sqlite_session.commit()
        valid_ref = SegmentRef(DocumentRef(DatasetRef("tenant-1", "dataset-1"), "document-1"), "segment-1")

        assert SegmentService.get_child_chunk_by_segment_ref(child.id, valid_ref, sqlite_session) is child
        spoofed_refs = [
            SegmentRef(DocumentRef(DatasetRef("tenant-2", "dataset-1"), "document-1"), "segment-1"),
            SegmentRef(DocumentRef(DatasetRef("tenant-1", "dataset-2"), "document-1"), "segment-1"),
            SegmentRef(DocumentRef(DatasetRef("tenant-1", "dataset-1"), "document-2"), "segment-1"),
            SegmentRef(DocumentRef(DatasetRef("tenant-1", "dataset-1"), "document-1"), "segment-2"),
        ]
        for spoofed_ref in spoofed_refs:
            assert SegmentService.get_child_chunk_by_segment_ref(child.id, spoofed_ref, sqlite_session) is None

    def test_get_segments_filters_status_keyword_and_orders(self, sqlite_session: Session) -> None:
        sqlite_session.add_all(
            [
                _segment(segment_id="one", position=2, content="alpha later"),
                _segment(segment_id="two", position=1, content="alpha first"),
                _segment(segment_id="three", position=3, content="beta"),
                _segment(segment_id="foreign", tenant_id="tenant-2", position=1, content="alpha foreign"),
            ]
        )
        sqlite_session.commit()

        segments, total = SegmentService.get_segments(
            "document-1",
            "tenant-1",
            status_list=[SegmentStatus.COMPLETED],
            keyword="alpha",
            session=sqlite_session,
        )

        assert total == 2
        assert [segment.id for segment in segments] == ["two", "one"]

    def test_get_segment_by_id_and_ref_scope_complete_owner(self, sqlite_session: Session) -> None:
        segment = _segment()
        sqlite_session.add(segment)
        sqlite_session.commit()
        valid_ref = SegmentRef(DocumentRef(DatasetRef("tenant-1", "dataset-1"), "document-1"), segment.id)

        assert SegmentService.get_segment_by_id(segment.id, "tenant-1", sqlite_session) is segment
        assert SegmentService.get_segment_by_id(segment.id, "tenant-2", sqlite_session) is None
        assert SegmentService.get_segment_by_ref(valid_ref, sqlite_session) is segment
        spoofed_refs = [
            SegmentRef(DocumentRef(DatasetRef("tenant-2", "dataset-1"), "document-1"), segment.id),
            SegmentRef(DocumentRef(DatasetRef("tenant-1", "dataset-2"), "document-1"), segment.id),
            SegmentRef(DocumentRef(DatasetRef("tenant-1", "dataset-1"), "document-2"), segment.id),
        ]
        for spoofed_ref in spoofed_refs:
            assert SegmentService.get_segment_by_ref(spoofed_ref, sqlite_session) is None

    def test_get_segments_by_document_and_dataset_returns_real_rows(self, sqlite_session: Session) -> None:
        sqlite_session.add_all(
            [
                _segment(segment_id="enabled"),
                _segment(segment_id="disabled", position=2, enabled=False),
                _segment(segment_id="other", document_id="document-2", position=1),
            ]
        )
        sqlite_session.commit()

        segments = SegmentService.get_segments_by_document_and_dataset(
            "document-1",
            "dataset-1",
            sqlite_session,
            status=SegmentStatus.COMPLETED,
            enabled=True,
        )

        assert [segment.id for segment in segments] == ["enabled"]


class TestSegmentServiceValidation:
    def test_qa_segment_requires_answer(self) -> None:
        with pytest.raises(ValueError, match="Answer is required"):
            SegmentService.segment_create_args_validate(
                {"content": "question"}, _document(doc_form=IndexStructureType.QA_INDEX)
            )

    @pytest.mark.parametrize("content", [None, "", "   "])
    def test_segment_requires_non_empty_content(self, content: str | None) -> None:
        with pytest.raises(ValueError, match="Content is empty"):
            SegmentService.segment_create_args_validate({"content": content}, _document())

    def test_segment_attachment_ids_must_be_a_list(self) -> None:
        with pytest.raises(ValueError, match="Attachment IDs is invalid"):
            SegmentService.segment_create_args_validate({"content": "text", "attachment_ids": "file"}, _document())

    def test_segment_attachment_limit_is_enforced(self, config_overrides: Callable[..., None]) -> None:
        config_overrides(SINGLE_CHUNK_ATTACHMENT_LIMIT=1)

        with pytest.raises(ValueError, match="Exceeded maximum attachment limit"):
            SegmentService.segment_create_args_validate(
                {"content": "text", "attachment_ids": ["one", "two"]},
                _document(),
            )

    def test_segment_attachment_limit_accepts_exact_boundary(self, config_overrides: Callable[..., None]) -> None:
        config_overrides(SINGLE_CHUNK_ATTACHMENT_LIMIT=2)

        SegmentService.segment_create_args_validate(
            {"content": "text", "attachment_ids": ["one", "two"]},
            _document(),
        )


class TestSegmentServiceMutations:
    def test_multi_create_segment_marks_each_real_row_error_on_vector_failure(self, sqlite_session: Session) -> None:
        dataset = _dataset()
        document = _document(word_count=0)
        sqlite_session.add_all([dataset, document])
        sqlite_session.commit()
        embedding_model = SimpleNamespace(get_text_embedding_num_tokens=lambda *, texts: [len(texts) + 1])

        with (
            patch("services.dataset_service.current_user", _account()),
            patch("services.dataset_service.ModelManager") as manager_cls,
            patch(
                "services.dataset_service.VectorService.create_segments_vector",
                side_effect=RuntimeError("vector failed"),
            ),
        ):
            manager_cls.for_tenant.return_value.get_model_instance.return_value = embedding_model
            segments = SegmentService.multi_create_segment(
                [{"content": "one"}, {"content": "two"}],
                document,
                dataset,
                sqlite_session,
            )

        assert segments is not None
        assert len(segments) == 2
        assert all(segment.status == SegmentStatus.ERROR and not segment.enabled for segment in segments)
        assert document.word_count == 6

    def test_multi_create_segment_persists_qa_counts_positions_and_tokens(self, sqlite_session: Session) -> None:
        dataset = _dataset()
        document = _document(doc_form=IndexStructureType.QA_INDEX, word_count=5)
        sqlite_session.add_all([dataset, document, _segment(segment_id="existing")])
        sqlite_session.commit()
        embedding_model = MagicMock()
        embedding_model.get_text_embedding_num_tokens.side_effect = [[11], [13]]

        with (
            patch("services.dataset_service.current_user", _account()),
            patch("services.dataset_service.ModelManager") as manager_cls,
            patch("services.dataset_service.VectorService.create_segments_vector") as vector_create,
        ):
            manager_cls.for_tenant.return_value.get_model_instance.return_value = embedding_model
            segments = SegmentService.multi_create_segment(
                [
                    {"content": "question-1", "answer": "answer-1", "keywords": ["key"]},
                    {"content": "question-2", "answer": "answer-2"},
                ],
                document,
                dataset,
                sqlite_session,
            )

        assert segments is not None
        assert [segment.position for segment in segments] == [2, 3]
        assert [segment.tokens for segment in segments] == [11, 13]
        assert [segment.answer for segment in segments] == ["answer-1", "answer-2"]
        expected_increment = sum(len(segment.content) + len(segment.answer or "") for segment in segments)
        assert document.word_count == 5 + expected_increment
        assert embedding_model.get_text_embedding_num_tokens.call_args_list[0].kwargs == {
            "texts": ["question-1answer-1"]
        }
        assert embedding_model.get_text_embedding_num_tokens.call_args_list[1].kwargs == {
            "texts": ["question-2answer-2"]
        }
        assert vector_create.call_args.args[:2] == ([["key"], None], segments)
