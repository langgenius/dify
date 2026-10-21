"""Load knowledge details and materialize data before response serialization."""

from __future__ import annotations

import json
from collections.abc import Sequence
from typing import Any, cast

from sqlalchemy.orm import Session

from core.rag.index_processor.constant.query_type import QueryType
from core.tools.signature import sign_upload_file_preview_url
from models.dataset import Dataset, DatasetQuery, DocMetadataDetailItem, Document, DocumentSegment
from repositories.knowledge.dataset_read_repository import (
    DatasetDetailPrefetch,
    build_dataset_detail_prefetch,
    get_query_upload_files,
)
from repositories.knowledge.document_query_repository import (
    format_document_metadata,
    format_document_source_detail,
    get_document_dataset,
    get_document_metadata_rows,
    get_document_upload_file,
    get_document_uploader,
)
from repositories.knowledge.segment_query_repository import get_segment_child_chunks
from repositories.knowledge.segment_read_adapter import get_segment_attachments, sign_segment_content
from services.knowledge.entities.datasets import DatasetDetailRecord


def load_dataset_detail(
    dataset: Dataset, *, session: Session, prefetch: DatasetDetailPrefetch | None = None
) -> DatasetDetailRecord:
    values = prefetch if prefetch is not None else build_dataset_detail_prefetch([dataset], session=session)
    return _dataset_detail_values(dataset, values)


def load_dataset_details(datasets: Sequence[Dataset], *, session: Session) -> list[DatasetDetailRecord]:
    """Read a page in one batch and return values with no ORM or session references."""
    prefetch = build_dataset_detail_prefetch(datasets, session=session)
    return [_dataset_detail_values(dataset, prefetch) for dataset in datasets]


def _dataset_detail_values(dataset: Dataset, prefetch: DatasetDetailPrefetch) -> DatasetDetailRecord:
    owner = (dataset.id, dataset.tenant_id)
    return {
        "id": dataset.id,
        "name": dataset.name,
        "description": dataset.description,
        "provider": dataset.provider,
        "permission": dataset.permission,
        "data_source_type": dataset.data_source_type,
        "indexing_technique": dataset.indexing_technique,
        "keyword_number": dataset.keyword_number,
        "app_count": prefetch.app_counts.get(dataset.id, 0),
        "document_count": prefetch.document_counts.get(dataset.id, 0),
        "word_count": prefetch.word_counts.get(dataset.id, 0),
        "created_by": dataset.created_by,
        "author_name": prefetch.author_names.get(dataset.created_by),
        "created_at": dataset.created_at,
        "updated_by": dataset.updated_by,
        "updated_at": dataset.updated_at,
        "embedding_model": dataset.embedding_model,
        "embedding_model_provider": dataset.embedding_model_provider,
        "embedding_available": vars(dataset).get("embedding_available"),
        "retrieval_model_dict": dataset.retrieval_model_dict,
        "summary_index_setting": dataset.summary_index_setting,
        "tags": [{"id": tag.id, "name": tag.name, "type": tag.type} for tag in prefetch.tags.get(owner, [])],
        "doc_form": dataset.chunk_structure or prefetch.doc_forms.get(owner),
        "external_knowledge_info": prefetch.external_knowledge_infos.get(owner)
        if dataset.provider == "external"
        else None,
        "external_retrieval_model": dataset.external_retrieval_model,
        "doc_metadata": dataset.build_doc_metadata(prefetch.doc_metadata.get(dataset.id, [])),
        "built_in_field_enabled": dataset.built_in_field_enabled,
        "pipeline_id": dataset.pipeline_id,
        "runtime_mode": dataset.runtime_mode,
        "chunk_structure": dataset.chunk_structure,
        "icon_info": dataset.icon_info,
        "is_published": prefetch.pipeline_published.get(dataset.pipeline_id, False) if dataset.pipeline_id else False,
        "total_documents": prefetch.document_counts.get(dataset.id, 0),
        "total_available_documents": prefetch.available_document_counts.get(dataset.id, 0),
        "enable_api": dataset.enable_api,
        "is_multimodal": dataset.is_multimodal,
        "permission_keys": vars(dataset).get("permission_keys", []),
        "maintainer": dataset.maintainer,
        "vector_indexing_status": None,
        "vector_indexing_error": None,
    }


def load_segment_detail(segment: DocumentSegment, summary: str | None, *, session: Session) -> dict[str, Any]:
    """Load relations and authorize file links before handing plain values to the response model."""
    child_chunks = get_segment_child_chunks(segment, session=session, include_full_doc=False)
    return {
        "id": segment.id,
        "position": segment.position,
        "document_id": segment.document_id,
        "content": segment.content,
        "sign_content": sign_segment_content(segment, session=session),
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
        "child_chunks": [
            {
                "id": chunk.id,
                "segment_id": chunk.segment_id,
                "content": chunk.content,
                "position": chunk.position,
                "word_count": chunk.word_count,
                "type": chunk.type,
                "created_at": chunk.created_at,
                "updated_at": chunk.updated_at,
            }
            for chunk in child_chunks
        ],
        "attachments": get_segment_attachments(segment, session=session),
        "summary": summary,
    }


def get_document_source_detail(document: Document, *, session: Session) -> dict[str, Any]:
    file = get_document_upload_file(document, session=session) if document.data_source_type == "upload_file" else None
    return format_document_source_detail(document, file)


def get_document_metadata_details(document: Document, *, session: Session) -> list[DocMetadataDetailItem] | None:
    dataset = get_document_dataset(document, session=session)
    built_in_enabled = bool(dataset is not None and dataset.built_in_field_enabled)
    return format_document_metadata(
        document,
        get_document_metadata_rows(document, session=session) if document.doc_metadata else [],
        built_in_enabled=built_in_enabled,
        uploader_name=get_document_uploader(document, session=session) if built_in_enabled else None,
    )


def get_dataset_queries(query: DatasetQuery, *, session: Session) -> list[dict[str, Any]]:
    """Read structured audit content, preserving legacy plain-text queries."""
    try:
        decoded = json.loads(query.content)
    except (ValueError, TypeError):
        decoded = None
    raw_records = decoded if isinstance(decoded, list) else [decoded]
    if not raw_records or not all(
        isinstance(item, dict)
        and item.get("content_type") in {QueryType.TEXT_QUERY, QueryType.IMAGE_QUERY}
        and isinstance(item.get("content"), str)
        for item in raw_records
    ):
        return [{"content_type": QueryType.TEXT_QUERY, "content": query.content, "file_info": None}]
    records = cast(list[dict[str, Any]], raw_records)
    files = get_query_upload_files(
        query, {item["content"] for item in records if item["content_type"] == QueryType.IMAGE_QUERY}, session=session
    )
    result: list[dict[str, Any]] = []
    for item in records:
        record: dict[str, Any] = {"content_type": item["content_type"], "content": item["content"], "file_info": None}
        file = files.get(item["content"]) if item["content_type"] == QueryType.IMAGE_QUERY else None
        if file is not None:
            record["file_info"] = {
                "id": file.id,
                "name": file.name,
                "size": file.size,
                "extension": file.extension,
                "mime_type": file.mime_type,
                "source_url": sign_upload_file_preview_url(file.id, file.extension),
            }
        result.append(record)
    return result
