"""Canonical final-result selection for every knowledge retrieval entrypoint."""

from __future__ import annotations

from collections.abc import Sequence
from contextlib import nullcontext
from dataclasses import replace

from sqlalchemy.orm import Session, sessionmaker

from core.app.file_access import (
    bind_file_access_scope,
    get_current_file_access_scope,
    grant_retriever_segment_access,
    grant_upload_file_access,
)
from core.rag.datasource.retrieval_service import RetrievalService
from core.rag.models.document import Document
from core.tools.signature import sign_upload_file_preview_url
from models.model import UploadFile
from repositories.knowledge.retrieval_source_repository import (
    get_retrieval_source_datasets,
    get_retrieval_source_documents,
)
from repositories.knowledge.segment_query_repository import get_content_file_ids, segment_content_file_ids
from services.knowledge.entities.retrieval import (
    AttachmentInfoDict,
    RetrievedAttachment,
    RetrievedTraceDocument,
    Source,
    SourceChildChunk,
    SourceMetadata,
)
from services.knowledge.retrieval.attachments import authorize_retrieval_records, expand_retrieval_attachment_candidates
from services.knowledge.retrieval.records import (
    FinalizedInternalRetrieval,
    FinalizedKnowledgeResponse,
    FinalizedRetrievalItem,
    FinalizedRetrievalResult,
    RetrievalSegments,
)
from services.knowledge.segments.adapters import sign_segment_content


def _signed_attachment_info(attachment: UploadFile) -> AttachmentInfoDict:
    """Map one revalidated attachment without consulting formatter-era metadata."""
    extension = "." + attachment.extension.lstrip(".")
    return {
        "id": attachment.id,
        "name": attachment.name,
        "extension": extension,
        "mime_type": attachment.mime_type,
        "source_url": sign_upload_file_preview_url(attachment.id, extension.lstrip(".")),
        "size": attachment.size,
    }


def _finalize_retrieval_candidates(
    *,
    format_session: Session,
    authorization_session: Session,
    candidates: Sequence[Document],
    tenant_id: str,
    dataset_ids: Sequence[str],
    top_k: int,
) -> FinalizedRetrievalResult:
    """Validate, rank, publish, and sign a retrieval result exactly once.

    Vector, keyword, summary, child, and attachment hits are all treated as
    untrusted candidates until the canonical formatter resolves their current
    parent segment and the complete persisted owner chain is revalidated.
    """
    external_documents = [document for document in candidates if document.provider == "external"]
    dify_documents = [document for document in candidates if document.provider == "dify"]
    expanded = expand_retrieval_attachment_candidates(
        dify_documents,
        tenant_id=tenant_id,
        dataset_ids=dataset_ids,
        session=format_session,
    )
    records = RetrievalService.format_retrieval_documents(format_session, list(expanded.candidates))
    eligible_internal = authorize_retrieval_records(
        records,
        matched_attachment_ids=expanded.matched_attachment_ids,
        tenant_id=tenant_id,
        dataset_ids=dataset_ids,
        session=authorization_session,
    )

    eligible: list[Document | tuple[RetrievalSegments, tuple[UploadFile, ...]]] = [
        *external_documents,
        *eligible_internal,
    ]

    def score(item: Document | tuple[RetrievalSegments, tuple[UploadFile, ...]]) -> float:
        value = item.metadata.get("score") if isinstance(item, Document) else item[0].score
        try:
            return float(value or 0.0)
        except (TypeError, ValueError):
            return 0.0

    eligible.sort(key=score, reverse=True)
    selected = eligible[:top_k] if top_k else eligible

    selected_internal = [item for item in selected if not isinstance(item, Document)]
    selected_segment_ids = [record.segment.id for record, _ in selected_internal]
    selected_file_ids = [file.id for _, attachments in selected_internal for file in attachments]
    scope = get_current_file_access_scope()
    staged_scope = (
        replace(
            scope,
            granted_retriever_segment_ids=scope.granted_retriever_segment_ids | frozenset(selected_segment_ids),
            granted_upload_file_ids=scope.granted_upload_file_ids | frozenset(selected_file_ids),
        )
        if scope is not None
        else None
    )
    staging_context = bind_file_access_scope(staged_scope) if staged_scope is not None else nullcontext()

    finalized: list[FinalizedRetrievalItem] = []
    with staging_context:
        for item in selected:
            if isinstance(item, Document):
                finalized.append(item)
                continue

            record, attachments = item
            segment = record.segment
            signed_files = tuple(_signed_attachment_info(attachment) for attachment in attachments)
            published_record = record.model_copy(update={"files": list(signed_files) or None})
            upload_ids, tool_ids = segment_content_file_ids(segment.content)
            upload_ids &= {attachment.id for attachment in attachments}
            allowed_uploads, allowed_tools = get_content_file_ids(
                tenant_id,
                upload_ids=upload_ids,
                tool_ids=tool_ids,
                scope=staged_scope,
                session=authorization_session,
            )
            finalized.append(
                FinalizedInternalRetrieval(
                    record=published_record,
                    attachments=attachments,
                    content=sign_segment_content(
                        segment,
                        allowed_upload_file_ids=allowed_uploads,
                        allowed_tool_file_ids=allowed_tools,
                    ),
                    files=signed_files,
                )
            )

    grant_retriever_segment_access(selected_segment_ids)
    grant_upload_file_access(selected_file_ids)

    return FinalizedRetrievalResult(items=tuple(finalized))


def _materialize_knowledge_response(
    *,
    session: Session,
    finalized: FinalizedRetrievalResult,
    tenant_id: str,
    dataset_ids: Sequence[str],
    retriever_from: str,
) -> FinalizedKnowledgeResponse:
    selected_records = [item.record for item in finalized.items if isinstance(item, FinalizedInternalRetrieval)]
    if selected_records:
        selected_dataset_ids = tuple({record.segment.dataset_id for record in selected_records})
        selected_document_ids = tuple({record.segment.document_id for record in selected_records})
        datasets = get_retrieval_source_datasets(
            tenant_id=tenant_id,
            dataset_ids=selected_dataset_ids,
            session=session,
        )
        documents = get_retrieval_source_documents(
            tenant_id=tenant_id,
            dataset_ids=dataset_ids,
            document_ids=selected_document_ids,
            session=session,
        )
        dataset_map = {dataset.id: dataset for dataset in datasets}
        document_map = {document.id: document for document in documents}
    else:
        dataset_map = {}
        document_map = {}

    sources: list[Source] = []
    context_parts: list[str] = []
    attachments: list[RetrievedAttachment] = []
    trace_documents: list[RetrievedTraceDocument] = []
    selected_segment_ids: list[str] = []
    for item in finalized.items:
        if isinstance(item, Document):
            external_metadata = item.metadata or {}
            title = external_metadata.get("title") or ""
            document_id = external_metadata.get("document_id") or title
            sources.append(
                Source(
                    metadata=SourceMetadata(
                        source="knowledge",
                        dataset_id=external_metadata.get("dataset_id") or "",
                        dataset_name=external_metadata.get("dataset_name") or "",
                        document_id=str(document_id),
                        document_name=external_metadata.get("title") or "",
                        data_source_type="external",
                        retriever_from=retriever_from,
                        score=float(external_metadata.get("score") or 0.0),
                        doc_metadata=external_metadata,
                    ),
                    title=title,
                    content=item.page_content,
                )
            )
            context_parts.append(item.page_content)
            trace_documents.append(
                RetrievedTraceDocument(
                    page_content=item.page_content,
                    provider=item.provider,
                    metadata=dict(item.metadata or {}),
                )
            )
            continue

        record = item.record
        segment = record.segment
        dataset = dataset_map.get(segment.dataset_id)
        document = document_map.get(segment.document_id)
        if dataset is None or document is None:
            continue

        source = Source(
            metadata=SourceMetadata(
                source="knowledge",
                dataset_id=dataset.id,
                dataset_name=dataset.name,
                document_id=document.id,
                document_name=document.name,
                data_source_type=document.data_source_type,
                segment_id=segment.id,
                retriever_from=retriever_from,
                score=record.score or 0.0,
                segment_hit_count=segment.hit_count,
                segment_word_count=segment.word_count,
                segment_position=segment.position,
                segment_index_node_hash=segment.index_node_hash,
                doc_metadata=document.doc_metadata,
                child_chunks=[
                    SourceChildChunk(
                        id=chunk.id,
                        content=chunk.content,
                        position=chunk.position,
                        score=chunk.score,
                    )
                    for chunk in (record.child_chunks or [])
                ],
                position=None,
            ),
            title=document.name,
            files=list(item.files) if item.files else None,
            content=item.content,
        )
        context_content = item.content
        if segment.answer:
            source.content = f"question:{item.content} \nanswer:{segment.answer}"
            context_content = f"question:{item.content} answer:{segment.answer}"
        if record.summary:
            source.summary = record.summary
            context_content = f"{record.summary}\n{context_content}"

        sources.append(source)
        context_parts.append(context_content)
        trace_document = item.trace_document()
        trace_documents.append(
            RetrievedTraceDocument(
                page_content=trace_document.page_content,
                provider=trace_document.provider,
                metadata=dict(trace_document.metadata or {}),
            )
        )
        selected_segment_ids.append(segment.id)

        preview_url_by_id = {str(file["id"]): file["source_url"] for file in item.files}
        attachments.extend(
            RetrievedAttachment(
                id=str(attachment.id),
                name=attachment.name,
                extension=attachment.extension.lstrip("."),
                mime_type=attachment.mime_type,
                source_url=attachment.source_url or "",
                preview_url=preview_url_by_id[str(attachment.id)],
                size=attachment.size,
                storage_key=attachment.key,
            )
            for attachment in item.attachments
        )

    for position, source in enumerate(sources, start=1):
        source.metadata.position = position
    return FinalizedKnowledgeResponse(
        sources=tuple(sources),
        context="\n".join(context_parts),
        attachments=tuple(attachments),
        trace_documents=tuple(trace_documents),
        selected_segment_ids=tuple(selected_segment_ids),
    )


class KnowledgeRetrievalFinalizer:
    """Validate current ownership and publish the final knowledge result set."""

    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._sessions = session_factory

    def finalize_response(
        self,
        *,
        candidates: Sequence[Document],
        tenant_id: str,
        dataset_ids: Sequence[str],
        top_k: int,
        retriever_from: str,
    ) -> FinalizedKnowledgeResponse:
        with self._sessions() as session:
            finalized = _finalize_retrieval_candidates(
                format_session=session,
                authorization_session=session,
                candidates=candidates,
                tenant_id=tenant_id,
                dataset_ids=dataset_ids,
                top_k=top_k,
            )
            return _materialize_knowledge_response(
                session=session,
                finalized=finalized,
                tenant_id=tenant_id,
                dataset_ids=dataset_ids,
                retriever_from=retriever_from,
            )
