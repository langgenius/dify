"""Infrastructure adapters for dataset segment use cases."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import cast

from sqlalchemy import String, case, delete, func, literal, or_, select, update
from sqlalchemy import cast as sql_cast
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.rag.datasource.vdb.vector_factory import Vector
from core.rag.docstore.dataset_docstore import DatasetDocumentStore
from core.rag.index_processor.constant.index_type import IndexStructureType
from core.rag.index_processor.processor.paragraph_index_processor import ParagraphIndexProcessor
from core.rag.models.document import ChildDocument
from core.rag.models.document import Document as IndexDocument
from graphon.file import File
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
from repositories.knowledge.dataset_read_repository import get_dataset_keyword_table, get_segment_child_chunks
from repositories.knowledge.dataset_repository import _get_dataset
from repositories.knowledge.document_repository import _get_document, require_indexing_document
from repositories.knowledge.keyword_table_repository import persist_keyword_table
from repositories.knowledge.segment_read_adapter import get_segment_attachments, sign_segment_content
from services.knowledge.entities.segments import ChildChunkRecord, SegmentRecord
from services.knowledge.indexing.execution import IndexingDocument
from services.knowledge.resource_scope import DatasetRef, DocumentRef, SegmentRef
from services.knowledge.segments.application import (
    ChildChunkListFilter,
    ChildChunkPage,
    ChildChunkState,
    SegmentDetail,
    SegmentIndexTarget,
    SegmentListFilter,
    SegmentPage,
    SegmentUpdateState,
)


class SQLAlchemySegmentRepository:
    """Read and write scoped segment rows in bounded database transactions."""

    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    def clear_for_indexing(self, document: IndexingDocument) -> None:
        ref = document.ref
        with self._session_factory.begin() as session:
            require_indexing_document(session, ref, lock=True)
            if document.doc_form == IndexStructureType.PARENT_CHILD_INDEX:
                session.execute(
                    delete(ChildChunk).where(
                        ChildChunk.tenant_id == ref.dataset.tenant_id,
                        ChildChunk.dataset_id == ref.dataset.dataset_id,
                        ChildChunk.document_id == ref.document_id,
                    )
                )
            session.execute(delete(DocumentSegment).where(*self._indexing_scope(ref)))

    def save_for_indexing(
        self, document: IndexingDocument, chunks: list[IndexDocument], token_counts: list[int]
    ) -> None:
        ref = document.ref
        with self._session_factory.begin() as session:
            row = require_indexing_document(session, ref, lock=True)
            dataset = _get_dataset(session, ref.dataset)
            assert dataset is not None
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

    def list_segments(self, document_ref: DocumentRef, query: SegmentListFilter) -> SegmentPage:
        with self._session_factory() as session:
            statement = (
                select(DocumentSegment)
                .where(
                    DocumentSegment.tenant_id == document_ref.dataset.tenant_id,
                    DocumentSegment.dataset_id == document_ref.dataset.dataset_id,
                    DocumentSegment.document_id == document_ref.document_id,
                )
                .order_by(DocumentSegment.position.asc())
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
            return SegmentPage(
                items=tuple(
                    _segment_data(
                        segment,
                        summaries[segment.id].summary_content if segment.id in summaries else None,
                        session,
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

    def get_segment(self, segment_ref: SegmentRef) -> SegmentDetail | None:
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

    def save_segment(self, segment_ref: SegmentRef, values: Mapping[str, object], *, create: bool = False) -> None:
        with self._session_factory.begin() as session:
            _, document = _require_scope_models(session, segment_ref.document)
            segment = _get_segment(session, segment_ref)
            previous_words = segment.word_count if segment is not None else 0
            if create:
                if segment is not None:
                    raise ValueError("Segment already exists")
                position = (
                    session.scalar(
                        select(func.max(DocumentSegment.position)).where(
                            DocumentSegment.tenant_id == segment_ref.document.dataset.tenant_id,
                            DocumentSegment.dataset_id == segment_ref.document.dataset.dataset_id,
                            DocumentSegment.document_id == segment_ref.document.document_id,
                        )
                    )
                    or 0
                )
                segment = DocumentSegment(
                    tenant_id=segment_ref.document.dataset.tenant_id,
                    dataset_id=segment_ref.document.dataset.dataset_id,
                    document_id=segment_ref.document.document_id,
                    position=position + 1,
                    content=cast(str, values["content"]),
                    word_count=cast(int, values["word_count"]),
                    tokens=cast(int, values["tokens"]),
                    created_by=cast(str, values["created_by"]),
                )
                segment.id = segment_ref.segment_id
                session.add(segment)
            if segment is None:
                raise LookupError("Segment no longer exists")
            for key, value in values.items():
                setattr(segment, key, value)
            if "word_count" in values:
                document.word_count = max(0, (document.word_count or 0) + segment.word_count - previous_words)

    def delete_segments(self, document_ref: DocumentRef, segment_ids: Sequence[str]) -> None:
        if not segment_ids:
            return
        with self._session_factory.begin() as session:
            _, document = _require_scope_models(session, document_ref)
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

    def save_children(
        self,
        segment_ref: SegmentRef,
        *,
        added: Sequence[ChildChunkState] = (),
        updated: Sequence[ChildChunkState] = (),
        deleted: Sequence[ChildChunkState] = (),
    ) -> None:
        with self._session_factory.begin() as session:
            if _get_segment(session, segment_ref) is None:
                raise LookupError("Segment no longer exists")
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
            if _get_segment(session, segment_ref) is None:
                raise LookupError("Segment no longer exists")
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
            segment = _get_segment(session, segment_ref)
            if segment is None:
                raise LookupError("Segment no longer exists")
            summary = _summary(session, segment)
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
            session.flush()
            session.expunge(summary)
            return summary

    def get_summary_images(self, segment_ref: SegmentRef) -> list[File]:
        with self._session_factory() as session:
            segment = _get_segment(session, segment_ref)
            if segment is None:
                raise LookupError("Segment no longer exists")
            images = ParagraphIndexProcessor._extract_images_from_segment_attachments(
                segment.tenant_id, segment.id, session
            )
            return images or ParagraphIndexProcessor._extract_images_from_text(
                segment.tenant_id, segment.content, session
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


def _detail(session: Session, segment: DocumentSegment, document: Document) -> SegmentDetail:
    summary = _summary(session, segment)
    return SegmentDetail(
        data=_segment_data(segment, summary.summary_content if summary else None, session),
        doc_form=str(document.doc_form),
    )


def _require_scope_models(session: Session, document_ref: DocumentRef) -> tuple[Dataset, Document]:
    dataset = _get_dataset(session, document_ref.dataset)
    document = _get_document(session, document_ref)
    if dataset is None or document is None:
        raise LookupError("Dataset document scope no longer exists")
    return dataset, document


def _get_segment(session: Session, segment_ref: SegmentRef) -> DocumentSegment | None:
    return session.scalar(
        select(DocumentSegment)
        .where(
            DocumentSegment.id == segment_ref.segment_id,
            DocumentSegment.document_id == segment_ref.document.document_id,
            DocumentSegment.dataset_id == segment_ref.document.dataset.dataset_id,
            DocumentSegment.tenant_id == segment_ref.document.dataset.tenant_id,
        )
        .limit(1)
    )


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


def _segment_data(segment: DocumentSegment, summary: str | None, session: Session) -> SegmentRecord:
    return SegmentRecord.model_validate(
        {
            "id": segment.id,
            "position": segment.position,
            "document_id": segment.document_id,
            "content": segment.content,
            "answer": segment.answer,
            "word_count": segment.word_count,
            "tokens": segment.tokens,
            "keywords": segment.keywords,
            "index_node_id": segment.index_node_id,
            "index_node_hash": segment.index_node_hash,
            "hit_count": segment.hit_count,
            "enabled": segment.enabled,
            "disabled_at": segment.disabled_at,
            "disabled_by": segment.disabled_by,
            "status": segment.status,
            "created_by": segment.created_by,
            "created_at": segment.created_at,
            "updated_at": segment.updated_at,
            "updated_by": segment.updated_by,
            "indexing_at": segment.indexing_at,
            "completed_at": segment.completed_at,
            "error": segment.error,
            "stopped_at": segment.stopped_at,
            "sign_content": sign_segment_content(segment, session=session),
            "summary": summary,
            "child_chunks": get_segment_child_chunks(segment, session=session, include_full_doc=False),
            "attachments": get_segment_attachments(segment, session=session),
        }
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
