"""Load knowledge details and materialize data before response serialization."""

from __future__ import annotations

import json
from collections.abc import Iterable, Mapping, Sequence
from typing import Any, cast

from sqlalchemy.orm import Session

from core.rag.index_processor.constant.built_in_field import BuiltInField, MetadataDataSource
from core.rag.index_processor.constant.query_type import QueryType
from core.tools.signature import sign_upload_file_preview_url
from models.dataset import Dataset, DatasetMetadata, DatasetQuery, DocMetadataDetailItem, Document, DocumentSegment
from models.model import UploadFile
from repositories.knowledge.dataset_read_repository import (
    DatasetDetailPrefetch,
    DocumentReadBatch,
    build_dataset_detail_prefetch,
    get_document_dataset,
    get_document_metadata_rows,
    get_document_upload_file,
    get_document_uploader,
    get_query_upload_files,
    get_segment_child_chunks,
    load_document_read_batch,
)
from repositories.knowledge.segment_read_adapter import get_segment_attachments, sign_segment_content


def load_dataset_detail(
    dataset: Dataset, *, session: Session, prefetch: DatasetDetailPrefetch | None = None
) -> dict[str, Any]:
    values = prefetch if prefetch is not None else build_dataset_detail_prefetch([dataset], session=session)
    return _dataset_detail_values(dataset, values)


def load_dataset_details(datasets: Sequence[Dataset], *, session: Session) -> list[dict[str, Any]]:
    """Read a page in one batch and return values with no ORM or session references."""
    prefetch = build_dataset_detail_prefetch(datasets, session=session)
    return [_dataset_detail_values(dataset, prefetch) for dataset in datasets]


def _dataset_detail_values(dataset: Dataset, prefetch: DatasetDetailPrefetch) -> dict[str, Any]:
    owner = (dataset.id, dataset.tenant_id)
    return {
        "id": dataset.id,
        "name": dataset.name,
        "description": dataset.description,
        "provider": dataset.provider,
        "permission": dataset.permission,
        "data_source_type": dataset.data_source_type,
        "indexing_technique": dataset.indexing_technique,
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
    }


def load_document_detail(document: Document, *, session: Session) -> dict[str, Any]:
    return load_document_details([document], session=session)[0]


def load_document_details(documents: Iterable[Document], *, session: Session) -> list[dict[str, Any]]:
    """Materialize document attributes and relations while the caller's session is open."""
    items = list(documents)
    batch = load_document_read_batch(items, session=session)
    return [
        {
            "id": document.id,
            "position": document.position,
            "data_source_type": document.data_source_type,
            "data_source_info_dict": document.data_source_info_dict,
            "dataset_process_rule_id": document.dataset_process_rule_id,
            "name": document.name,
            "created_from": document.created_from,
            "created_by": document.created_by,
            "created_at": document.created_at,
            "tokens": document.tokens,
            "indexing_status": document.indexing_status,
            "error": document.error,
            "enabled": document.enabled,
            "disabled_at": document.disabled_at,
            "disabled_by": document.disabled_by,
            "archived": document.archived,
            "display_status": document.display_status,
            "word_count": document.word_count,
            "doc_form": document.doc_form,
            "summary_index_status": vars(document).get("summary_index_status"),
            "need_summary": document.need_summary,
            "completed_segments": vars(document).get("completed_segments"),
            "total_segments": vars(document).get("total_segments"),
            **document_response_values(document, batch),
        }
        for document in items
    ]


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


def load_segment_details(
    segments: Iterable[DocumentSegment], summaries: Mapping[str, str | None], *, session: Session
) -> list[dict[str, Any]]:
    return [load_segment_detail(segment, summaries.get(segment.id), session=session) for segment in segments]


def format_document_source_detail(document: Document, file: UploadFile | None) -> dict[str, Any]:
    if document.data_source_type == "upload_file" and file is not None:
        return {
            "upload_file": {
                "id": file.id,
                "name": file.name,
                "size": file.size,
                "extension": file.extension,
                "mime_type": file.mime_type,
                "created_by": file.created_by,
                "created_at": file.created_at.timestamp(),
            }
        }
    if document.data_source_type in {"notion_import", "website_crawl"}:
        return document.data_source_info_dict
    return {}


def format_document_metadata(
    document: Document, metadatas: Sequence[DatasetMetadata], *, built_in_enabled: bool, uploader_name: str | None
) -> list[DocMetadataDetailItem] | None:
    values = document.doc_metadata or {}
    details: list[DocMetadataDetailItem] = [
        {"id": metadata.id, "name": metadata.name, "type": metadata.type, "value": values.get(metadata.name)}
        for metadata in metadatas
    ]
    if built_in_enabled:
        details.extend(format_document_built_in_fields(document, uploader_name=uploader_name))
    return details or None


def document_response_values(document: Document, batch: DocumentReadBatch) -> dict[str, Any]:
    """Build response-only values from a loaded snapshot without database access."""
    file_id = document.data_source_info_dict.get("upload_file_id")
    process_rule = batch.process_rules.get(document.dataset_process_rule_id)
    if process_rule is not None and process_rule.dataset_id != document.dataset_id:
        process_rule = None
    return {
        "data_source_detail_dict": format_document_source_detail(
            document, batch.uploads.get((document.tenant_id, file_id)) if isinstance(file_id, str) else None
        ),
        "hit_count": batch.hit_counts.get(document.id, 0),
        "doc_metadata_details": format_document_metadata(
            document,
            batch.metadatas.get(document.id, []),
            built_in_enabled=batch.built_in_enabled.get((document.tenant_id, document.dataset_id), False),
            uploader_name=batch.uploader_names.get(document.created_by),
        ),
        "process_rule_dict": process_rule.to_dict() if process_rule else None,
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


def get_document_built_in_fields(document: Document, *, session: Session) -> list[DocMetadataDetailItem]:
    return format_document_built_in_fields(document, uploader_name=get_document_uploader(document, session=session))


def format_document_built_in_fields(document: Document, *, uploader_name: str | None) -> list[DocMetadataDetailItem]:
    built_in_fields: list[DocMetadataDetailItem] = []
    built_in_fields.append(
        {"id": "built-in", "name": BuiltInField.document_name, "type": "string", "value": document.name}
    )
    built_in_fields.append({"id": "built-in", "name": BuiltInField.uploader, "type": "string", "value": uploader_name})
    built_in_fields.append(
        {
            "id": "built-in",
            "name": BuiltInField.upload_date,
            "type": "time",
            "value": str(document.created_at.timestamp()),
        }
    )
    built_in_fields.append(
        {
            "id": "built-in",
            "name": BuiltInField.last_update_date,
            "type": "time",
            "value": str(document.updated_at.timestamp()),
        }
    )
    built_in_fields.append(
        {
            "id": "built-in",
            "name": BuiltInField.source,
            "type": "string",
            "value": MetadataDataSource[document.data_source_type],
        }
    )
    return built_in_fields


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
