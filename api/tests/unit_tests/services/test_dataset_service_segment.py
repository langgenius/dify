"""SQLite-backed tests for segment and child-chunk dataset services."""

from __future__ import annotations

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from sqlalchemy import event, select
from sqlalchemy.orm import Session

from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from models import Account
from models.account import Tenant
from models.dataset import ChildChunk, Dataset, Document, DocumentSegment
from models.enums import DataSourceType, DocumentCreatedFrom, SegmentStatus
from services.dataset_ref_service import DatasetRef, DatasetRefService, DocumentRef, SegmentRef
from services.dataset_service import SegmentService
from services.entities.knowledge_entities.knowledge_entities import ChildChunkUpdateArgs, SegmentUpdateArgs
from services.errors.chunk import ChildChunkDeleteIndexError, ChildChunkIndexingError


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

    def test_get_document_by_ref_enforces_full_owner_chain(self, sqlite_session: Session) -> None:
        owned = _document()
        decoy = _document(document_id="document-2", dataset_id="dataset-2", tenant_id="tenant-2")
        sqlite_session.add_all([owned, decoy])
        sqlite_session.commit()

        owned_ref = DocumentRef(DatasetRef("tenant-1", "dataset-1"), owned.id)
        spoofed_ref = DocumentRef(DatasetRef("tenant-1", "dataset-1"), decoy.id)
        assert DatasetRefService.get_document_by_ref(owned_ref, session=sqlite_session) is owned
        assert DatasetRefService.get_document_by_ref(spoofed_ref, session=sqlite_session) is None


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
        spoofed_ref = SegmentRef(DocumentRef(DatasetRef("tenant-1", "dataset-2"), "document-1"), "segment-1")

        assert SegmentService.get_child_chunk_by_segment_ref(child.id, valid_ref, sqlite_session) is child
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
        spoofed_ref = SegmentRef(DocumentRef(DatasetRef("tenant-1", "dataset-2"), "document-1"), segment.id)

        assert SegmentService.get_segment_by_id(segment.id, "tenant-1", sqlite_session) is segment
        assert SegmentService.get_segment_by_id(segment.id, "tenant-2", sqlite_session) is None
        assert SegmentService.get_segment_by_ref(valid_ref, sqlite_session) is segment
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

    def test_segment_attachment_limit_is_enforced(self) -> None:
        with (
            patch("services.dataset_service.dify_config.SINGLE_CHUNK_ATTACHMENT_LIMIT", 1),
            pytest.raises(ValueError, match="Exceeded maximum attachment limit"),
        ):
            SegmentService.segment_create_args_validate(
                {"content": "text", "attachment_ids": ["one", "two"]},
                _document(),
            )


class TestSegmentServiceChildChunks:
    def test_create_child_chunk_assigns_next_position_and_commits(self, sqlite_session: Session) -> None:
        dataset, document, segment = _persist_chain(sqlite_session)
        sqlite_session.add(_child(position=1))
        sqlite_session.commit()

        with (
            patch("services.dataset_service.current_user", _account()),
            patch("services.dataset_service.VectorService.create_child_chunk_vector"),
        ):
            child = SegmentService.create_child_chunk("new child", segment, document, dataset, sqlite_session)

        assert child.position == 2
        assert sqlite_session.get(ChildChunk, child.id) is child

    def test_create_child_chunk_rolls_back_on_vector_failure(self, sqlite_session: Session) -> None:
        dataset, document, segment = _persist_chain(sqlite_session)
        rollback_events: list[str] = []
        event.listen(sqlite_session, "after_rollback", lambda _session: rollback_events.append("rollback"))

        with (
            patch("services.dataset_service.current_user", _account()),
            patch(
                "services.dataset_service.VectorService.create_child_chunk_vector",
                side_effect=RuntimeError("vector failed"),
            ),
            pytest.raises(ChildChunkIndexingError, match="vector failed"),
        ):
            SegmentService.create_child_chunk("new child", segment, document, dataset, sqlite_session)

        assert rollback_events == ["rollback"]
        assert sqlite_session.scalars(select(ChildChunk)).all() == []

    def test_update_child_chunks_updates_deletes_and_creates_real_rows(self, sqlite_session: Session) -> None:
        dataset, document, segment = _persist_chain(sqlite_session)
        keep = _child(child_id="keep", content="old", position=1)
        remove = _child(child_id="remove", content="remove", position=2)
        sqlite_session.add_all([keep, remove])
        sqlite_session.commit()

        with (
            patch("services.dataset_service.current_user", _account()),
            patch("services.dataset_service.VectorService.update_child_chunk_vector"),
        ):
            chunks = SegmentService.update_child_chunks(
                [
                    ChildChunkUpdateArgs(id=keep.id, content="updated"),
                    ChildChunkUpdateArgs(content="created"),
                ],
                segment,
                document,
                dataset,
                sqlite_session,
            )

        persisted = sqlite_session.scalars(select(ChildChunk).order_by(ChildChunk.position)).all()
        assert {chunk.content for chunk in persisted} == {"updated", "created"}
        assert sqlite_session.get(ChildChunk, remove.id) is None
        assert {chunk.content for chunk in chunks} == {"updated", "created"}

    def test_update_child_chunk_rolls_back_on_vector_failure(self, sqlite_session: Session) -> None:
        dataset, document, segment = _persist_chain(sqlite_session)
        child = _child()
        sqlite_session.add(child)
        sqlite_session.commit()

        with (
            patch("services.dataset_service.current_user", _account()),
            patch(
                "services.dataset_service.VectorService.update_child_chunk_vector",
                side_effect=RuntimeError("vector failed"),
            ),
            pytest.raises(ChildChunkIndexingError, match="vector failed"),
        ):
            SegmentService.update_child_chunk("changed", child, segment, document, dataset, sqlite_session)

        sqlite_session.refresh(child)
        assert child.content == "child content"

    def test_update_child_chunks_rolls_back_all_database_changes_on_vector_failure(
        self, sqlite_session: Session
    ) -> None:
        dataset, document, segment = _persist_chain(sqlite_session)
        child = _child(content="original")
        sqlite_session.add(child)
        sqlite_session.commit()

        with (
            patch("services.dataset_service.current_user", _account()),
            patch(
                "services.dataset_service.VectorService.update_child_chunk_vector",
                side_effect=RuntimeError("vector failed"),
            ),
            pytest.raises(ChildChunkIndexingError, match="vector failed"),
        ):
            SegmentService.update_child_chunks(
                [ChildChunkUpdateArgs(id=child.id, content="changed")],
                segment,
                document,
                dataset,
                sqlite_session,
            )

        sqlite_session.refresh(child)
        assert child.content == "original"

    def test_delete_child_chunk_commits_after_vector_delete(self, sqlite_session: Session) -> None:
        dataset, _, _ = _persist_chain(sqlite_session)
        child = _child()
        sqlite_session.add(child)
        sqlite_session.commit()

        with patch("services.dataset_service.VectorService.delete_child_chunk_vector"):
            SegmentService.delete_child_chunk(child, dataset, sqlite_session)

        assert sqlite_session.get(ChildChunk, child.id) is None

    def test_delete_child_chunk_rolls_back_on_vector_failure(self, sqlite_session: Session) -> None:
        dataset, _, _ = _persist_chain(sqlite_session)
        child = _child()
        sqlite_session.add(child)
        sqlite_session.commit()

        with (
            patch(
                "services.dataset_service.VectorService.delete_child_chunk_vector",
                side_effect=RuntimeError("vector failed"),
            ),
            pytest.raises(ChildChunkDeleteIndexError, match="vector failed"),
        ):
            SegmentService.delete_child_chunk(child, dataset, sqlite_session)

        assert sqlite_session.get(ChildChunk, child.id) is not None


class TestSegmentServiceMutations:
    def test_create_segment_persists_position_and_updates_document_count(self, sqlite_session: Session) -> None:
        dataset = _dataset()
        document = _document(word_count=0)
        sqlite_session.add_all([dataset, document, _segment(segment_id="existing", content="old")])
        sqlite_session.commit()
        embedding_model = SimpleNamespace(get_text_embedding_num_tokens=lambda *, texts: [len(texts) + 2])

        with (
            patch("services.dataset_service.current_user", _account()),
            patch("services.dataset_service.ModelManager") as manager_cls,
            patch("services.dataset_service.VectorService.create_segments_vector"),
        ):
            manager_cls.for_tenant.return_value.get_model_instance.return_value = embedding_model
            segment = SegmentService.create_segment(
                {"content": "new", "attachment_ids": [], "keywords": ["key"]},
                document,
                dataset,
                sqlite_session,
            )

        assert segment is not None
        assert segment.position == 2
        assert document.word_count == 3

    def test_create_segment_marks_real_row_error_on_vector_failure(self, sqlite_session: Session) -> None:
        dataset = _dataset()
        document = _document(word_count=0)
        sqlite_session.add_all([dataset, document])
        sqlite_session.commit()
        embedding_model = SimpleNamespace(get_text_embedding_num_tokens=lambda *, texts: [len(texts) + 2])

        with (
            patch("services.dataset_service.current_user", _account()),
            patch("services.dataset_service.ModelManager") as manager_cls,
            patch(
                "services.dataset_service.VectorService.create_segments_vector",
                side_effect=RuntimeError("vector failed"),
            ),
        ):
            manager_cls.for_tenant.return_value.get_model_instance.return_value = embedding_model
            segment = SegmentService.create_segment(
                {"content": "new", "attachment_ids": []},
                document,
                dataset,
                sqlite_session,
            )

        assert segment is not None
        assert segment.status == SegmentStatus.ERROR
        assert segment.enabled is False
        assert segment.error == "vector failed"

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

    def test_update_segment_disables_and_dispatches_cleanup(self, sqlite_session: Session) -> None:
        dataset, document, segment = _persist_chain(sqlite_session)

        with (
            patch("services.dataset_service.current_user", _account()),
            patch("services.dataset_service.disable_segment_from_index_task.delay") as cleanup,
        ):
            updated = SegmentService.update_segment(
                SegmentUpdateArgs(enabled=False),
                segment,
                document,
                dataset,
                sqlite_session,
            )

        assert updated.enabled is False
        cleanup.assert_called_once_with(segment.id)

    def test_update_segment_same_content_persists_keywords(self, sqlite_session: Session) -> None:
        dataset, document, segment = _persist_chain(sqlite_session)

        with (
            patch("services.dataset_service.current_user", _account()),
            patch("services.dataset_service.VectorService.update_segment_vector") as vector_update,
            patch("services.dataset_service.VectorService.update_multimodel_vector"),
        ):
            updated = SegmentService.update_segment(
                SegmentUpdateArgs(content=segment.content, keywords=["new-keyword"]),
                segment,
                document,
                dataset,
                sqlite_session,
            )

        assert updated.keywords == ["new-keyword"]
        vector_update.assert_called_once()

    def test_update_segment_content_change_uses_embedding_tokens_and_updates_document_count(
        self, sqlite_session: Session
    ) -> None:
        dataset, document, segment = _persist_chain(sqlite_session)
        original_document_count = document.word_count
        original_segment_count = segment.word_count
        embedding_model = SimpleNamespace(get_text_embedding_num_tokens=lambda *, texts: [len(texts) + 4])

        with (
            patch("services.dataset_service.current_user", _account()),
            patch("services.dataset_service.ModelManager") as manager_cls,
            patch("services.dataset_service.VectorService.update_segment_vector"),
            patch("services.dataset_service.VectorService.update_multimodel_vector"),
        ):
            manager_cls.for_tenant.return_value.get_model_instance.return_value = embedding_model
            updated = SegmentService.update_segment(
                SegmentUpdateArgs(content="changed content"),
                segment,
                document,
                dataset,
                sqlite_session,
            )

        assert updated.content == "changed content"
        assert updated.tokens == 5
        assert document.word_count == original_document_count + len("changed content") - original_segment_count

    def test_update_segment_rejects_disabled_or_indexing_segment(self, sqlite_session: Session) -> None:
        dataset, document, segment = _persist_chain(sqlite_session)
        segment.enabled = False
        sqlite_session.commit()

        with patch("services.dataset_service.current_user", _account()):
            with pytest.raises(ValueError, match="Can't update disabled segment"):
                SegmentService.update_segment(
                    SegmentUpdateArgs(content="changed"), segment, document, dataset, sqlite_session
                )

        segment.enabled = True
        sqlite_session.commit()
        with (
            patch("services.dataset_service.current_user", _account()),
            patch("services.dataset_service.redis_client.get", return_value=b"1"),
            pytest.raises(ValueError, match="Segment is indexing"),
        ):
            SegmentService.update_segment(
                SegmentUpdateArgs(content="changed"), segment, document, dataset, sqlite_session
            )

    def test_delete_segment_removes_row_and_updates_document_count(self, sqlite_session: Session) -> None:
        dataset, document, segment = _persist_chain(sqlite_session)
        original_count = document.word_count

        with (
            patch("services.dataset_service.redis_client.get", return_value=None),
            patch("services.dataset_service.delete_segment_from_index_task.delay") as cleanup,
        ):
            SegmentService.delete_segment(segment, document, dataset, sqlite_session)

        assert sqlite_session.get(DocumentSegment, segment.id) is None
        assert document.word_count == original_count - segment.word_count
        cleanup.assert_called_once()

    def test_delete_segment_rejects_when_delete_is_already_in_progress(self, sqlite_session: Session) -> None:
        dataset, document, segment = _persist_chain(sqlite_session)

        with (
            patch("services.dataset_service.redis_client.get", return_value=b"1"),
            pytest.raises(ValueError, match="Segment is deleting"),
        ):
            SegmentService.delete_segment(segment, document, dataset, sqlite_session)

        assert sqlite_session.get(DocumentSegment, segment.id) is segment

    def test_delete_segments_scopes_rows_and_clamps_document_count(self, sqlite_session: Session) -> None:
        dataset = _dataset()
        document = _document(word_count=5)
        owned = _segment(segment_id="owned", content="123456789")
        foreign = _segment(segment_id="foreign", tenant_id="tenant-2", content="foreign")
        sqlite_session.add_all([dataset, document, owned, foreign])
        sqlite_session.commit()

        with (
            patch("services.dataset_service.current_user", _account()),
            patch("services.dataset_service.delete_segment_from_index_task.delay"),
        ):
            SegmentService.delete_segments([owned.id, foreign.id], document, dataset, sqlite_session)

        assert sqlite_session.get(DocumentSegment, owned.id) is None
        assert sqlite_session.get(DocumentSegment, foreign.id) is foreign
        assert document.word_count == 0

    @pytest.mark.parametrize(("action", "initial_enabled"), [("enable", False), ("disable", True)])
    def test_update_segments_status_persists_only_owned_rows(
        self, sqlite_session: Session, action: str, initial_enabled: bool
    ) -> None:
        dataset = _dataset()
        document = _document()
        owned = _segment(enabled=initial_enabled)
        decoy = _segment(segment_id="decoy", document_id="document-2", enabled=initial_enabled)
        sqlite_session.add_all([dataset, document, owned, decoy])
        sqlite_session.commit()

        with (
            patch("services.dataset_service.current_user", _account()),
            patch("services.dataset_service.redis_client.get", return_value=None),
            patch("services.dataset_service.enable_segments_to_index_task.delay"),
            patch("services.dataset_service.disable_segments_from_index_task.delay"),
        ):
            SegmentService.update_segments_status([owned.id, decoy.id], action, dataset, document, sqlite_session)

        assert owned.enabled is (action == "enable")
        assert decoy.enabled is initial_enabled
