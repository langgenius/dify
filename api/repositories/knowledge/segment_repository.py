"""Infrastructure adapters for dataset segment use cases."""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from dataclasses import asdict, dataclass
from typing import Literal, cast
from uuid import uuid4

from sqlalchemy import String, case, delete, func, literal, or_, select, tuple_, update
from sqlalchemy import cast as sql_cast
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.rag.datasource.vdb.vector_factory import Vector
from core.rag.docstore.dataset_docstore import DatasetDocumentStore
from core.rag.index_processor.constant.index_type import IndexStructureType
from core.rag.models.document import ChildDocument
from core.rag.models.document import Document as IndexDocument
from libs.datetime_utils import naive_utc_now
from libs.helper import escape_like_pattern
from libs.pagination import PaginatedResult, paginate_query
from models.dataset import (
    ChildChunk,
    Dataset,
    DatasetProcessRule,
    Document,
    DocumentSegment,
    DocumentSegmentSummary,
    SegmentAttachmentBinding,
)
from models.enums import IndexingStatus, SegmentStatus, SegmentType, SummaryStatus
from models.knowledge_task import KnowledgeTaskOutbox
from models.model import UploadFile
from repositories.knowledge.dataset_read_repository import get_dataset_keyword_table
from repositories.knowledge.dataset_repository import _get_dataset, lock_dataset_for_child_write
from repositories.knowledge.document_repository import (
    _get_document,
    require_indexing_document,
    require_owned_indexing_document,
)
from repositories.knowledge.keyword_table_repository import persist_keyword_table
from repositories.knowledge.segment_query_repository import (
    get_segment_attachment_files,
    get_segment_child_chunks,
    get_segment_content_file_ids,
    segment_content_file_ids,
)
from repositories.knowledge.task_outbox_repository import enqueue_knowledge_task, guard_task_execution
from repositories.knowledge.upload_file_repository import (
    add_segment_attachment_bindings,
    detach_segment_file_references,
    replace_segment_attachment_bindings,
    replace_segment_image_upload_file_references,
)
from services.knowledge.entities.segments import ChildChunkRecord
from services.knowledge.hit_testing.entities import (
    RetrievalAttachmentRecord,
    RetrievalChildRecord,
    RetrievalSegmentRecord,
    RetrievalSnapshot,
)
from services.knowledge.indexing.contracts import DocumentIndexingExecution, IndexingDocument
from services.knowledge.resource_scope import DatasetRef, DocumentRef, SegmentRef
from services.knowledge.segments.contracts import (
    ChildChunkListFilter,
    ChildChunkPage,
    ChildChunkState,
    SegmentAttachmentFile,
    SegmentChildIndexCompletion,
    SegmentDetail,
    SegmentDocumentCreationState,
    SegmentFileAccess,
    SegmentIndexingMutationError,
    SegmentIndexReconcileOutcome,
    SegmentIndexTarget,
    SegmentListFilter,
    SegmentPageData,
    SegmentReadSnapshot,
    SegmentUpdateState,
)
from services.knowledge.task_outbox.contracts import KnowledgeTaskKind


def _guard_document_task_execution(session: Session, execution: DocumentIndexingExecution | None) -> None:
    if execution is None or (execution.task_intent_id is None and execution.task_execution_id is None):
        return
    if execution.task_intent_id is None or execution.task_execution_id is None:
        raise ValueError("Document indexing task execution claim is incomplete")
    guard_task_execution(
        session,
        intent_id=execution.task_intent_id,
        execution_id=execution.task_execution_id,
        now=naive_utc_now(),
    )


def _enqueue_current_segment_status_repairs(
    session: Session,
    document_ref: DocumentRef,
    segments: Sequence[DocumentSegment],
) -> int:
    grouped: dict[tuple[bool, str], list[str]] = {}
    for segment in segments:
        if segment.indexing_generation is None:
            continue
        grouped.setdefault((segment.enabled, segment.indexing_generation), []).append(segment.id)
    for (enabled, generation), segment_ids in grouped.items():
        enqueue_knowledge_task(
            session,
            kind=(KnowledgeTaskKind.SEGMENT_INDEX_ENABLE if enabled else KnowledgeTaskKind.SEGMENT_INDEX_DISABLE),
            tenant_id=document_ref.dataset.tenant_id,
            dataset_id=document_ref.dataset.dataset_id,
            document_id=document_ref.document_id,
            resource_id=document_ref.document_id,
            payload={
                "segment_ids": segment_ids,
                "dataset_id": document_ref.dataset.dataset_id,
                "document_id": document_ref.document_id,
                "expected_enabled": enabled,
                "generation": generation,
                "repair": True,
            },
        )
    return len(grouped)


class SQLAlchemySegmentAttachmentWriter:
    """Persist segment file edges behind the core document-store port."""

    def delete_segments_for_replacement(
        self,
        session: Session,
        *,
        tenant_id: str,
        dataset_id: str,
        document_id: str,
    ) -> None:
        document_ref = DatasetRef(tenant_id, dataset_id).document(document_id)
        files = delete_document_segments_for_replacement(session, document_ref)
        enqueue_upload_file_cleanup(session, document_ref, files)

    def replace_content_references(
        self,
        session: Session,
        *,
        tenant_id: str,
        dataset_id: str,
        document_id: str,
        segment_id: str,
        content: str,
    ) -> None:
        dataset_ref = DatasetRef(tenant_id, dataset_id)
        if lock_dataset_for_child_write(session, dataset_ref) is None:
            raise LookupError("Dataset no longer exists")
        document_ref = dataset_ref.document(document_id)
        if _lock_document(session, document_ref) is None:
            raise LookupError("Document no longer exists")
        if _get_segment(session, document_ref.segment(segment_id), lock=True) is None:
            raise LookupError("Segment no longer exists")
        detached_files = replace_segment_image_upload_file_references(
            session,
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            document_id=document_id,
            segment_id=segment_id,
            content=content,
        )
        enqueue_upload_file_cleanup(session, document_ref, tuple(file.id for file in detached_files))

    def add_bindings(
        self,
        session: Session,
        *,
        tenant_id: str,
        dataset_id: str,
        document_id: str,
        segment_id: str,
        attachment_ids: Sequence[str],
    ) -> None:
        if lock_dataset_for_child_write(session, DatasetRef(tenant_id, dataset_id)) is None:
            raise LookupError("Dataset no longer exists")
        add_segment_attachment_bindings(
            session,
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            document_id=document_id,
            segment_id=segment_id,
            attachment_ids=attachment_ids,
        )


class SQLAlchemySegmentRepository:
    """Read and write scoped segment rows in bounded database transactions."""

    def __init__(
        self,
        *,
        session_factory: sessionmaker[Session],
        wake_after_commit: Callable[[Session], None],
    ) -> None:
        self._session_factory = session_factory
        self._wake_after_commit = wake_after_commit

    def get_retrieval_snapshot(
        self,
        ref: DatasetRef,
        *,
        node_pairs: Sequence[tuple[str, str]],
        summary_pairs: Sequence[tuple[str, str]],
        attachment_pairs: Sequence[tuple[str, str]],
    ) -> RetrievalSnapshot:
        """Load all current retrieval owners in one bounded, tenant-scoped read."""

        if not (node_pairs or summary_pairs or attachment_pairs):
            return RetrievalSnapshot((), (), (), {})
        owned_segments = (
            select(DocumentSegment)
            .join(Document, Document.id == DocumentSegment.document_id)
            .join(Dataset, Dataset.id == Document.dataset_id)
            .where(
                Dataset.tenant_id == ref.tenant_id,
                Dataset.id == ref.dataset_id,
                Document.tenant_id == ref.tenant_id,
                Document.dataset_id == DocumentSegment.dataset_id,
                Document.enabled.is_(True),
                Document.archived.is_(False),
                Document.indexing_status == IndexingStatus.COMPLETED,
                DocumentSegment.tenant_id == ref.tenant_id,
                DocumentSegment.dataset_id == ref.dataset_id,
                DocumentSegment.enabled.is_(True),
                DocumentSegment.status == SegmentStatus.COMPLETED,
            )
        )
        owned_ids = owned_segments.with_only_columns(DocumentSegment.id)
        with self._session_factory() as session:
            children = (
                session.scalars(
                    select(ChildChunk)
                    .join(DocumentSegment, DocumentSegment.id == ChildChunk.segment_id)
                    .where(
                        ChildChunk.segment_id.in_(owned_ids),
                        ChildChunk.tenant_id == ref.tenant_id,
                        ChildChunk.dataset_id == ref.dataset_id,
                        ChildChunk.document_id == DocumentSegment.document_id,
                        tuple_(ChildChunk.document_id, ChildChunk.index_node_id).in_(node_pairs),
                    )
                ).all()
                if node_pairs
                else []
            )
            attachment_rows = (
                session.execute(
                    select(SegmentAttachmentBinding, UploadFile)
                    .join(UploadFile, UploadFile.id == SegmentAttachmentBinding.attachment_id)
                    .join(DocumentSegment, DocumentSegment.id == SegmentAttachmentBinding.segment_id)
                    .where(
                        SegmentAttachmentBinding.segment_id.in_(owned_ids),
                        SegmentAttachmentBinding.tenant_id == ref.tenant_id,
                        SegmentAttachmentBinding.dataset_id == ref.dataset_id,
                        SegmentAttachmentBinding.document_id == DocumentSegment.document_id,
                        UploadFile.tenant_id == ref.tenant_id,
                        tuple_(SegmentAttachmentBinding.document_id, UploadFile.id).in_(attachment_pairs),
                    )
                ).all()
                if attachment_pairs
                else []
            )
            segments = session.scalars(
                owned_segments.where(
                    or_(
                        tuple_(DocumentSegment.document_id, DocumentSegment.index_node_id).in_(node_pairs),
                        tuple_(DocumentSegment.document_id, DocumentSegment.id).in_(summary_pairs),
                        DocumentSegment.id.in_([child.segment_id for child in children]),
                        DocumentSegment.id.in_([binding.segment_id for binding, _ in attachment_rows]),
                    )
                )
            ).all()
            segment_ids = {segment.id for segment in segments}
            summary_segment_ids = {segment_id for _, segment_id in summary_pairs} & segment_ids
            summaries = (
                session.scalars(
                    select(DocumentSegmentSummary)
                    .join(DocumentSegment, DocumentSegment.id == DocumentSegmentSummary.chunk_id)
                    .where(
                        DocumentSegmentSummary.chunk_id.in_(summary_segment_ids),
                        DocumentSegmentSummary.dataset_id == DocumentSegment.dataset_id,
                        DocumentSegmentSummary.document_id == DocumentSegment.document_id,
                        DocumentSegmentSummary.enabled.is_(True),
                        DocumentSegmentSummary.status == SummaryStatus.COMPLETED,
                    )
                ).all()
                if summary_segment_ids
                else []
            )
            return RetrievalSnapshot(
                segments=tuple(
                    RetrievalSegmentRecord(
                        id=segment.id,
                        document_id=segment.document_id,
                        index_node_id=segment.index_node_id,
                        values=_segment_values(segment),
                    )
                    for segment in segments
                ),
                children=tuple(
                    RetrievalChildRecord(
                        id=child.id,
                        segment_id=child.segment_id,
                        document_id=child.document_id,
                        index_node_id=child.index_node_id,
                        content=child.content,
                        position=child.position,
                    )
                    for child in children
                    if child.segment_id in segment_ids
                ),
                attachments=tuple(
                    RetrievalAttachmentRecord(
                        segment_id=binding.segment_id,
                        document_id=binding.document_id,
                        id=file.id,
                        name=file.name,
                        extension=file.extension,
                        mime_type=file.mime_type,
                        size=file.size,
                    )
                    for binding, file in attachment_rows
                    if binding.segment_id in segment_ids
                ),
                summaries={
                    summary.chunk_id: summary.summary_content for summary in summaries if summary.summary_content
                },
            )

    def clear_for_indexing(self, document: IndexingDocument) -> None:
        ref = document.ref
        with self._session_factory.begin() as session:
            if lock_dataset_for_child_write(session, ref.dataset) is None:
                require_indexing_document(session, ref)
                raise AssertionError("indexing document exists without its dataset")
            require_owned_indexing_document(session, ref, execution=document.execution, lock=True)
            if document.execution is not None:
                document.execution.assert_owned()
            _guard_document_task_execution(session, document.execution)

    def save_for_indexing(
        self, document: IndexingDocument, chunks: list[IndexDocument], token_counts: list[int]
    ) -> None:
        ref = document.ref
        with self._session_factory.begin() as session:
            dataset = lock_dataset_for_child_write(session, ref.dataset)
            if dataset is None:
                require_indexing_document(session, ref)
                raise AssertionError("indexing document exists without its dataset")
            row = require_owned_indexing_document(session, ref, execution=document.execution, lock=True)
            cleanup_files = delete_document_segments_for_replacement(
                session,
                ref,
                owner_locks_held=True,
            )
            DatasetDocumentStore(
                dataset=dataset,
                user_id=row.created_by,
                document_id=row.id,
                attachment_writer=SQLAlchemySegmentAttachmentWriter(),
            ).add_documents(
                session=session,
                docs=chunks,
                token_counts=token_counts,
                save_child=document.doc_form == IndexStructureType.PARENT_CHILD_INDEX,
            )
            now = naive_utc_now()
            row.indexing_status = IndexingStatus.INDEXING
            row.cleaning_completed_at = now
            row.splitting_completed_at = now
            row.word_count = sum(len(chunk.page_content) for chunk in chunks)
            session.execute(
                update(DocumentSegment)
                .where(*self._indexing_scope(ref))
                .values(
                    status=SegmentStatus.INDEXING,
                    indexing_at=now,
                )
            )
            if cleanup_files:
                enqueue_upload_file_cleanup(session, ref, cleanup_files)
                self._wake_after_commit(session)
            if document.execution is not None:
                document.execution.assert_owned()
            _guard_document_task_execution(session, document.execution)

    def resume_indexing(self, document: IndexingDocument) -> tuple[list[IndexDocument], int]:
        ref = document.ref
        with self._session_factory() as session:
            require_owned_indexing_document(session, ref, execution=document.execution)
            rows = session.scalars(
                select(DocumentSegment).where(*self._indexing_scope(ref)).order_by(DocumentSegment.position)
            ).all()
            chunks = []
            for row in rows:
                if row.status == SegmentStatus.COMPLETED:
                    continue
                chunk = IndexDocument(
                    page_content=row.content,
                    metadata={
                        "doc_id": row.index_node_id,
                        "doc_hash": row.index_node_hash,
                        "document_id": ref.document_id,
                        "dataset_id": ref.dataset.dataset_id,
                    },
                )
                if document.doc_form == IndexStructureType.PARENT_CHILD_INDEX:
                    chunk.children = [
                        ChildDocument(
                            page_content=child.content,
                            metadata={
                                "doc_id": child.index_node_id,
                                "doc_hash": child.index_node_hash,
                                "document_id": ref.document_id,
                                "dataset_id": ref.dataset.dataset_id,
                            },
                        )
                        for child in get_segment_child_chunks(row, session=session)
                    ]
                chunks.append(chunk)
            if document.execution is not None:
                document.execution.assert_owned()
            return chunks, sum(row.tokens for row in rows)

    def complete_indexing_segments(
        self,
        ref: DocumentRef,
        node_ids: Sequence[str],
        *,
        execution: DocumentIndexingExecution | None = None,
    ) -> None:
        with self._session_factory.begin() as session:
            if lock_dataset_for_child_write(session, ref.dataset) is None:
                require_indexing_document(session, ref)
                raise AssertionError("indexing document exists without its dataset")
            require_owned_indexing_document(session, ref, execution=execution, lock=True)
            session.execute(
                update(DocumentSegment)
                .where(
                    *self._indexing_scope(ref),
                    DocumentSegment.index_node_id.in_(node_ids),
                    DocumentSegment.status == SegmentStatus.INDEXING,
                )
                .values(status=SegmentStatus.COMPLETED, enabled=True, completed_at=naive_utc_now())
            )
            if execution is not None:
                execution.assert_owned()
            _guard_document_task_execution(session, execution)

    @staticmethod
    def _indexing_scope(ref: DocumentRef):
        return (
            DocumentSegment.tenant_id == ref.dataset.tenant_id,
            DocumentSegment.dataset_id == ref.dataset.dataset_id,
            DocumentSegment.document_id == ref.document_id,
        )

    def list_segments(
        self,
        document_ref: DocumentRef,
        query: SegmentListFilter,
    ) -> SegmentPageData[SegmentReadSnapshot]:
        with self._session_factory() as session:
            statement = (
                select(DocumentSegment)
                .join(Document, Document.id == DocumentSegment.document_id)
                .join(Dataset, Dataset.id == Document.dataset_id)
                .where(
                    Dataset.tenant_id == document_ref.dataset.tenant_id,
                    Dataset.id == document_ref.dataset.dataset_id,
                    Document.tenant_id == document_ref.dataset.tenant_id,
                    Document.dataset_id == document_ref.dataset.dataset_id,
                    Document.id == document_ref.document_id,
                    DocumentSegment.tenant_id == document_ref.dataset.tenant_id,
                    DocumentSegment.dataset_id == document_ref.dataset.dataset_id,
                    DocumentSegment.document_id == document_ref.document_id,
                )
                .order_by(DocumentSegment.position.asc(), DocumentSegment.id.asc())
            )
            if query.statuses:
                statement = statement.where(DocumentSegment.status.in_(query.statuses))
            if query.hit_count_gte is not None:
                statement = statement.where(DocumentSegment.hit_count >= query.hit_count_gte)
            if query.keyword:
                escaped_keyword = escape_like_pattern(query.keyword)
                if dify_config.SQLALCHEMY_DATABASE_URI_SCHEME == "postgresql":
                    keywords_jsonb = sql_cast(DocumentSegment.keywords, JSONB)
                    keywords_array = case(
                        (func.jsonb_typeof(keywords_jsonb) == "array", keywords_jsonb),
                        else_=sql_cast(literal("[]"), JSONB),
                    )
                    keywords_condition = func.array_to_string(
                        func.array(
                            select(func.jsonb_array_elements_text(keywords_array))
                            .correlate(DocumentSegment)
                            .scalar_subquery()
                        ),
                        ",",
                    ).ilike(f"%{escaped_keyword}%", escape="\\")
                else:
                    keywords_condition = sql_cast(DocumentSegment.keywords, String).ilike(
                        f"%{escaped_keyword}%", escape="\\"
                    )
                statement = statement.where(
                    or_(
                        DocumentSegment.content.ilike(f"%{escaped_keyword}%", escape="\\"),
                        keywords_condition,
                    )
                )
            if query.enabled.lower() == "true":
                statement = statement.where(DocumentSegment.enabled.is_(True))
            elif query.enabled.lower() == "false":
                statement = statement.where(DocumentSegment.enabled.is_(False))

            limit = min(query.limit, 100)
            segments = paginate_query(statement, session=session, page=query.page, per_page=limit, max_per_page=100)
            items = list(segments.items)
            file_access = _content_file_access(items, session)
            summaries = (
                {
                    summary.chunk_id: summary
                    for summary in session.scalars(
                        select(DocumentSegmentSummary).where(
                            DocumentSegmentSummary.chunk_id.in_([segment.id for segment in items]),
                            DocumentSegmentSummary.dataset_id == document_ref.dataset.dataset_id,
                            DocumentSegmentSummary.document_id == document_ref.document_id,
                        )
                    )
                }
                if items
                else {}
            )
            return SegmentPageData(
                items=tuple(
                    _segment_data(
                        segment,
                        summaries[segment.id].summary_content if segment.id in summaries else None,
                        session,
                        file_access[segment.id],
                    )
                    for segment in items
                ),
                total=segments.total,
                total_pages=segments.pages,
                page=query.page,
                limit=limit,
            )

    def list_child_chunks(
        self,
        segment_ref: SegmentRef,
        query: ChildChunkListFilter,
    ) -> ChildChunkPage | None:
        with self._session_factory() as session:
            if _get_segment(session, segment_ref) is None:
                return None
            limit = min(query.limit, 100)
            child_chunks = query_child_chunks(
                session,
                segment_ref,
                page=query.page,
                limit=limit,
                keyword=query.keyword,
            )
            return ChildChunkPage(
                items=tuple(_child_chunk_data(chunk) for chunk in child_chunks.items),
                total=child_chunks.total,
                total_pages=child_chunks.pages,
                page=query.page,
                limit=limit,
            )

    def get_segment(self, segment_ref: SegmentRef) -> SegmentDetail[SegmentReadSnapshot] | None:
        with self._session_factory() as session:
            segment = _get_segment(session, segment_ref)
            if segment is None:
                return None
            _, document = _require_scope_models(session, segment_ref.document)
            return _detail(session, segment, document)

    def get_segment_details(
        self, document_ref: DocumentRef, segment_ids: Sequence[str]
    ) -> tuple[SegmentDetail[SegmentReadSnapshot], ...]:
        if not segment_ids:
            return ()
        with self._session_factory() as session:
            _, document = _require_scope_models(session, document_ref)
            segments = {
                segment.id: segment
                for segment in session.scalars(
                    select(DocumentSegment).where(
                        DocumentSegment.tenant_id == document_ref.dataset.tenant_id,
                        DocumentSegment.dataset_id == document_ref.dataset.dataset_id,
                        DocumentSegment.document_id == document_ref.document_id,
                        DocumentSegment.id.in_(segment_ids),
                    )
                )
            }
            summaries = {
                summary.chunk_id: summary.summary_content
                for summary in session.scalars(
                    select(DocumentSegmentSummary).where(
                        DocumentSegmentSummary.dataset_id == document_ref.dataset.dataset_id,
                        DocumentSegmentSummary.document_id == document_ref.document_id,
                        DocumentSegmentSummary.chunk_id.in_(segment_ids),
                    )
                )
            }
            file_access = _content_file_access(tuple(segments.values()), session)
            return tuple(
                SegmentDetail(
                    data=_segment_data(
                        segments[segment_id],
                        summaries.get(segment_id),
                        session,
                        file_access[segment_id],
                    ),
                    doc_form=document.doc_form,
                )
                for segment_id in segment_ids
                if segment_id in segments
            )

    def get_document_creation_state(self, document_ref: DocumentRef) -> SegmentDocumentCreationState | None:
        with self._session_factory() as session:
            document = _get_document(session, document_ref)
            if document is None:
                return None
            return SegmentDocumentCreationState(
                indexing_status=str(document.indexing_status),
                enabled=document.enabled,
                archived=bool(document.archived),
            )

    def create_segments(
        self,
        document_ref: DocumentRef,
        values: Sequence[Mapping[str, object]],
        *,
        attachment_ids_list: Sequence[Sequence[str]],
        generation: str,
        batch_job_id: str | None,
    ) -> SegmentDocumentCreationState | None:
        if len(attachment_ids_list) != len(values):
            raise ValueError("Attachments must correspond to the segment batch")
        if not values:
            return self.get_document_creation_state(document_ref)
        with self._session_factory.begin() as session:
            document = lock_document_for_segment_creation(session, document_ref)
            state = _segment_document_creation_state(document)
            if not _is_segment_creation_ready(state):
                return state
            assert document is not None
            max_position = session.scalar(
                select(func.max(DocumentSegment.position)).where(
                    DocumentSegment.tenant_id == document_ref.dataset.tenant_id,
                    DocumentSegment.dataset_id == document_ref.dataset.dataset_id,
                    DocumentSegment.document_id == document_ref.document_id,
                )
            )
            position = (max_position or 0) + 1
            increment_word_count = 0
            rows: list[DocumentSegment] = []
            for item in values:
                segment = DocumentSegment(
                    tenant_id=document_ref.dataset.tenant_id,
                    dataset_id=document_ref.dataset.dataset_id,
                    document_id=document_ref.document_id,
                    position=position,
                    content=cast(str, item["content"]),
                    word_count=cast(int, item["word_count"]),
                    tokens=cast(int, item["tokens"]),
                    created_by=cast(str, item["created_by"]),
                )
                for key, value in item.items():
                    if key == "id":
                        segment.id = cast(str, value)
                    else:
                        setattr(segment, key, value)
                session.add(segment)
                rows.append(segment)
                increment_word_count += segment.word_count
                position += 1
            session.flush()
            for segment, attachment_ids in zip(rows, attachment_ids_list, strict=True):
                replace_segment_image_upload_file_references(
                    session,
                    tenant_id=document_ref.dataset.tenant_id,
                    dataset_id=document_ref.dataset.dataset_id,
                    document_id=document_ref.document_id,
                    segment_id=segment.id,
                    content=segment.content,
                )
                add_segment_attachment_bindings(
                    session,
                    tenant_id=document_ref.dataset.tenant_id,
                    dataset_id=document_ref.dataset.dataset_id,
                    document_id=document_ref.document_id,
                    segment_id=segment.id,
                    attachment_ids=attachment_ids,
                )
            document.word_count = (document.word_count or 0) + increment_word_count
            enqueue_knowledge_task(
                session,
                kind=KnowledgeTaskKind.SEGMENT_INDEX_CREATE,
                tenant_id=document_ref.dataset.tenant_id,
                dataset_id=document_ref.dataset.dataset_id,
                document_id=document_ref.document_id,
                resource_id=document_ref.document_id,
                payload={
                    "dataset_id": document_ref.dataset.dataset_id,
                    "document_id": document_ref.document_id,
                    "segment_ids": [segment.id for segment in rows],
                    "generation": generation,
                    "job_id": batch_job_id,
                },
            )
            self._wake_after_commit(session)
            return state

    def get_segment_update_state(self, segment_ref: SegmentRef) -> SegmentUpdateState | None:
        with self._session_factory() as session:
            segment = _get_segment(session, segment_ref)
            if segment is None:
                return None
            # Legacy rows may contain scalar or malformed JSON keywords. Treat
            # those as absent so a write can repair them without building a DTO.
            keywords = segment.keywords
            return SegmentUpdateState(
                content=segment.content,
                answer=segment.answer,
                enabled=segment.enabled,
                status=str(segment.status),
                keywords=tuple(keywords)
                if isinstance(keywords, list) and all(isinstance(keyword, str) for keyword in keywords)
                else None,
            )

    def get_segments(self, document_ref: DocumentRef, segment_ids: Sequence[str]) -> tuple[SegmentIndexTarget, ...]:
        if not segment_ids:
            return ()
        with self._session_factory() as session:
            segments = session.scalars(
                select(DocumentSegment).where(
                    DocumentSegment.tenant_id == document_ref.dataset.tenant_id,
                    DocumentSegment.dataset_id == document_ref.dataset.dataset_id,
                    DocumentSegment.document_id == document_ref.document_id,
                    DocumentSegment.id.in_(segment_ids),
                )
            ).all()
            return tuple(
                SegmentIndexTarget(
                    id=segment.id,
                    index_node_id=segment.index_node_id,
                    enabled=segment.enabled,
                    status=str(segment.status),
                    generation=segment.indexing_generation,
                )
                for segment in segments
            )

    def complete_created_segments(
        self, document_ref: DocumentRef, segment_ids: Sequence[str], *, generation: str
    ) -> int:
        if not segment_ids:
            return 0
        with self._session_factory.begin() as session:
            result = session.execute(
                update(DocumentSegment)
                .where(
                    DocumentSegment.tenant_id == document_ref.dataset.tenant_id,
                    DocumentSegment.dataset_id == document_ref.dataset.dataset_id,
                    DocumentSegment.document_id == document_ref.document_id,
                    DocumentSegment.id.in_(segment_ids),
                    DocumentSegment.indexing_generation == generation,
                    DocumentSegment.status == SegmentStatus.INDEXING,
                )
                .values(status=SegmentStatus.COMPLETED, completed_at=naive_utc_now(), error=None)
            )
            return int(cast("CursorResult[object]", result).rowcount or 0)

    def fail_created_segments(
        self,
        document_ref: DocumentRef,
        segment_ids: Sequence[str],
        *,
        generation: str,
        error: str,
    ) -> int:
        if not segment_ids:
            return 0
        with self._session_factory.begin() as session:
            now = naive_utc_now()
            result = session.execute(
                update(DocumentSegment)
                .where(
                    DocumentSegment.tenant_id == document_ref.dataset.tenant_id,
                    DocumentSegment.dataset_id == document_ref.dataset.dataset_id,
                    DocumentSegment.document_id == document_ref.document_id,
                    DocumentSegment.id.in_(segment_ids),
                    DocumentSegment.indexing_generation == generation,
                    DocumentSegment.status == SegmentStatus.INDEXING,
                )
                .values(
                    enabled=False,
                    disabled_at=now,
                    status=SegmentStatus.ERROR,
                    completed_at=None,
                    error=error[:4000],
                )
            )
            return int(cast("CursorResult[object]", result).rowcount or 0)

    def enqueue_created_segments_repair(
        self,
        document_ref: DocumentRef,
        segment_ids: Sequence[str],
        *,
        batch_job_id: str | None,
    ) -> bool:
        """Persist a current-generation successor after an expired create execution."""

        unique_ids = tuple(dict.fromkeys(segment_ids))
        if not unique_ids:
            return False
        with self._session_factory.begin() as session:
            if lock_dataset_for_child_write(session, document_ref.dataset) is None:
                return False
            document = _lock_document(session, document_ref)
            if document is None:
                return False
            segments = session.scalars(
                select(DocumentSegment)
                .where(
                    DocumentSegment.tenant_id == document_ref.dataset.tenant_id,
                    DocumentSegment.dataset_id == document_ref.dataset.dataset_id,
                    DocumentSegment.document_id == document_ref.document_id,
                    DocumentSegment.id.in_(unique_ids),
                )
                .with_for_update()
            ).all()
            current_segments = [
                segment
                for segment in segments
                if segment.indexing_generation is not None
                and segment.status in {SegmentStatus.INDEXING, SegmentStatus.COMPLETED, SegmentStatus.ERROR}
            ]
            generations = {segment.indexing_generation for segment in current_segments}
            can_reconcile_create = (
                document.enabled
                and not document.archived
                and document.indexing_status == IndexingStatus.COMPLETED
                and {segment.id for segment in current_segments} == set(unique_ids)
                and len(generations) == 1
                and None not in generations
                and not any(
                    not segment.enabled or segment.status not in {SegmentStatus.INDEXING, SegmentStatus.COMPLETED}
                    for segment in current_segments
                )
            )
            enqueued = False
            if can_reconcile_create:
                generation = generations.pop()
                assert generation is not None
                enqueue_knowledge_task(
                    session,
                    kind=KnowledgeTaskKind.SEGMENT_INDEX_CREATE,
                    tenant_id=document_ref.dataset.tenant_id,
                    dataset_id=document_ref.dataset.dataset_id,
                    document_id=document_ref.document_id,
                    resource_id=document_ref.document_id,
                    payload={
                        "dataset_id": document_ref.dataset.dataset_id,
                        "document_id": document_ref.document_id,
                        "segment_ids": list(unique_ids),
                        "generation": generation,
                        "job_id": batch_job_id,
                        "repair": True,
                    },
                )
                enqueued = True
            elif document.enabled and not document.archived and document.indexing_status == IndexingStatus.COMPLETED:
                enqueued = bool(_enqueue_current_segment_status_repairs(session, document_ref, current_segments))
                if batch_job_id is not None:
                    # The random generation guarantees the successor can only
                    # cancel the superseded import batch; current status intents
                    # above own any provider reconciliation.
                    enqueue_knowledge_task(
                        session,
                        kind=KnowledgeTaskKind.SEGMENT_INDEX_CREATE,
                        tenant_id=document_ref.dataset.tenant_id,
                        dataset_id=document_ref.dataset.dataset_id,
                        document_id=document_ref.document_id,
                        resource_id=document_ref.document_id,
                        payload={
                            "dataset_id": document_ref.dataset.dataset_id,
                            "document_id": document_ref.document_id,
                            "segment_ids": list(unique_ids),
                            "generation": str(uuid4()),
                            "job_id": batch_job_id,
                            "repair": True,
                        },
                    )
                    enqueued = True
            if enqueued:
                self._wake_after_commit(session)
            return enqueued

    def enqueue_child_reconcile_repair(
        self,
        segment_ref: SegmentRef,
        *,
        delete_node_ids: Sequence[str],
        completion: SegmentChildIndexCompletion | None,
    ) -> bool:
        """Persist a child-index successor using the current parent generation."""

        with self._session_factory.begin() as session:
            if lock_dataset_for_child_write(session, segment_ref.document.dataset) is None:
                return False
            document = _lock_document(session, segment_ref.document)
            if (
                document is None
                or not document.enabled
                or document.archived
                or document.indexing_status != IndexingStatus.COMPLETED
            ):
                return False
            segment = _get_segment(session, segment_ref, lock=True)
            if (
                segment is None
                or segment.indexing_generation is None
                or segment.status not in {SegmentStatus.INDEXING, SegmentStatus.COMPLETED, SegmentStatus.ERROR}
            ):
                return False
            if segment.status == SegmentStatus.ERROR:
                repaired = _enqueue_current_segment_status_repairs(session, segment_ref.document, (segment,))
                if repaired:
                    self._wake_after_commit(session)
                return bool(repaired)
            current_child_node_ids = session.scalars(
                select(ChildChunk.index_node_id).where(
                    ChildChunk.tenant_id == segment_ref.document.dataset.tenant_id,
                    ChildChunk.dataset_id == segment_ref.document.dataset.dataset_id,
                    ChildChunk.document_id == segment_ref.document.document_id,
                    ChildChunk.segment_id == segment_ref.segment_id,
                    ChildChunk.index_node_id.is_not(None),
                )
            ).all()
            repair_delete_node_ids = list(
                dict.fromkeys(
                    [
                        *delete_node_ids,
                        *(node_id for node_id in current_child_node_ids if node_id is not None),
                    ]
                )
            )
            batch_segment_ids = completion.batch_segment_ids if completion is not None else (segment_ref.segment_id,)
            enqueue_knowledge_task(
                session,
                kind=KnowledgeTaskKind.SEGMENT_INDEX_RECONCILE,
                tenant_id=segment_ref.document.dataset.tenant_id,
                dataset_id=segment_ref.document.dataset.dataset_id,
                document_id=segment_ref.document.document_id,
                resource_id=segment_ref.segment_id,
                payload={
                    "tenant_id": segment_ref.document.dataset.tenant_id,
                    "dataset_id": segment_ref.document.dataset.dataset_id,
                    "document_id": segment_ref.document.document_id,
                    "segment_id": segment_ref.segment_id,
                    "delete_node_ids": repair_delete_node_ids,
                    "parent_generation": segment.indexing_generation,
                    "batch_segment_ids": list(batch_segment_ids),
                    "job_id": completion.batch_job_id if completion is not None else None,
                    "expected_enabled": segment.enabled,
                    "repair": True,
                },
            )
            self._wake_after_commit(session)
            return True

    def complete_child_reconcile(
        self,
        segment_ref: SegmentRef,
        completion: SegmentChildIndexCompletion,
    ) -> SegmentIndexReconcileOutcome:
        """Complete one parent only after its committed children reached the vector store."""

        with self._session_factory.begin() as session:
            if lock_dataset_for_child_write(session, segment_ref.document.dataset) is None:
                return SegmentIndexReconcileOutcome.CANCELLED
            if _lock_document(session, segment_ref.document) is None:
                return SegmentIndexReconcileOutcome.CANCELLED
            segment = _get_segment(session, segment_ref, lock=True)
            if (
                segment is None
                or segment.indexing_generation != completion.generation
                or segment.enabled != completion.expected_enabled
            ):
                return SegmentIndexReconcileOutcome.CANCELLED
            if segment.status == SegmentStatus.INDEXING:
                segment.status = SegmentStatus.COMPLETED
                segment.completed_at = naive_utc_now()
                segment.error = None
            elif segment.status != SegmentStatus.COMPLETED:
                return SegmentIndexReconcileOutcome.CANCELLED

            expected_ids = set(completion.batch_segment_ids)
            if not expected_ids:
                return SegmentIndexReconcileOutcome.COMPLETED
            batch = session.scalars(
                select(DocumentSegment)
                .where(
                    DocumentSegment.tenant_id == segment_ref.document.dataset.tenant_id,
                    DocumentSegment.dataset_id == segment_ref.document.dataset.dataset_id,
                    DocumentSegment.document_id == segment_ref.document.document_id,
                    DocumentSegment.id.in_(expected_ids),
                )
                .with_for_update()
            ).all()
            if {row.id for row in batch} != expected_ids:
                return SegmentIndexReconcileOutcome.CANCELLED
            if any(
                row.indexing_generation != completion.generation or row.enabled != completion.expected_enabled
                for row in batch
            ):
                return SegmentIndexReconcileOutcome.CANCELLED
            if all(row.status == SegmentStatus.COMPLETED for row in batch):
                return SegmentIndexReconcileOutcome.COMPLETED
            if all(row.status in {SegmentStatus.INDEXING, SegmentStatus.COMPLETED} for row in batch):
                return SegmentIndexReconcileOutcome.WAITING
            return SegmentIndexReconcileOutcome.CANCELLED

    def fail_child_reconcile(
        self,
        segment_ref: SegmentRef,
        completion: SegmentChildIndexCompletion,
        *,
        error: str,
    ) -> bool:
        """Fail only the parent generation owned by the exhausted child intent."""

        with self._session_factory.begin() as session:
            if lock_dataset_for_child_write(session, segment_ref.document.dataset) is None:
                return False
            if _lock_document(session, segment_ref.document) is None:
                return False
            segment = _get_segment(session, segment_ref, lock=True)
            if (
                segment is None
                or segment.indexing_generation != completion.generation
                or segment.status != SegmentStatus.INDEXING
                or segment.enabled != completion.expected_enabled
            ):
                return False
            now = naive_utc_now()
            segment.enabled = False
            segment.disabled_at = now
            segment.status = SegmentStatus.ERROR
            segment.completed_at = None
            segment.error = error[:4000]
            return True

    def set_segments(self, document_ref: DocumentRef, segment_ids: Sequence[str], values: Mapping[str, object]) -> None:
        if not segment_ids:
            return
        with self._session_factory.begin() as session:
            session.execute(
                update(DocumentSegment)
                .where(
                    DocumentSegment.tenant_id == document_ref.dataset.tenant_id,
                    DocumentSegment.dataset_id == document_ref.dataset.dataset_id,
                    DocumentSegment.document_id == document_ref.document_id,
                    DocumentSegment.id.in_(segment_ids),
                )
                .values(**values)
            )

    def set_segment_status(
        self,
        document_ref: DocumentRef,
        segment_ids: Sequence[str],
        *,
        action: Literal["enable", "disable"],
        actor_id: str,
    ) -> None:
        """Persist segment status and its indexing intent in one transaction."""

        if not segment_ids:
            return
        if action not in {"enable", "disable"}:
            raise ValueError(f"Unsupported segment status action: {action}")
        enabled = action == "enable"
        with self._session_factory.begin() as session:
            if lock_dataset_for_child_write(session, document_ref.dataset) is None:
                raise LookupError("Dataset no longer exists")
            if _lock_document(session, document_ref) is None:
                raise LookupError("Document no longer exists")
            now = naive_utc_now()
            generation = str(uuid4())
            candidates = session.execute(
                _segment_status_candidates_query(
                    document_ref,
                    tuple(dict.fromkeys(segment_ids)),
                    enabled=enabled,
                )
            ).all()
            if any(status == SegmentStatus.INDEXING for _, status in candidates):
                raise SegmentIndexingMutationError("Segment is indexing, please try again later")
            updated_segment_ids = [segment_id for segment_id, _ in candidates]
            if not updated_segment_ids:
                return
            session.execute(
                _segment_status_update_statement(
                    document_ref,
                    updated_segment_ids,
                    enabled=enabled,
                    actor_id=actor_id,
                    now=now,
                    generation=generation,
                )
            )
            enqueue_knowledge_task(
                session,
                kind=(KnowledgeTaskKind.SEGMENT_INDEX_ENABLE if enabled else KnowledgeTaskKind.SEGMENT_INDEX_DISABLE),
                tenant_id=document_ref.dataset.tenant_id,
                dataset_id=document_ref.dataset.dataset_id,
                document_id=document_ref.document_id,
                payload={
                    "segment_ids": updated_segment_ids,
                    "dataset_id": document_ref.dataset.dataset_id,
                    "document_id": document_ref.document_id,
                    "expected_enabled": enabled,
                    "generation": generation,
                },
            )
            self._wake_after_commit(session)

    def save_segment(self, segment_ref: SegmentRef, values: Mapping[str, object]) -> None:
        with self._session_factory.begin() as session:
            dataset = lock_dataset_for_child_write(session, segment_ref.document.dataset)
            if dataset is None:
                raise LookupError("Dataset no longer exists")
            document = _lock_document(session, segment_ref.document)
            if document is None:
                raise LookupError("Document no longer exists")
            segment = _get_segment(session, segment_ref, lock=True)
            previous_words = segment.word_count if segment is not None else 0
            if segment is None:
                raise LookupError("Segment no longer exists")
            if segment.status == SegmentStatus.INDEXING:
                raise SegmentIndexingMutationError("Segment is indexing, please try again later")
            for key, value in values.items():
                setattr(segment, key, value)
            cleanup_files = ()
            if "content" in values:
                cleanup_files = replace_segment_image_upload_file_references(
                    session,
                    tenant_id=segment_ref.document.dataset.tenant_id,
                    dataset_id=segment_ref.document.dataset.dataset_id,
                    document_id=segment_ref.document.document_id,
                    segment_id=segment_ref.segment_id,
                    content=segment.content,
                )
            if "word_count" in values:
                document.word_count = max(0, (document.word_count or 0) + segment.word_count - previous_words)
            if cleanup_files:
                enqueue_upload_file_cleanup(
                    session,
                    segment_ref.document,
                    tuple(file.id for file in cleanup_files),
                )
                self._wake_after_commit(session)

    def delete_segments(self, document_ref: DocumentRef, segment_ids: Sequence[str]) -> None:
        if not segment_ids:
            return
        with self._session_factory.begin() as session:
            dataset = lock_dataset_for_child_write(session, document_ref.dataset)
            if dataset is None:
                raise LookupError("Dataset no longer exists")
            document = _lock_document(session, document_ref)
            if document is None:
                raise LookupError("Document no longer exists")
            rows = session.scalars(
                select(DocumentSegment)
                .where(
                    DocumentSegment.tenant_id == document_ref.dataset.tenant_id,
                    DocumentSegment.dataset_id == document_ref.dataset.dataset_id,
                    DocumentSegment.document_id == document_ref.document_id,
                    DocumentSegment.id.in_(segment_ids),
                )
                .with_for_update()
            ).all()
            row_ids = [row.id for row in rows]
            if not row_ids:
                return
            children = session.scalars(_children_query(document_ref, row_ids).with_for_update()).all()
            summaries = session.scalars(
                select(DocumentSegmentSummary)
                .where(
                    DocumentSegmentSummary.dataset_id == document_ref.dataset.dataset_id,
                    DocumentSegmentSummary.document_id == document_ref.document_id,
                    DocumentSegmentSummary.chunk_id.in_(row_ids),
                )
                .with_for_update()
            ).all()
            cleanup_manifest = detach_segment_file_references(
                session,
                tenant_id=document_ref.dataset.tenant_id,
                dataset_id=document_ref.dataset.dataset_id,
                document_id=document_ref.document_id,
                segment_ids=row_ids,
            )
            document.word_count = max(0, (document.word_count or 0) - sum(row.word_count for row in rows))
            session.execute(
                delete(ChildChunk).where(
                    ChildChunk.tenant_id == document_ref.dataset.tenant_id,
                    ChildChunk.dataset_id == document_ref.dataset.dataset_id,
                    ChildChunk.document_id == document_ref.document_id,
                    ChildChunk.segment_id.in_(row_ids),
                )
            )
            session.execute(
                delete(DocumentSegmentSummary).where(
                    DocumentSegmentSummary.dataset_id == document_ref.dataset.dataset_id,
                    DocumentSegmentSummary.document_id == document_ref.document_id,
                    DocumentSegmentSummary.chunk_id.in_(row_ids),
                )
            )
            for row in rows:
                session.delete(row)
            enqueue_knowledge_task(
                session,
                kind=KnowledgeTaskKind.SEGMENT_DELETE_CLEANUP,
                tenant_id=document_ref.dataset.tenant_id,
                dataset_id=document_ref.dataset.dataset_id,
                document_id=document_ref.document_id,
                resource_id=document_ref.document_id,
                payload={
                    "dataset_id": document_ref.dataset.dataset_id,
                    "document_id": document_ref.document_id,
                    "segment_ids": row_ids,
                    "index_node_ids": [row.index_node_id for row in rows if row.index_node_id],
                    "child_node_ids": [child.index_node_id for child in children if child.index_node_id],
                    "summary_node_ids": [
                        summary.summary_index_node_id for summary in summaries if summary.summary_index_node_id
                    ],
                    "cleanup_manifest": cleanup_manifest.to_payload(),
                },
            )
            self._wake_after_commit(session)

    def get_children(self, segment_ref: SegmentRef) -> tuple[ChildChunkState, ...] | None:
        with self._session_factory() as session:
            if _get_segment(session, segment_ref) is None:
                return None
            children = session.scalars(
                _children_query(segment_ref.document, (segment_ref.segment_id,)).order_by(ChildChunk.position.asc())
            ).all()
            return tuple(_child_state(child) for child in children)

    def save_children(
        self,
        segment_ref: SegmentRef,
        *,
        added: Sequence[ChildChunkState] = (),
        updated: Sequence[ChildChunkState] = (),
        deleted: Sequence[ChildChunkState] = (),
        completion: SegmentChildIndexCompletion | None = None,
    ) -> str | None:
        has_changes = bool(added or updated or deleted)
        with self._session_factory.begin() as session:
            if lock_dataset_for_child_write(session, segment_ref.document.dataset) is None:
                raise LookupError("Dataset no longer exists")
            if _lock_document(session, segment_ref.document) is None:
                raise LookupError("Document no longer exists")
            segment = _get_segment(session, segment_ref, lock=True)
            if segment is None:
                raise LookupError("Segment no longer exists")
            if completion is None and segment.status == SegmentStatus.INDEXING:
                raise SegmentIndexingMutationError("Segment is indexing, please try again later")
            recovering = completion is None and segment.status == SegmentStatus.ERROR
            if not has_changes and not recovering and completion is None:
                return None
            for child in deleted:
                row = _get_child_chunk(session, segment_ref, child.data.id)
                if row is not None:
                    session.delete(row)
            for child in updated:
                row = _get_child_chunk(session, segment_ref, child.data.id)
                if row is None:
                    raise LookupError("Child chunk no longer exists")
                row.content = child.data.content
                row.word_count = child.data.word_count
                row.type = SegmentType(child.data.type)
                row.updated_by = child.updated_by
                row.updated_at = child.data.updated_at
            for child in added:
                row = ChildChunk(
                    **child.data.model_dump(exclude={"id", "created_at", "updated_at"}),
                    tenant_id=segment_ref.document.dataset.tenant_id,
                    dataset_id=segment_ref.document.dataset.dataset_id,
                    document_id=segment_ref.document.document_id,
                    index_node_id=child.index_node_id,
                    index_node_hash=child.index_node_hash,
                    created_by=child.created_by,
                )
                row.id = child.data.id
                row.created_at = child.data.created_at
                row.updated_at = child.data.updated_at
                row.updated_by = child.updated_by
                session.add(row)
            effective_completion = completion
            recovered_delete_node_ids: tuple[str, ...] = ()
            expected_enabled = segment.enabled
            if effective_completion is None:
                previous_generation = segment.indexing_generation
                if recovering and previous_generation is not None:
                    recovered_delete_node_ids, expected_enabled = _failed_child_reconcile_state(
                        session,
                        segment_ref,
                        generation=previous_generation,
                    )
                generation = str(uuid4())
                effective_completion = SegmentChildIndexCompletion(
                    generation,
                    (segment_ref.segment_id,),
                    expected_enabled=expected_enabled,
                )
                segment.enabled = expected_enabled
                if expected_enabled:
                    segment.disabled_at = None
                    segment.disabled_by = None
                segment.status = SegmentStatus.INDEXING
                segment.indexing_at = naive_utc_now()
                segment.indexing_generation = generation
                segment.completed_at = None
                segment.error = None
            session.flush()
            current_child_node_ids = (
                tuple(
                    node_id
                    for node_id in session.scalars(
                        select(ChildChunk.index_node_id).where(
                            ChildChunk.tenant_id == segment_ref.document.dataset.tenant_id,
                            ChildChunk.dataset_id == segment_ref.document.dataset.dataset_id,
                            ChildChunk.document_id == segment_ref.document.document_id,
                            ChildChunk.segment_id == segment_ref.segment_id,
                            ChildChunk.index_node_id.is_not(None),
                        )
                    ).all()
                    if node_id is not None
                )
                if recovering
                else ()
            )
            delete_node_ids = tuple(
                dict.fromkeys(
                    [
                        *(child.index_node_id for child in (*updated, *deleted) if child.index_node_id is not None),
                        *recovered_delete_node_ids,
                        *current_child_node_ids,
                    ]
                )
            )
            intent_id = enqueue_knowledge_task(
                session,
                kind=KnowledgeTaskKind.SEGMENT_INDEX_RECONCILE,
                tenant_id=segment_ref.document.dataset.tenant_id,
                dataset_id=segment_ref.document.dataset.dataset_id,
                document_id=segment_ref.document.document_id,
                resource_id=segment_ref.segment_id,
                payload={
                    "tenant_id": segment_ref.document.dataset.tenant_id,
                    "dataset_id": segment_ref.document.dataset.dataset_id,
                    "document_id": segment_ref.document.document_id,
                    "segment_id": segment_ref.segment_id,
                    "delete_node_ids": list(delete_node_ids),
                    "parent_generation": effective_completion.generation,
                    "batch_segment_ids": list(effective_completion.batch_segment_ids),
                    "job_id": effective_completion.batch_job_id,
                    "expected_enabled": effective_completion.expected_enabled,
                },
            )
            self._wake_after_commit(session)
            return intent_id

    def get_indexing_snapshot(self, segment_ref: SegmentRef) -> SegmentIndexingSnapshot:
        return self.get_indexing_snapshots(segment_ref.document, (segment_ref.segment_id,))[0]

    def get_dataset_indexing_snapshot(self, dataset_ref: DatasetRef) -> DatasetIndexingSnapshot | None:
        """Load enough dataset state to remove stale nodes after their segment was deleted."""

        with self._session_factory() as session:
            dataset = _get_dataset(session, dataset_ref)
            if dataset is None:
                return None
            vector_type = (
                Vector.resolve_vector_type(dataset, session=session)
                if dataset.indexing_technique == "high_quality"
                else None
            )
            return DatasetIndexingSnapshot(dataset=dataset, vector_type=vector_type)

    def get_indexing_snapshots(
        self, document_ref: DocumentRef, segment_ids: Sequence[str]
    ) -> tuple[SegmentIndexingSnapshot, ...]:
        """Load an ordered batch and its owner chain in one bounded read session."""
        if not segment_ids:
            return ()
        with self._session_factory() as session:
            dataset, document = _require_scope_models(session, document_ref)
            segments = {
                segment.id: segment
                for segment in session.scalars(
                    select(DocumentSegment).where(
                        DocumentSegment.tenant_id == dataset.tenant_id,
                        DocumentSegment.dataset_id == dataset.id,
                        DocumentSegment.document_id == document.id,
                        DocumentSegment.id.in_(segment_ids),
                    )
                )
            }
            if set(segments) != set(segment_ids):
                raise LookupError("Segment no longer exists")
            rule = (
                session.scalar(
                    select(DatasetProcessRule).where(
                        DatasetProcessRule.id == document.dataset_process_rule_id,
                        DatasetProcessRule.dataset_id == dataset.id,
                    )
                )
                if document.dataset_process_rule_id
                else None
            )
            vector_type = (
                Vector.resolve_vector_type(dataset, session=session)
                if dataset.indexing_technique == "high_quality"
                else None
            )
            attachments: dict[str, list[str]] = {segment_id: [] for segment_id in segment_ids}
            for binding in session.scalars(
                select(SegmentAttachmentBinding).where(
                    SegmentAttachmentBinding.tenant_id == dataset.tenant_id,
                    SegmentAttachmentBinding.dataset_id == dataset.id,
                    SegmentAttachmentBinding.document_id == document.id,
                    SegmentAttachmentBinding.segment_id.in_(segment_ids),
                )
            ):
                attachments[binding.segment_id].append(binding.attachment_id)
            summaries = {
                summary.chunk_id: summary
                for summary in session.scalars(
                    select(DocumentSegmentSummary).where(
                        DocumentSegmentSummary.dataset_id == dataset.id,
                        DocumentSegmentSummary.document_id == document.id,
                        DocumentSegmentSummary.chunk_id.in_(segment_ids),
                    )
                )
            }
            return tuple(
                SegmentIndexingSnapshot(
                    dataset,
                    document,
                    segments[segment_id],
                    rule,
                    vector_type,
                    summaries.get(segment_id),
                    tuple(attachments[segment_id]),
                )
                for segment_id in segment_ids
            )

    def replace_attachments(self, segment_ref: SegmentRef, attachment_ids: Sequence[str]) -> None:
        with self._session_factory.begin() as session:
            if lock_dataset_for_child_write(session, segment_ref.document.dataset) is None:
                raise LookupError("Dataset no longer exists")
            if _lock_document(session, segment_ref.document) is None:
                raise LookupError("Document no longer exists")
            if _get_segment(session, segment_ref, lock=True) is None:
                raise LookupError("Segment no longer exists")
            cleanup_files = replace_segment_attachment_bindings(
                session,
                tenant_id=segment_ref.document.dataset.tenant_id,
                dataset_id=segment_ref.document.dataset.dataset_id,
                document_id=segment_ref.document.document_id,
                segment_id=segment_ref.segment_id,
                attachment_ids=attachment_ids,
            )
            if cleanup_files:
                enqueue_upload_file_cleanup(
                    session,
                    segment_ref.document,
                    tuple(file.id for file in cleanup_files),
                )
                self._wake_after_commit(session)

    def filter_attachment_ids_without_active_references(
        self,
        document_ref: DocumentRef,
        attachment_ids: Sequence[str],
        *,
        excluding_segment_ids: Sequence[str] = (),
    ) -> tuple[str, ...]:
        with self._session_factory() as session:
            return filter_attachment_ids_without_active_references(
                session,
                document_ref.dataset,
                attachment_ids,
                excluding_segment_ids=excluding_segment_ids,
            )

    def get_keyword_table(self, dataset_ref: DatasetRef) -> tuple[str, str | None]:
        with self._session_factory() as session:
            dataset = _get_dataset(session, dataset_ref)
            if dataset is None:
                raise LookupError("Dataset no longer exists")
            row = get_dataset_keyword_table(dataset, session=session)
            return (row.data_source_type, row.keyword_table) if row else (dify_config.KEYWORD_DATA_SOURCE_TYPE, None)

    def save_keyword_table(
        self, dataset_ref: DatasetRef, *, storage_type: str, data: str, keywords: Mapping[str, Sequence[str]]
    ) -> None:
        with self._session_factory.begin() as session:
            persist_keyword_table(
                session,
                tenant_id=dataset_ref.tenant_id,
                dataset_id=dataset_ref.dataset_id,
                storage_type=storage_type,
                data=data,
                keywords=keywords,
            )


def delete_document_segments_for_replacement(
    session: Session,
    document_ref: DocumentRef,
    *,
    owner_locks_held: bool = False,
) -> tuple[str, ...]:
    """Remove one document's segment graph after locking its complete owner chain."""

    if not owner_locks_held:
        if lock_dataset_for_child_write(session, document_ref.dataset) is None:
            raise LookupError("Dataset no longer exists")
        if _lock_document(session, document_ref) is None:
            raise LookupError("Document no longer exists")
    rows = tuple(
        session.scalars(
            select(DocumentSegment)
            .where(
                DocumentSegment.tenant_id == document_ref.dataset.tenant_id,
                DocumentSegment.dataset_id == document_ref.dataset.dataset_id,
                DocumentSegment.document_id == document_ref.document_id,
            )
            .order_by(DocumentSegment.id)
            .with_for_update()
        ).all()
    )
    segment_ids = tuple(row.id for row in rows)
    if not segment_ids:
        return ()
    session.scalars(_children_query(document_ref, segment_ids).order_by(ChildChunk.id).with_for_update()).all()
    manifest = detach_segment_file_references(
        session,
        tenant_id=document_ref.dataset.tenant_id,
        dataset_id=document_ref.dataset.dataset_id,
        document_id=document_ref.document_id,
        segment_ids=segment_ids,
    )
    session.execute(
        delete(ChildChunk).where(
            ChildChunk.tenant_id == document_ref.dataset.tenant_id,
            ChildChunk.dataset_id == document_ref.dataset.dataset_id,
            ChildChunk.document_id == document_ref.document_id,
            ChildChunk.segment_id.in_(segment_ids),
        )
    )
    session.execute(
        delete(DocumentSegmentSummary).where(
            DocumentSegmentSummary.dataset_id == document_ref.dataset.dataset_id,
            DocumentSegmentSummary.document_id == document_ref.document_id,
            DocumentSegmentSummary.chunk_id.in_(segment_ids),
        )
    )
    for row in rows:
        session.delete(row)
    session.flush()
    return tuple(
        dict.fromkeys(
            [
                *(file.id for file in manifest.image_files),
                *(attachment.attachment_id for attachment in manifest.segment_attachments),
            ]
        )
    )


def enqueue_upload_file_cleanup(
    session: Session,
    document_ref: DocumentRef,
    file_ids: Sequence[str],
) -> str | None:
    """Persist cleanup of detached file candidates in the caller's transaction."""

    unique_file_ids = tuple(dict.fromkeys(file_id for file_id in file_ids if file_id))
    if not unique_file_ids:
        return None
    return enqueue_knowledge_task(
        session,
        kind=KnowledgeTaskKind.FILE_CLEANUP,
        tenant_id=document_ref.dataset.tenant_id,
        dataset_id=document_ref.dataset.dataset_id,
        document_id=document_ref.document_id,
        resource_id=document_ref.document_id,
        payload={"file_ids": list(unique_file_ids)},
    )


def _failed_child_reconcile_state(
    session: Session,
    segment_ref: SegmentRef,
    *,
    generation: str,
) -> tuple[tuple[str, ...], bool]:
    """Recover stale vector IDs from the exhausted intent owned by a parent generation."""

    rows = session.scalars(
        select(KnowledgeTaskOutbox)
        .where(
            KnowledgeTaskOutbox.tenant_id == segment_ref.document.dataset.tenant_id,
            KnowledgeTaskOutbox.dataset_id == segment_ref.document.dataset.dataset_id,
            KnowledgeTaskOutbox.document_id == segment_ref.document.document_id,
            KnowledgeTaskOutbox.resource_id == segment_ref.segment_id,
            KnowledgeTaskOutbox.task_kind == KnowledgeTaskKind.SEGMENT_INDEX_RECONCILE,
            KnowledgeTaskOutbox.status == "failed",
        )
        .order_by(KnowledgeTaskOutbox.created_at.desc(), KnowledgeTaskOutbox.id.desc())
    ).all()
    delete_node_ids: list[str] = []
    expected_enabled = True
    found_generation = False
    for row in rows:
        if row.payload.get("parent_generation") != generation:
            continue
        if not found_generation:
            payload_expected_enabled = row.payload.get("expected_enabled")
            expected_enabled = payload_expected_enabled if isinstance(payload_expected_enabled, bool) else True
            found_generation = True
        payload_ids = row.payload.get("delete_node_ids")
        if isinstance(payload_ids, list):
            delete_node_ids.extend(node_id for node_id in payload_ids if isinstance(node_id, str) and node_id)
    return tuple(dict.fromkeys(delete_node_ids)), expected_enabled


@dataclass(frozen=True)
class DatasetIndexingSnapshot:
    dataset: Dataset
    vector_type: str | None


@dataclass(frozen=True)
class SegmentIndexingSnapshot:
    dataset: Dataset
    document: Document
    segment: DocumentSegment
    process_rule: DatasetProcessRule | None
    vector_type: str | None
    summary: DocumentSegmentSummary | None
    attachment_ids: tuple[str, ...]


def _summary(session: Session, segment: DocumentSegment) -> DocumentSegmentSummary | None:
    return session.scalar(
        select(DocumentSegmentSummary)
        .where(
            DocumentSegmentSummary.dataset_id == segment.dataset_id,
            DocumentSegmentSummary.document_id == segment.document_id,
            DocumentSegmentSummary.chunk_id == segment.id,
        )
        .limit(1)
    )


def filter_attachment_ids_without_active_references(
    session: Session,
    dataset_ref: DatasetRef,
    attachment_ids: Sequence[str],
    *,
    excluding_segment_ids: Sequence[str] = (),
) -> tuple[str, ...]:
    """Return attachment vectors no other active knowledge segment needs."""

    candidates = tuple(dict.fromkeys(attachment_ids))
    if not candidates:
        return ()
    statement = (
        select(SegmentAttachmentBinding.attachment_id)
        .join(
            DocumentSegment,
            (
                (DocumentSegment.id == SegmentAttachmentBinding.segment_id)
                & (DocumentSegment.tenant_id == SegmentAttachmentBinding.tenant_id)
                & (DocumentSegment.dataset_id == SegmentAttachmentBinding.dataset_id)
                & (DocumentSegment.document_id == SegmentAttachmentBinding.document_id)
            ),
        )
        .join(
            Document,
            (
                (Document.id == DocumentSegment.document_id)
                & (Document.tenant_id == DocumentSegment.tenant_id)
                & (Document.dataset_id == DocumentSegment.dataset_id)
            ),
        )
        .where(
            SegmentAttachmentBinding.tenant_id == dataset_ref.tenant_id,
            SegmentAttachmentBinding.dataset_id == dataset_ref.dataset_id,
            SegmentAttachmentBinding.attachment_id.in_(candidates),
            DocumentSegment.enabled.is_(True),
            DocumentSegment.status.in_((SegmentStatus.COMPLETED, SegmentStatus.INDEXING)),
            Document.enabled.is_(True),
            Document.archived.is_(False),
            Document.indexing_status.in_((IndexingStatus.COMPLETED, IndexingStatus.INDEXING)),
        )
        .distinct()
    )
    if excluding_segment_ids:
        statement = statement.where(DocumentSegment.id.not_in(excluding_segment_ids))
    referenced = set(session.scalars(statement))
    return tuple(file_id for file_id in candidates if file_id not in referenced)


def _children_query(document_ref: DocumentRef, segment_ids: Sequence[str]):
    return select(ChildChunk).where(
        ChildChunk.tenant_id == document_ref.dataset.tenant_id,
        ChildChunk.dataset_id == document_ref.dataset.dataset_id,
        ChildChunk.document_id == document_ref.document_id,
        ChildChunk.segment_id.in_(segment_ids),
    )


def _segment_status_candidates_query(
    document_ref: DocumentRef,
    segment_ids: Sequence[str],
    *,
    enabled: bool,
):
    return (
        select(DocumentSegment.id, DocumentSegment.status)
        .where(
            DocumentSegment.tenant_id == document_ref.dataset.tenant_id,
            DocumentSegment.dataset_id == document_ref.dataset.dataset_id,
            DocumentSegment.document_id == document_ref.document_id,
            DocumentSegment.id.in_(segment_ids),
            or_(
                DocumentSegment.enabled.is_(not enabled),
                DocumentSegment.status == SegmentStatus.ERROR,
            ),
        )
        .with_for_update()
    )


def _segment_status_update_statement(
    document_ref: DocumentRef,
    segment_ids: Sequence[str],
    *,
    enabled: bool,
    actor_id: str,
    now,
    generation: str,
):
    return (
        update(DocumentSegment)
        .where(
            DocumentSegment.tenant_id == document_ref.dataset.tenant_id,
            DocumentSegment.dataset_id == document_ref.dataset.dataset_id,
            DocumentSegment.document_id == document_ref.document_id,
            DocumentSegment.id.in_(segment_ids),
        )
        .values(
            enabled=enabled,
            disabled_at=None if enabled else now,
            disabled_by=None if enabled else actor_id,
            status=SegmentStatus.INDEXING,
            error=None,
            indexing_at=now,
            indexing_generation=generation,
            completed_at=None,
        )
    )


def _child_state(child: ChildChunk) -> ChildChunkState:
    return ChildChunkState(
        data=_child_chunk_data(child),
        index_node_id=child.index_node_id,
        index_node_hash=child.index_node_hash,
        created_by=child.created_by,
        updated_by=child.updated_by,
    )


def _detail(session: Session, segment: DocumentSegment, document: Document) -> SegmentDetail[SegmentReadSnapshot]:
    summary = _summary(session, segment)
    return SegmentDetail(
        data=_segment_data(
            segment,
            summary.summary_content if summary else None,
            session,
            _content_file_access((segment,), session)[segment.id],
        ),
        doc_form=str(document.doc_form),
    )


def _require_scope_models(session: Session, document_ref: DocumentRef) -> tuple[Dataset, Document]:
    dataset = _get_dataset(session, document_ref.dataset)
    document = _get_document(session, document_ref)
    if dataset is None or document is None:
        raise LookupError("Dataset document scope no longer exists")
    return dataset, document


def _lock_document(session: Session, document_ref: DocumentRef) -> Document | None:
    return session.scalar(
        select(Document)
        .where(
            Document.id == document_ref.document_id,
            Document.dataset_id == document_ref.dataset.dataset_id,
            Document.tenant_id == document_ref.dataset.tenant_id,
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )


def lock_document_for_segment_creation(session: Session, document_ref: DocumentRef) -> Document | None:
    """Serialize segment creation with dataset deletion and sibling creation."""

    if lock_dataset_for_child_write(session, document_ref.dataset) is None:
        return None
    return _lock_document(session, document_ref)


def _segment_document_creation_state(document: Document | None) -> SegmentDocumentCreationState | None:
    if document is None:
        return None
    return SegmentDocumentCreationState(
        indexing_status=str(document.indexing_status),
        enabled=bool(document.enabled),
        archived=bool(document.archived),
    )


def _is_segment_creation_ready(state: SegmentDocumentCreationState | None) -> bool:
    return state is not None and state.indexing_status == "completed" and state.enabled and not state.archived


def _get_segment(session: Session, segment_ref: SegmentRef, *, lock: bool = False) -> DocumentSegment | None:
    statement = (
        select(DocumentSegment)
        .where(
            DocumentSegment.id == segment_ref.segment_id,
            DocumentSegment.document_id == segment_ref.document.document_id,
            DocumentSegment.dataset_id == segment_ref.document.dataset.dataset_id,
            DocumentSegment.tenant_id == segment_ref.document.dataset.tenant_id,
        )
        .limit(1)
    )
    if lock:
        statement = statement.with_for_update()
    return session.scalar(statement)


def _get_child_chunk(session: Session, segment_ref: SegmentRef, child_chunk_id: str) -> ChildChunk | None:
    return session.scalar(
        select(ChildChunk)
        .where(
            ChildChunk.id == child_chunk_id,
            ChildChunk.segment_id == segment_ref.segment_id,
            ChildChunk.document_id == segment_ref.document.document_id,
            ChildChunk.dataset_id == segment_ref.document.dataset.dataset_id,
            ChildChunk.tenant_id == segment_ref.document.dataset.tenant_id,
        )
        .limit(1)
    )


def _content_file_access(segments: Sequence[DocumentSegment], session: Session) -> dict[str, SegmentFileAccess]:
    """Materialize file access for already scoped rows within their original read transaction."""

    if not segments:
        return {}
    references = {segment.id: segment_content_file_ids(segment.content) for segment in segments}
    upload_ids = {file_id for uploads, _ in references.values() for file_id in uploads}
    tool_ids = {file_id for _, tools in references.values() for file_id in tools}
    allowed_uploads, allowed_tools = get_segment_content_file_ids(
        segments[0],
        upload_ids=upload_ids,
        tool_ids=tool_ids,
        session=session,
    )
    return {
        segment_id: SegmentFileAccess(
            frozenset(segment_uploads & allowed_uploads),
            frozenset(segment_tools & allowed_tools),
        )
        for segment_id, (segment_uploads, segment_tools) in references.items()
    }


def _segment_values(segment: DocumentSegment) -> dict[str, object]:
    """Detach scalar segment fields from the SQLAlchemy identity map."""

    return asdict(segment)


def _segment_data(
    segment: DocumentSegment,
    summary: str | None,
    session: Session,
    file_access: SegmentFileAccess,
) -> SegmentReadSnapshot:
    return SegmentReadSnapshot(
        values=_segment_values(segment),
        summary=summary,
        file_access=file_access,
        child_chunks=tuple(
            ChildChunkRecord.model_validate(child)
            for child in get_segment_child_chunks(segment, session=session, include_full_doc=False)
        ),
        attachments=tuple(
            SegmentAttachmentFile(file.id, file.name, file.size, file.extension, file.mime_type)
            for file in get_segment_attachment_files(segment, session=session)
        ),
    )


def _child_chunk_data(child_chunk: ChildChunk) -> ChildChunkRecord:
    return ChildChunkRecord.model_validate(child_chunk)


def query_child_chunks(
    session: Session,
    segment_ref: SegmentRef,
    *,
    page: int,
    limit: int,
    keyword: str | None,
) -> PaginatedResult[ChildChunk]:
    """Share the query with callers that already own an explicit session."""
    query = _children_query(segment_ref.document, (segment_ref.segment_id,)).order_by(ChildChunk.position.asc())
    if keyword:
        query = query.where(ChildChunk.content.ilike(f"%{escape_like_pattern(keyword)}%", escape="\\"))
    return paginate_query(query, session=session, page=page, per_page=limit, max_per_page=100)
