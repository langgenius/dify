"""Unit tests for SegmentService behaviors in dataset_service."""

from collections.abc import Callable

from flask_sqlalchemy.pagination import SelectPagination
from sqlalchemy import literal, select
from sqlalchemy.orm import Session

from models.account import Tenant
from services.dataset_ref_service import DatasetRefService
from services.knowledge.resource_scope import DatasetRef, DocumentRef, SegmentRef

from .dataset_service_test_helpers import (
    Account,
    DocumentSegment,
    IndexStructureType,
    MagicMock,
    SegmentService,
    _make_child_chunk,
    _make_dataset,
    _make_document,
    _make_lock_context,
    create_autospec,
    patch,
    pytest,
)


def _account() -> Account:
    account = Account(name="User", email="user-1@example.com")
    account.id = "user-1"
    tenant = Tenant(name="Tenant")
    tenant.id = "tenant-1"
    account._current_tenant = tenant
    return account


def _make_segment_ref(segment_id: str = "segment-1"):
    dataset = _make_dataset()
    document = _make_document(dataset_id=dataset.id, tenant_id=dataset.tenant_id)
    dataset_ref = DatasetRefService.create_dataset_ref(dataset)
    document_ref = DatasetRefService.create_document_ref(dataset_ref, document)
    assert document_ref is not None
    return DatasetRefService.create_segment_ref(document_ref, segment_id)


class TestDatasetRefService:
    """Unit tests for typed dataset resource refs."""

    def test_create_dataset_ref_carries_workspace_owner(self):
        dataset_ref = DatasetRefService.create_dataset_ref(_make_dataset())

        assert dataset_ref.tenant_id == "tenant-1"
        assert dataset_ref.dataset_id == "dataset-1"

    @pytest.mark.parametrize(
        ("document_dataset_id", "document_tenant_id"),
        [("other-dataset", "tenant-1"), ("dataset-1", "other-tenant")],
    )
    def test_create_document_ref_rejects_document_outside_dataset(self, document_dataset_id, document_tenant_id):
        dataset = _make_dataset(dataset_id="dataset-1", tenant_id="tenant-1")
        document = _make_document(
            document_id="doc-1",
            dataset_id=document_dataset_id,
            tenant_id=document_tenant_id,
        )
        dataset_ref = DatasetRefService.create_dataset_ref(dataset)

        assert DatasetRefService.create_document_ref(dataset_ref, document) is None

    def test_create_segment_ref_carries_full_parent_chain(self):
        segment_ref = _make_segment_ref()

        assert isinstance(segment_ref, SegmentRef)
        assert isinstance(segment_ref.document, DocumentRef)
        assert isinstance(segment_ref.document.dataset, DatasetRef)
        assert segment_ref.document.dataset.tenant_id == "tenant-1"
        assert segment_ref.document.dataset.dataset_id == "dataset-1"
        assert segment_ref.document.document_id == "doc-1"
        assert segment_ref.segment_id == "segment-1"


class TestSegmentServiceQueries:
    """Unit tests for child-chunk and segment query helpers."""

    @pytest.fixture
    def account_context(self):
        account = create_autospec(Account, instance=True)
        account.id = "user-1"
        account.current_tenant_id = "tenant-1"

        with patch("services.dataset_service.current_user", account):
            yield account

    def test_get_child_chunk_by_id_returns_only_child_chunk_instances(self):
        session = MagicMock()
        child_chunk = _make_child_chunk()

        session.scalar.return_value = child_chunk
        result = SegmentService.get_child_chunk_by_id("child-a", "tenant-1", session)

        assert result is child_chunk

        session.scalar.return_value = object()
        result = SegmentService.get_child_chunk_by_id("child-a", "tenant-1", session)

        assert result is None

    def test_get_child_chunk_by_segment_ref_uses_full_ownership_chain(self):
        session = MagicMock()
        child_chunk = _make_child_chunk()
        segment_ref = _make_segment_ref()
        session = MagicMock()
        session.scalar.return_value = child_chunk

        session.scalar.return_value = child_chunk
        result = SegmentService.get_child_chunk_by_segment_ref("child-a", segment_ref, session=session)

        assert result is child_chunk
        stmt = session.scalar.call_args.args[0]
        sql = str(stmt.compile(compile_kwargs={"literal_binds": True}))
        assert "child_chunks.id = 'child-a'" in sql
        assert "child_chunks.tenant_id = 'tenant-1'" in sql
        assert "child_chunks.dataset_id = 'dataset-1'" in sql
        assert "child_chunks.document_id = 'doc-1'" in sql
        assert "child_chunks.segment_id = 'segment-1'" in sql

    def test_get_segments_uses_status_and_keyword_filters(self, sqlite_session: Session):
        session = MagicMock()
        paginated = SelectPagination(
            select=select(literal("segment")),
            session=sqlite_session,
            page=1,
            per_page=20,
        )

        with (
            patch("services.dataset_service.paginate_query") as mock_paginate,
            patch("services.dataset_service.helper.escape_like_pattern", return_value="escaped") as escape_like,
        ):
            mock_paginate.return_value = paginated

            items, total = SegmentService.get_segments(
                document_id="doc-1",
                tenant_id="tenant-1",
                status_list=["completed"],
                keyword="needle",
                page=1,
                limit=20,
                session=session,
            )

        assert items == ["segment"]
        assert total == 1
        escape_like.assert_called_once_with("needle")
        mock_paginate.assert_called_once()

    def test_get_segment_by_id_returns_only_document_segment_instances(self):
        session = MagicMock()
        segment = DocumentSegment(
            tenant_id="tenant-1",
            dataset_id="dataset-1",
            document_id="doc-1",
            position=1,
            content="segment",
            word_count=7,
            tokens=2,
            created_by="user-1",
        )
        segment.id = "segment-1"
        session.scalar.return_value = segment
        result = SegmentService.get_segment_by_id("segment-1", "tenant-1", session)

        assert result is segment

        session.scalar.return_value = object()
        result = SegmentService.get_segment_by_id("segment-1", "tenant-1", session)

        assert result is None

    def test_get_segment_by_ref_uses_full_ownership_chain(self):
        session = MagicMock()
        segment = DocumentSegment(
            tenant_id="tenant-1",
            dataset_id="dataset-1",
            document_id="doc-1",
            position=1,
            content="segment",
            word_count=7,
            tokens=2,
            created_by="user-1",
        )
        segment.id = "segment-1"
        segment_ref = _make_segment_ref()
        session = MagicMock()
        session.scalar.return_value = segment

        session.scalar.return_value = segment
        result = SegmentService.get_segment_by_ref(segment_ref, session=session)

        assert result is segment
        stmt = session.scalar.call_args.args[0]
        sql = str(stmt.compile(compile_kwargs={"literal_binds": True}))
        assert "document_segments.id = 'segment-1'" in sql
        assert "document_segments.tenant_id = 'tenant-1'" in sql
        assert "document_segments.dataset_id = 'dataset-1'" in sql
        assert "document_segments.document_id = 'doc-1'" in sql

    def test_get_segments_by_document_and_dataset_returns_scalars_result(self):
        session = MagicMock()
        segment = DocumentSegment(
            tenant_id="tenant-1",
            dataset_id="dataset-1",
            document_id="doc-1",
            position=1,
            content="segment",
            word_count=7,
            tokens=2,
            created_by="user-1",
        )

        segment.id = "segment-1"
        session.scalars.return_value.all.return_value = [segment]

        result = SegmentService.get_segments_by_document_and_dataset(
            document_id="doc-1",
            dataset_id="dataset-1",
            session=session,
            status="completed",
            enabled=True,
        )

        assert result == [segment]
        session.scalars.assert_called_once()


class TestSegmentServiceValidation:
    """Unit tests for segment-create argument validation."""

    def test_segment_create_args_validate_requires_answer_for_qa_model(self):
        document = _make_document(doc_form=IndexStructureType.QA_INDEX)

        with pytest.raises(ValueError, match="Answer is required"):
            SegmentService.segment_create_args_validate({"content": "question"}, document)

    def test_segment_create_args_validate_requires_non_empty_content(self):
        document = _make_document(doc_form=IndexStructureType.PARAGRAPH_INDEX)

        with pytest.raises(ValueError, match="Content is empty"):
            SegmentService.segment_create_args_validate({"content": "   "}, document)

    def test_segment_create_args_validate_enforces_attachment_limit(self, config_overrides: Callable[..., None]):
        config_overrides(SINGLE_CHUNK_ATTACHMENT_LIMIT=1)
        document = _make_document(doc_form=IndexStructureType.PARAGRAPH_INDEX)
        args = {"content": "hello", "attachment_ids": ["a-1", "a-2"]}

        with pytest.raises(ValueError, match="Exceeded maximum attachment limit of 1"):
            SegmentService.segment_create_args_validate(args, document)

    def test_segment_create_args_validate_requires_attachment_ids_list(self):
        document = _make_document(doc_form=IndexStructureType.PARAGRAPH_INDEX)

        with pytest.raises(ValueError, match="Attachment IDs is invalid"):
            SegmentService.segment_create_args_validate({"content": "hello", "attachment_ids": "bad-type"}, document)


class TestSegmentServiceMutations:
    """Unit tests for segment create, update, delete, and bulk status flows."""

    @pytest.fixture
    def account_context(self):
        account = create_autospec(Account, instance=True)
        account.id = "user-1"
        account.current_tenant_id = "tenant-1"

        with patch("services.dataset_service.current_user", account):
            yield account

    def test_multi_create_segment_high_quality_marks_segments_error_when_vector_creation_fails(self, account_context):
        session = MagicMock()
        dataset = _make_dataset(indexing_technique="high_quality")
        document = _make_document(
            dataset_id=dataset.id,
            tenant_id=dataset.tenant_id,
            doc_form=IndexStructureType.QA_INDEX,
            word_count=5,
        )
        segments = [
            {"content": "question-1", "answer": "answer-1", "keywords": ["k1"]},
            {"content": "question-2", "answer": "answer-2"},
        ]
        embedding_model = MagicMock()
        embedding_model.get_text_embedding_num_tokens.side_effect = [[11], [13]]

        with (
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.ModelManager") as model_manager_cls,
            patch("services.dataset_service.VectorService") as vector_service,
            patch("services.dataset_service.helper.generate_text_hash", side_effect=["hash-1", "hash-2"]),
            patch("services.dataset_service.uuid.uuid4", side_effect=["node-1", "node-2"]),
            patch("services.dataset_service.naive_utc_now", return_value="now"),
        ):
            mock_redis.lock.return_value = _make_lock_context()
            model_manager_cls.for_tenant.return_value.get_model_instance.return_value = embedding_model
            session.scalar.return_value = 1
            vector_service.create_segments_vector.side_effect = RuntimeError("vector failed")

            result = SegmentService.multi_create_segment(segments, document, dataset, session)
            assert result

        assert len(result) == 2
        assert [segment.position for segment in result] == [2, 3]
        assert [segment.tokens for segment in result] == [11, 13]
        assert all(segment.status == "error" for segment in result)
        assert all(segment.enabled is False for segment in result)
        assert all(segment.error == "vector failed" for segment in result)
        assert document.word_count == 5 + sum(len(item["content"]) + len(item["answer"]) for item in segments)
        vector_service.create_segments_vector.assert_called_once_with(
            [["k1"], None], result, dataset, document.doc_form, session=session
        )
        session.commit.assert_called()
