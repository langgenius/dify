"""SQLAlchemy persistence for tenant-owned segments and their descendants."""

from __future__ import annotations

import json
from collections.abc import Generator, Mapping, Sequence
from contextlib import contextmanager
from dataclasses import asdict, dataclass
from typing import Literal

from sqlalchemy import String, case, delete, func, literal, or_, select, tuple_, update
from sqlalchemy import cast as sql_cast
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.rag.docstore.dataset_docstore import DatasetDocumentStore
from core.rag.index_processor.constant.doc_type import DocType
from core.rag.index_processor.constant.index_type import IndexStructureType
from core.rag.models.document import AttachmentDocument, ChildDocument
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
from models.model import UploadFile
from repositories.file.upload_file_repository import lock_and_validate_owned_upload_files_in_session
from repositories.knowledge.dataset_read_repository import get_dataset_keyword_table, resolve_dataset_vector_type
from repositories.knowledge.dataset_repository import _get_dataset
from repositories.knowledge.document_repository import _get_document, require_indexing_document
from repositories.knowledge.keyword_table_repository import persist_keyword_table
from repositories.knowledge.segment_query_repository import (
    get_content_file_ids,
    get_segment_attachment_files,
    get_segment_child_chunks,
    retrieved_segment_statement,
    segment_content_file_ids,
)
from services.errors.file import UploadFileReferenceNotFoundError
from services.file_reference_parser import extract_upload_file_ids_from_markdown, trusted_upload_file_ids
from services.knowledge.entities.resource_scope import DatasetRef, DocumentRef, SegmentRef
from services.knowledge.entities.segments import (
    ChildChunkRecord,
    SegmentAttachmentFile,
    SegmentFileAccess,
    SegmentReadSnapshot,
    SegmentSummaryImageFile,
)
from services.knowledge.hit_testing.entities import (
    RetrievalAttachmentRecord,
    RetrievalChildRecord,
    RetrievalSegmentRecord,
    RetrievalSnapshot,
)
from services.knowledge.indexing.contracts import (
    PENDING_UPLOAD_CLEANUP_IDS_KEY,
    IndexingDocument,
    pending_upload_cleanup_ids,
)
from services.knowledge.segments.contracts import (
    ChildChunkListFilter,
    ChildChunkPage,
    ChildChunkState,
    SegmentCreateRecord,
    SegmentDetail,
    SegmentDocumentMutationBusyError,
    SegmentIndexTarget,
    SegmentListFilter,
    SegmentPageData,
    SegmentStatusState,
    SegmentStatusTransition,
    SegmentUpdateState,
)


class SQLAlchemySegmentRepository:
    """Read and write scoped segment rows in bounded database transactions."""

    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    def get_retrieval_snapshot(
        self,
        ref: DatasetRef,
        *,
        node_pairs: Sequence[tuple[str, str]],
        summary_pairs: Sequence[tuple[str, str, str]],
        attachment_pairs: Sequence[tuple[str, str]],
    ) -> RetrievalSnapshot:
        if not (node_pairs or summary_pairs or attachment_pairs):
            return RetrievalSnapshot((), (), (), {})
        owned_segments = retrieved_segment_statement(tenant_id=ref.tenant_id, dataset_ids=[ref.dataset_id]).where(
            DocumentSegment.status == SegmentStatus.COMPLETED,
            Document.indexing_status == "completed",
        )
        owned_ids = owned_segments.with_only_columns(DocumentSegment.id)
        summary_segment_pairs = tuple((document_id, segment_id) for document_id, segment_id, _ in summary_pairs)
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
                        tuple_(DocumentSegment.document_id, DocumentSegment.id).in_(summary_segment_pairs),
                        DocumentSegment.id.in_([child.segment_id for child in children]),
                        DocumentSegment.id.in_([binding.segment_id for binding, _ in attachment_rows]),
                    )
                )
            ).all()
            segment_ids = {segment.id for segment in segments}
            summary_segment_ids = {segment_id for _, segment_id, _ in summary_pairs} & segment_ids
            summaries = (
                session.scalars(
                    select(DocumentSegmentSummary)
                    .join(DocumentSegment, DocumentSegment.id == DocumentSegmentSummary.chunk_id)
                    .where(
                        DocumentSegmentSummary.chunk_id.in_(summary_segment_ids),
                        DocumentSegmentSummary.dataset_id == DocumentSegment.dataset_id,
                        DocumentSegmentSummary.document_id == DocumentSegment.document_id,
                        tuple_(
                            DocumentSegmentSummary.document_id,
                            DocumentSegmentSummary.chunk_id,
                            DocumentSegmentSummary.summary_index_node_id,
                        ).in_(summary_pairs),
                        DocumentSegmentSummary.enabled.is_(True),
                        DocumentSegmentSummary.status == SummaryStatus.COMPLETED,
                    )
                ).all()
                if summary_segment_ids
                else []
            )
            return RetrievalSnapshot(
                segments=tuple(
                    RetrievalSegmentRecord(segment.id, segment.document_id, segment.index_node_id, asdict(segment))
                    for segment in segments
                ),
                children=tuple(
                    RetrievalChildRecord(
                        child.id,
                        child.segment_id,
                        child.document_id,
                        child.index_node_id,
                        child.content,
                        child.position,
                    )
                    for child in children
                    if child.segment_id in segment_ids
                ),
                attachments=tuple(
                    RetrievalAttachmentRecord(
                        binding.segment_id,
                        binding.document_id,
                        file.id,
                        file.name,
                        file.extension,
                        file.mime_type,
                        file.size,
                    )
                    for binding, file in attachment_rows
                    if binding.segment_id in segment_ids
                ),
                summaries={
                    (summary.document_id, summary.chunk_id, summary.summary_index_node_id): summary.summary_content
                    for summary in summaries
                    if summary.summary_content and summary.summary_index_node_id
                },
            )

    def save_for_indexing(
        self, document: IndexingDocument, chunks: list[IndexDocument], token_counts: list[int]
    ) -> tuple[str, ...]:
        ref = document.ref
        with self._session_factory.begin() as session:
            row = require_indexing_document(session, ref, lock=True)
            dataset = _get_dataset(session, ref.dataset)
            assert dataset is not None
            lock_and_validate_owned_upload_files_in_session(
                session,
                tenant_id=ref.dataset.tenant_id,
                upload_file_ids=_index_document_upload_file_ids(chunks),
            )
            candidate_file_ids = self._replace_indexing_rows(session, document)
            pending_file_ids = self._merge_pending_upload_cleanup_ids(row, candidate_file_ids)
            DatasetDocumentStore(dataset=dataset, user_id=row.created_by, document_id=row.id).add_documents(
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
        return pending_file_ids

    def get_pending_upload_cleanup_ids(self, document: IndexingDocument) -> tuple[str, ...]:
        with self._session_factory() as session:
            row = require_indexing_document(session, document.ref)
            return self._pending_upload_cleanup_ids(row)

    def acknowledge_upload_cleanup(self, document: IndexingDocument, processed_file_ids: Sequence[str]) -> None:
        processed = frozenset(processed_file_ids)
        if not processed:
            return
        with self._session_factory.begin() as session:
            row = require_indexing_document(session, document.ref, lock=True)
            source_info = dict(row.data_source_info_dict)
            remaining = [file_id for file_id in self._pending_upload_cleanup_ids(row) if file_id not in processed]
            if remaining:
                source_info[PENDING_UPLOAD_CLEANUP_IDS_KEY] = remaining
            else:
                source_info.pop(PENDING_UPLOAD_CLEANUP_IDS_KEY, None)
            row.data_source_info = json.dumps(source_info, ensure_ascii=False)

    @staticmethod
    def _pending_upload_cleanup_ids(document: Document) -> tuple[str, ...]:
        return pending_upload_cleanup_ids(document.data_source_info_dict)

    @classmethod
    def _merge_pending_upload_cleanup_ids(
        cls, document: Document, candidate_file_ids: Sequence[str]
    ) -> tuple[str, ...]:
        pending = tuple(dict.fromkeys((*cls._pending_upload_cleanup_ids(document), *candidate_file_ids)))
        source_info = dict(document.data_source_info_dict)
        if pending:
            source_info[PENDING_UPLOAD_CLEANUP_IDS_KEY] = list(pending)
        else:
            source_info.pop(PENDING_UPLOAD_CLEANUP_IDS_KEY, None)
        document.data_source_info = json.dumps(source_info, ensure_ascii=False)
        return pending

    @staticmethod
    def _replace_indexing_rows(session: Session, document: IndexingDocument) -> tuple[str, ...]:
        """Replace old indexing rows while retaining durable file-cleanup evidence."""

        ref = document.ref
        segments = session.scalars(
            select(DocumentSegment).where(
                DocumentSegment.tenant_id == ref.dataset.tenant_id,
                DocumentSegment.dataset_id == ref.dataset.dataset_id,
                DocumentSegment.document_id == ref.document_id,
            )
        ).all()
        segment_ids = tuple(segment.id for segment in segments)
        candidate_file_ids = [
            file_id
            for segment in segments
            for content in (segment.content, segment.answer or "")
            for file_id in extract_upload_file_ids_from_markdown(content)
        ]
        child_chunks = session.scalars(
            select(ChildChunk).where(
                ChildChunk.tenant_id == ref.dataset.tenant_id,
                ChildChunk.dataset_id == ref.dataset.dataset_id,
                ChildChunk.document_id == ref.document_id,
            )
        ).all()
        candidate_file_ids.extend(
            file_id for child in child_chunks for file_id in extract_upload_file_ids_from_markdown(child.content)
        )
        if segment_ids:
            candidate_file_ids.extend(
                session.scalars(
                    select(SegmentAttachmentBinding.attachment_id).where(
                        SegmentAttachmentBinding.tenant_id == ref.dataset.tenant_id,
                        SegmentAttachmentBinding.dataset_id == ref.dataset.dataset_id,
                        SegmentAttachmentBinding.document_id == ref.document_id,
                        SegmentAttachmentBinding.segment_id.in_(segment_ids),
                    )
                ).all()
            )
            session.execute(
                delete(SegmentAttachmentBinding).where(
                    SegmentAttachmentBinding.tenant_id == ref.dataset.tenant_id,
                    SegmentAttachmentBinding.dataset_id == ref.dataset.dataset_id,
                    SegmentAttachmentBinding.document_id == ref.document_id,
                    SegmentAttachmentBinding.segment_id.in_(segment_ids),
                )
            )
            session.execute(
                delete(DocumentSegmentSummary).where(
                    DocumentSegmentSummary.dataset_id == ref.dataset.dataset_id,
                    DocumentSegmentSummary.document_id == ref.document_id,
                    DocumentSegmentSummary.chunk_id.in_(segment_ids),
                )
            )
        session.execute(
            delete(ChildChunk).where(
                ChildChunk.tenant_id == ref.dataset.tenant_id,
                ChildChunk.dataset_id == ref.dataset.dataset_id,
                ChildChunk.document_id == ref.document_id,
            )
        )
        session.execute(
            delete(DocumentSegment).where(
                DocumentSegment.tenant_id == ref.dataset.tenant_id,
                DocumentSegment.dataset_id == ref.dataset.dataset_id,
                DocumentSegment.document_id == ref.document_id,
            )
        )
        return tuple(dict.fromkeys(candidate_file_ids))

    def resume_indexing(self, document: IndexingDocument) -> tuple[list[IndexDocument], int]:
        ref = document.ref
        with self._session_factory() as session:
            require_indexing_document(session, ref)
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
                chunk.attachments = [
                    AttachmentDocument(
                        page_content=attachment.name,
                        metadata={
                            "doc_id": attachment.id,
                            "doc_hash": "",
                            "document_id": ref.document_id,
                            "dataset_id": ref.dataset.dataset_id,
                            "doc_type": DocType.IMAGE,
                        },
                    )
                    for attachment in get_segment_attachment_files(row, session=session, lock=True)
                ]
                chunks.append(chunk)
            return chunks, sum(row.tokens for row in rows)

    def complete_indexing_segments(self, ref: DocumentRef, node_ids: Sequence[str]) -> None:
        with self._session_factory.begin() as session:
            require_indexing_document(session, ref, lock=True)
            session.execute(
                update(DocumentSegment)
                .where(
                    *self._indexing_scope(ref),
                    DocumentSegment.index_node_id.in_(node_ids),
                    DocumentSegment.status == SegmentStatus.INDEXING,
                )
                .values(status=SegmentStatus.COMPLETED, enabled=True, completed_at=naive_utc_now())
            )

    @staticmethod
    def _indexing_scope(ref: DocumentRef):
        return (
            DocumentSegment.tenant_id == ref.dataset.tenant_id,
            DocumentSegment.dataset_id == ref.dataset.dataset_id,
            DocumentSegment.document_id == ref.document_id,
        )

    def list_segments(
        self, document_ref: DocumentRef, query: SegmentListFilter
    ) -> SegmentPageData[SegmentReadSnapshot]:
        with self._session_factory() as session:
            statement = (
                select(DocumentSegment)
                .join(Document, Document.id == DocumentSegment.document_id)
                .join(Dataset, Dataset.id == Document.dataset_id)
                .where(
                    Dataset.tenant_id == document_ref.dataset.tenant_id,
                    Dataset.id == DocumentSegment.dataset_id,
                    Document.tenant_id == DocumentSegment.tenant_id,
                    Document.dataset_id == DocumentSegment.dataset_id,
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
            children, attachments = _segment_page_relations(session, document_ref, items)
            return SegmentPageData(
                items=tuple(
                    _segment_data(
                        segment,
                        summaries[segment.id].summary_content if segment.id in summaries else None,
                        session,
                        file_access[segment.id],
                        child_chunks=children.get(segment.id, ()),
                        attachments=attachments.get(segment.id, ()),
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
                enabled=segment.enabled,
                keywords=tuple(keywords)
                if isinstance(keywords, list) and all(isinstance(keyword, str) for keyword in keywords)
                else None,
                answer=segment.answer,
                status=str(segment.status),
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
            return tuple(SegmentIndexTarget(segment.id, segment.index_node_id, segment.enabled) for segment in segments)

    def stage_segment_status(
        self,
        document_ref: DocumentRef,
        segment_ids: Sequence[str],
        *,
        action: Literal["enable", "disable"],
        actor_id: str,
    ) -> tuple[SegmentStatusTransition, ...]:
        if not segment_ids:
            return ()
        desired = action == "enable"
        previous: dict[str, SegmentStatusState] = {}
        staged_rows: list[DocumentSegment] = []
        with self._session_factory.begin() as session:
            _, document = _require_scope_models(session, document_ref, lock=True)
            _check_document_mutation_state(document)
            rows = session.scalars(
                select(DocumentSegment)
                .where(
                    DocumentSegment.tenant_id == document_ref.dataset.tenant_id,
                    DocumentSegment.dataset_id == document_ref.dataset.dataset_id,
                    DocumentSegment.document_id == document_ref.document_id,
                    DocumentSegment.id.in_(segment_ids),
                )
                .order_by(DocumentSegment.id)
                .with_for_update()
            ).all()
            for row in rows:
                if row.status != SegmentStatus.COMPLETED:
                    continue
                if row.enabled == desired:
                    continue
                previous[row.id] = _segment_status_state(row)
                staged_rows.append(row)
                row.enabled = desired
                row.disabled_at = None if desired else naive_utc_now().replace(microsecond=0)
                row.disabled_by = None if desired else actor_id
                row.error = None
            session.flush()
            for row in staged_rows:
                session.refresh(row, attribute_names=("enabled", "disabled_at", "disabled_by", "error"))
            transitions = tuple(
                SegmentStatusTransition(previous=previous[row.id], applied=_segment_status_state(row))
                for row in staged_rows
            )
        return transitions

    def restore_segment_status(
        self, document_ref: DocumentRef, transitions: Sequence[SegmentStatusTransition]
    ) -> tuple[str, ...]:
        if not transitions:
            return ()
        transition_by_id = {transition.applied.id: transition for transition in transitions}
        with self._session_factory.begin() as session:
            _require_scope_models(session, document_ref, lock=True)
            rows = session.scalars(
                select(DocumentSegment)
                .where(
                    DocumentSegment.tenant_id == document_ref.dataset.tenant_id,
                    DocumentSegment.dataset_id == document_ref.dataset.dataset_id,
                    DocumentSegment.document_id == document_ref.document_id,
                    DocumentSegment.id.in_(transition_by_id),
                )
                .order_by(DocumentSegment.id)
                .with_for_update()
            ).all()
            restored: list[str] = []
            for row in rows:
                transition = transition_by_id[row.id]
                if _segment_status_state(row) != transition.applied:
                    continue
                previous = transition.previous
                row.enabled = previous.enabled
                row.disabled_at = previous.disabled_at
                row.disabled_by = previous.disabled_by
                row.error = previous.error
                restored.append(row.id)
            return tuple(restored)

    def get_children_for_segments(
        self, document_ref: DocumentRef, segment_ids: Sequence[str]
    ) -> tuple[ChildChunkState, ...]:
        if not segment_ids:
            return ()
        with self._session_factory() as session:
            return tuple(_child_state(child) for child in session.scalars(_children_query(document_ref, segment_ids)))

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

    def create_segments(self, document_ref: DocumentRef, segments: Sequence[SegmentCreateRecord]) -> None:
        if not segments:
            return
        segment_ids = tuple(segment.segment_id for segment in segments)
        if len(set(segment_ids)) != len(segment_ids):
            raise ValueError("Segment IDs must be unique")
        with self._session_factory.begin() as session:
            _, document = _require_scope_models(session, document_ref, lock=True)
            _check_document_mutation_state(document)
            existing_ids = set(
                session.scalars(
                    select(DocumentSegment.id).where(
                        DocumentSegment.tenant_id == document_ref.dataset.tenant_id,
                        DocumentSegment.dataset_id == document_ref.dataset.dataset_id,
                        DocumentSegment.document_id == document_ref.document_id,
                        DocumentSegment.id.in_(segment_ids),
                    )
                )
            )
            if existing_ids:
                raise ValueError("Segment already exists")
            upload_file_ids = {
                file_id
                for segment in segments
                for file_id in (
                    *segment.attachment_ids,
                    *_segment_upload_file_ids(segment.content, segment.answer),
                )
            }
            lock_and_validate_owned_upload_files_in_session(
                session,
                tenant_id=document_ref.dataset.tenant_id,
                upload_file_ids=tuple(sorted(upload_file_ids)),
            )
            position = (
                session.scalar(
                    select(func.max(DocumentSegment.position)).where(
                        DocumentSegment.tenant_id == document_ref.dataset.tenant_id,
                        DocumentSegment.dataset_id == document_ref.dataset.dataset_id,
                        DocumentSegment.document_id == document_ref.document_id,
                    )
                )
                or 0
            )
            rows = []
            bindings = []
            for offset, segment in enumerate(segments, start=1):
                row = DocumentSegment(
                    tenant_id=document_ref.dataset.tenant_id,
                    dataset_id=document_ref.dataset.dataset_id,
                    document_id=document_ref.document_id,
                    position=position + offset,
                    content=segment.content,
                    answer=segment.answer,
                    word_count=segment.word_count,
                    tokens=segment.tokens,
                    index_node_id=segment.index_node_id,
                    index_node_hash=segment.index_node_hash,
                    created_by=segment.created_by,
                    status=SegmentStatus.COMPLETED,
                    indexing_at=segment.indexing_at,
                    completed_at=segment.completed_at,
                )
                row.id = segment.segment_id
                rows.append(row)
                bindings.extend(
                    SegmentAttachmentBinding(
                        tenant_id=document_ref.dataset.tenant_id,
                        dataset_id=document_ref.dataset.dataset_id,
                        document_id=document_ref.document_id,
                        segment_id=segment.segment_id,
                        attachment_id=file_id,
                    )
                    for file_id in segment.attachment_ids
                )
            session.add_all([*rows, *bindings])
            document.word_count = max(0, document.word_count or 0) + sum(segment.word_count for segment in segments)

    def save_segment(self, segment_ref: SegmentRef, values: Mapping[str, object]) -> None:
        with self._session_factory.begin() as session:
            _, document = _require_scope_models(session, segment_ref.document, lock=True)
            _check_document_mutation_state(document)
            segment = _get_segment(session, segment_ref, lock=True)
            if segment is None:
                raise LookupError("Segment no longer exists")
            previous_words = segment.word_count
            previous_file_ids = _segment_upload_file_ids(segment.content, segment.answer)
            next_content = values.get("content", segment.content)
            next_answer = values.get("answer", segment.answer)
            if not isinstance(next_content, str) or (next_answer is not None and not isinstance(next_answer, str)):
                raise ValueError("Segment content and answer must be strings")
            lock_and_validate_owned_upload_files_in_session(
                session,
                tenant_id=segment_ref.document.dataset.tenant_id,
                upload_file_ids=tuple(sorted(_segment_upload_file_ids(next_content, next_answer) - previous_file_ids)),
            )
            for key, value in values.items():
                setattr(segment, key, value)
            if "word_count" in values:
                document.word_count = max(0, (document.word_count or 0) + segment.word_count - previous_words)

    def delete_segments(self, document_ref: DocumentRef, segment_ids: Sequence[str]) -> None:
        if not segment_ids:
            return
        with self._session_factory.begin() as session:
            _, document = _require_scope_models(session, document_ref, lock=True)
            _check_document_mutation_state(document)
            rows = session.scalars(
                select(DocumentSegment).where(
                    DocumentSegment.tenant_id == document_ref.dataset.tenant_id,
                    DocumentSegment.dataset_id == document_ref.dataset.dataset_id,
                    DocumentSegment.document_id == document_ref.document_id,
                    DocumentSegment.id.in_(segment_ids),
                )
            ).all()
            document.word_count = max(0, (document.word_count or 0) - sum(row.word_count for row in rows))
            for row in rows:
                session.delete(row)

    def get_children(self, segment_ref: SegmentRef) -> tuple[ChildChunkState, ...] | None:
        with self._session_factory() as session:
            if _get_segment(session, segment_ref) is None:
                return None
            children = session.scalars(
                _children_query(segment_ref.document, (segment_ref.segment_id,)).order_by(ChildChunk.position.asc())
            ).all()
            return tuple(_child_state(child) for child in children)

    @staticmethod
    def _validate_child_uploads_in_session(
        session: Session,
        segment_ref: SegmentRef,
        *,
        added: Sequence[ChildChunkState],
        updated: Sequence[ChildChunkState],
    ) -> None:
        introduced_file_ids: set[str] = set()
        for child in updated:
            row = _get_child_chunk(session, segment_ref, child.data.id)
            if row is None:
                raise LookupError("Child chunk no longer exists")
            introduced_file_ids.update(
                _segment_upload_file_ids(child.data.content, None) - _segment_upload_file_ids(row.content, None)
            )
        for child in added:
            introduced_file_ids.update(_segment_upload_file_ids(child.data.content, None))
        lock_and_validate_owned_upload_files_in_session(
            session,
            tenant_id=segment_ref.document.dataset.tenant_id,
            upload_file_ids=tuple(sorted(introduced_file_ids)),
        )

    @contextmanager
    def child_mutation(
        self,
        segment_ref: SegmentRef,
        *,
        added: Sequence[ChildChunkState] = (),
        updated: Sequence[ChildChunkState] = (),
        deleted: Sequence[ChildChunkState] = (),
    ) -> Generator[None]:
        """Keep owner/file locks through vector publication and the child commit.

        External I/O is intentionally inside this transaction: otherwise GC can
        remove a validated file before its new child owner is committed.
        """
        with self._session_factory.begin() as session:
            _, document = _require_scope_models(session, segment_ref.document, lock=True)
            _check_document_mutation_state(document)
            if _get_segment(session, segment_ref, lock=True) is None:
                raise LookupError("Segment no longer exists")
            self._validate_child_uploads_in_session(session, segment_ref, added=added, updated=updated)
            yield
            self._save_children_in_session(session, segment_ref, added=added, updated=updated, deleted=deleted)

    def save_children(
        self,
        segment_ref: SegmentRef,
        *,
        added: Sequence[ChildChunkState] = (),
        updated: Sequence[ChildChunkState] = (),
        deleted: Sequence[ChildChunkState] = (),
    ) -> None:
        with self.child_mutation(segment_ref, added=added, updated=updated, deleted=deleted):
            pass

    @staticmethod
    def _save_children_in_session(
        session: Session,
        segment_ref: SegmentRef,
        *,
        added: Sequence[ChildChunkState],
        updated: Sequence[ChildChunkState],
        deleted: Sequence[ChildChunkState],
    ) -> None:
        for child in deleted:
            row = _get_child_chunk(session, segment_ref, child.data.id)
            if row is not None:
                session.delete(row)
        for child in updated:
            row = _get_child_chunk(session, segment_ref, child.data.id)
            assert row is not None
            row.content = child.data.content
            row.index_node_hash = child.index_node_hash
            row.index_node_id = child.index_node_id
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

    def get_indexing_snapshot(self, segment_ref: SegmentRef) -> SegmentIndexingSnapshot:
        return self.get_indexing_snapshots(segment_ref.document, (segment_ref.segment_id,))[0]

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
                resolve_dataset_vector_type(dataset, session=session)
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
            _require_scope_models(session, segment_ref.document, lock=True)
            if _get_segment(session, segment_ref, lock=True) is None:
                raise LookupError("Segment no longer exists")
            lock_and_validate_owned_upload_files_in_session(
                session,
                tenant_id=segment_ref.document.dataset.tenant_id,
                upload_file_ids=attachment_ids,
            )
            session.execute(
                delete(SegmentAttachmentBinding).where(
                    SegmentAttachmentBinding.tenant_id == segment_ref.document.dataset.tenant_id,
                    SegmentAttachmentBinding.dataset_id == segment_ref.document.dataset.dataset_id,
                    SegmentAttachmentBinding.document_id == segment_ref.document.document_id,
                    SegmentAttachmentBinding.segment_id == segment_ref.segment_id,
                )
            )
            session.add_all(
                [
                    SegmentAttachmentBinding(
                        tenant_id=segment_ref.document.dataset.tenant_id,
                        dataset_id=segment_ref.document.dataset.dataset_id,
                        document_id=segment_ref.document.document_id,
                        segment_id=segment_ref.segment_id,
                        attachment_id=file_id,
                    )
                    for file_id in attachment_ids
                ]
            )

    def save_summary(
        self, segment_ref: SegmentRef, content: str | None, *, error: str | None = None
    ) -> DocumentSegmentSummary | None:
        with self._session_factory.begin() as session:
            _require_scope_models(session, segment_ref.document, lock=True)
            segment = _get_segment(session, segment_ref, lock=True)
            if segment is None:
                raise LookupError("Segment no longer exists")
            summary = _summary(session, segment, lock=True)
            if content is None:
                if summary is not None:
                    session.delete(summary)
                return None
            if summary is None:
                summary = DocumentSegmentSummary(
                    dataset_id=segment.dataset_id, document_id=segment.document_id, chunk_id=segment.id
                )
                session.add(summary)
            summary.summary_content = content
            summary.status = SummaryStatus.ERROR if error else SummaryStatus.GENERATING
            summary.error = error
            summary.updated_at = naive_utc_now()
            session.flush()
            session.expunge(summary)
            return summary

    def get_summary_image_files(self, segment_ref: SegmentRef) -> tuple[SegmentSummaryImageFile, ...]:
        with self._session_factory() as session:
            segment = _get_segment(session, segment_ref)
            if segment is None:
                raise LookupError("Segment no longer exists")
            attachment_files = session.scalars(
                select(UploadFile)
                .join(
                    SegmentAttachmentBinding,
                    (SegmentAttachmentBinding.attachment_id == UploadFile.id)
                    & (SegmentAttachmentBinding.tenant_id == UploadFile.tenant_id),
                )
                .where(
                    SegmentAttachmentBinding.tenant_id == segment.tenant_id,
                    SegmentAttachmentBinding.dataset_id == segment.dataset_id,
                    SegmentAttachmentBinding.document_id == segment.document_id,
                    SegmentAttachmentBinding.segment_id == segment.id,
                    UploadFile.tenant_id == segment.tenant_id,
                )
            ).all()
            image_files = [file for file in attachment_files if file.mime_type and "image" in file.mime_type]
            if not image_files:
                markdown_file_ids = tuple(dict.fromkeys(extract_upload_file_ids_from_markdown(segment.content)))
                image_files = (
                    [
                        file
                        for file in session.scalars(
                            select(UploadFile).where(
                                UploadFile.id.in_(markdown_file_ids),
                                UploadFile.tenant_id == segment.tenant_id,
                            )
                        ).all()
                        if file.mime_type and "image" in file.mime_type
                    ]
                    if markdown_file_ids
                    else []
                )
            return tuple(
                SegmentSummaryImageFile(
                    id=file.id,
                    name=file.name,
                    extension=file.extension,
                    mime_type=file.mime_type,
                    size=file.size,
                    storage_key=file.key,
                    source_url=file.source_url,
                )
                for file in image_files
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


@dataclass(frozen=True)
class SegmentIndexingSnapshot:
    dataset: Dataset
    document: Document
    segment: DocumentSegment
    process_rule: DatasetProcessRule | None
    vector_type: str | None
    summary: DocumentSegmentSummary | None
    attachment_ids: tuple[str, ...]


def _summary(session: Session, segment: DocumentSegment, *, lock: bool = False) -> DocumentSegmentSummary | None:
    statement = (
        select(DocumentSegmentSummary)
        .where(
            DocumentSegmentSummary.dataset_id == segment.dataset_id,
            DocumentSegmentSummary.document_id == segment.document_id,
            DocumentSegmentSummary.chunk_id == segment.id,
        )
        .limit(1)
    )
    if lock:
        statement = statement.with_for_update()
    return session.scalar(statement)


def _children_query(document_ref: DocumentRef, segment_ids: Sequence[str]):
    return select(ChildChunk).where(
        ChildChunk.tenant_id == document_ref.dataset.tenant_id,
        ChildChunk.dataset_id == document_ref.dataset.dataset_id,
        ChildChunk.document_id == document_ref.document_id,
        ChildChunk.segment_id.in_(segment_ids),
    )


def _child_state(child: ChildChunk) -> ChildChunkState:
    return ChildChunkState(
        data=_child_chunk_data(child),
        index_node_id=child.index_node_id,
        index_node_hash=child.index_node_hash,
        created_by=child.created_by,
        updated_by=child.updated_by,
    )


def _segment_status_state(segment: DocumentSegment) -> SegmentStatusState:
    return SegmentStatusState(
        id=segment.id,
        enabled=segment.enabled,
        disabled_at=segment.disabled_at,
        disabled_by=segment.disabled_by,
        error=segment.error,
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


def _check_document_mutation_state(document: Document) -> None:
    if (
        not document.enabled
        or document.archived
        or document.indexing_status
        in {
            IndexingStatus.WAITING,
            IndexingStatus.PARSING,
            IndexingStatus.CLEANING,
            IndexingStatus.SPLITTING,
            IndexingStatus.INDEXING,
        }
    ):
        raise SegmentDocumentMutationBusyError("Document is being indexed or is unavailable, please try again later")


def _require_scope_models(
    session: Session, document_ref: DocumentRef, *, lock: bool = False
) -> tuple[Dataset, Document]:
    if lock:
        dataset = session.scalar(
            select(Dataset)
            .where(
                Dataset.id == document_ref.dataset.dataset_id,
                Dataset.tenant_id == document_ref.dataset.tenant_id,
            )
            .with_for_update(read=True)
        )
        document = session.scalar(
            select(Document)
            .where(
                Document.id == document_ref.document_id,
                Document.dataset_id == document_ref.dataset.dataset_id,
                Document.tenant_id == document_ref.dataset.tenant_id,
            )
            .with_for_update()
        )
    else:
        dataset = _get_dataset(session, document_ref.dataset)
        document = _get_document(session, document_ref)
    if dataset is None or document is None:
        raise LookupError("Dataset document scope no longer exists")
    return dataset, document


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
    uploads, tools = get_content_file_ids(
        segments[0].tenant_id,
        upload_ids=upload_ids,
        tool_ids=tool_ids,
        scope=None,
        session=session,
    )
    return {
        segment_id: SegmentFileAccess(frozenset(upload_ids & uploads), frozenset(tool_ids & tools))
        for segment_id, (upload_ids, tool_ids) in references.items()
    }


def _segment_page_relations(
    session: Session,
    document_ref: DocumentRef,
    segments: Sequence[DocumentSegment],
) -> tuple[dict[str, list[ChildChunk]], dict[str, list[UploadFile]]]:
    """Load page relations in bounded queries while preserving hierarchical rules."""
    if not segments:
        return {}, {}
    segment_ids = tuple(segment.id for segment in segments)
    document = session.scalar(
        select(Document).where(
            Document.id == document_ref.document_id,
            Document.dataset_id == document_ref.dataset.dataset_id,
            Document.tenant_id == document_ref.dataset.tenant_id,
        )
    )
    children: dict[str, list[ChildChunk]] = {}
    if document is not None and document.dataset_process_rule_id:
        process_rule = session.scalar(
            select(DatasetProcessRule).where(
                DatasetProcessRule.id == document.dataset_process_rule_id,
                DatasetProcessRule.dataset_id == document_ref.dataset.dataset_id,
            )
        )
        rules = process_rule.rules_dict if process_rule is not None else None
        if (
            process_rule is not None
            and process_rule.mode == "hierarchical"
            and rules
            and rules.get("parent_mode")
            and rules.get("parent_mode") != "full-doc"
        ):
            for child in session.scalars(
                _children_query(document_ref, segment_ids).order_by(ChildChunk.position.asc())
            ):
                children.setdefault(child.segment_id, []).append(child)

    attachments: dict[str, list[UploadFile]] = {}
    for segment_id, upload in session.execute(
        select(SegmentAttachmentBinding.segment_id, UploadFile)
        .join(UploadFile, UploadFile.id == SegmentAttachmentBinding.attachment_id)
        .where(
            SegmentAttachmentBinding.tenant_id == document_ref.dataset.tenant_id,
            SegmentAttachmentBinding.dataset_id == document_ref.dataset.dataset_id,
            SegmentAttachmentBinding.document_id == document_ref.document_id,
            SegmentAttachmentBinding.segment_id.in_(segment_ids),
            UploadFile.tenant_id == document_ref.dataset.tenant_id,
        )
    ):
        attachments.setdefault(segment_id, []).append(upload)
    return children, attachments


def _segment_data(
    segment: DocumentSegment,
    summary: str | None,
    session: Session,
    file_access: SegmentFileAccess,
    *,
    child_chunks: Sequence[ChildChunk] | None = None,
    attachments: Sequence[UploadFile] | None = None,
) -> SegmentReadSnapshot:
    return SegmentReadSnapshot(
        values=asdict(segment),
        summary=summary,
        file_access=file_access,
        child_chunks=tuple(
            ChildChunkRecord.model_validate(child)
            for child in (
                child_chunks
                if child_chunks is not None
                else get_segment_child_chunks(segment, session=session, include_full_doc=False)
            )
        ),
        attachments=tuple(
            SegmentAttachmentFile(file.id, file.name, file.size, file.extension, file.mime_type)
            for file in attachments
            if attachments is not None
        )
        if attachments is not None
        else tuple(
            SegmentAttachmentFile(file.id, file.name, file.size, file.extension, file.mime_type)
            for file in get_segment_attachment_files(segment, session=session)
        ),
    )


def _child_chunk_data(child_chunk: ChildChunk) -> ChildChunkRecord:
    return ChildChunkRecord.model_validate(child_chunk)


def _segment_upload_file_ids(content: str, answer: str | None) -> set[str]:
    return {file_id for text in (content, answer or "") for file_id in trusted_upload_file_ids(text)}


def _index_document_upload_file_ids(chunks: Sequence[IndexDocument]) -> tuple[str, ...]:
    file_ids: set[str] = set()
    for chunk in chunks:
        answer = chunk.metadata.get("answer")
        file_ids.update(_segment_upload_file_ids(chunk.page_content, answer if isinstance(answer, str) else None))
        if chunk.children:
            for child in chunk.children:
                file_ids.update(_segment_upload_file_ids(child.page_content, None))
        if chunk.attachments:
            for attachment in chunk.attachments:
                file_id = attachment.metadata.get("doc_id")
                if not isinstance(file_id, str) or not file_id:
                    raise UploadFileReferenceNotFoundError({str(file_id or "")})
                file_ids.add(file_id)
    return tuple(sorted(file_ids))


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
