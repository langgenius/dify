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
from core.rag.index_processor.processor.paragraph_index_processor import ParagraphIndexProcessor
from graphon.file import File
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
from models.enums import SegmentType, SummaryStatus
from repositories.knowledge.dataset_repository import _get_dataset
from repositories.knowledge.document_repository import _get_document
from services.entities.knowledge_entities.segments import ChildChunkRecord, SegmentRecord
from services.knowledge.resource_scope import DatasetRef, DocumentRef, SegmentRef
from services.knowledge.segments.application import (
    ChildChunkListFilter,
    ChildChunkPage,
    ChildChunkState,
    SegmentDetail,
    SegmentIndexTarget,
    SegmentListFilter,
    SegmentPage,
)


class SQLAlchemySegmentRepository:
    """Read and write scoped segment rows in bounded database transactions."""

    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

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
        with self._session_factory() as session:
            dataset, document = _require_scope_models(session, segment_ref.document)
            segment = _get_segment(session, segment_ref)
            if segment is None:
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
            attachment_ids = tuple(
                session.scalars(
                    select(SegmentAttachmentBinding.attachment_id).where(
                        SegmentAttachmentBinding.tenant_id == dataset.tenant_id,
                        SegmentAttachmentBinding.dataset_id == dataset.id,
                        SegmentAttachmentBinding.document_id == document.id,
                        SegmentAttachmentBinding.segment_id == segment.id,
                    )
                )
            )
            return SegmentIndexingSnapshot(
                dataset, document, segment, rule, vector_type, _summary(session, segment), attachment_ids
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
            row = dataset.get_dataset_keyword_table(session=session)
            return (row.data_source_type, row.keyword_table) if row else (dify_config.KEYWORD_DATA_SOURCE_TYPE, None)

    def save_keyword_table(
        self, dataset_ref: DatasetRef, *, storage_type: str, data: str, keywords: Mapping[str, Sequence[str]]
    ) -> None:
        with self._session_factory.begin() as session:
            dataset = _get_dataset(session, dataset_ref)
            if dataset is None:
                raise LookupError("Dataset no longer exists")
            dataset.save_keyword_table(session=session, storage_type=storage_type, data=data, keywords=keywords)


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
    values = {
        name: getattr(segment, name)
        for name in SegmentRecord.model_fields
        if name not in {"summary", "child_chunks", "attachments"}
    }
    return SegmentRecord.model_validate(
        {
            **values,
            "summary": summary,
            "child_chunks": segment.get_child_chunks(session=session, include_full_doc=False),
            "attachments": segment.get_attachments(session=session),
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
