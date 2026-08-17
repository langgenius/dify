"""Batch loading for session-backed dataset document response fields."""

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from sqlalchemy import and_, case, func, select, tuple_
from sqlalchemy.orm import Session

from core.rag.index_processor.constant.built_in_field import BuiltInField, MetadataDataSource
from models.account import Account
from models.dataset import (
    DatasetMetadata,
    DatasetMetadataBinding,
    DatasetProcessRule,
    DocMetadataDetailItem,
    Document,
    DocumentSegment,
    ProcessRuleDict,
)
from models.enums import SegmentStatus
from models.model import UploadFile


def _load_segment_counts(
    documents: Sequence[Document], *, session: Session
) -> tuple[dict[str, int], dict[str, int], dict[str, int]]:
    document_ids = [str(document.id) for document in documents]
    document_owner_keys = {
        (str(document.tenant_id), str(document.dataset_id), str(document.id)) for document in documents
    }
    hit_counts = dict.fromkeys(document_ids, 0)
    completed_counts = dict.fromkeys(document_ids, 0)
    total_counts = dict.fromkeys(document_ids, 0)
    rows = session.execute(
        select(
            DocumentSegment.document_id,
            func.coalesce(func.sum(DocumentSegment.hit_count), 0),
            func.coalesce(
                func.sum(
                    case(
                        (
                            and_(
                                DocumentSegment.status != SegmentStatus.RE_SEGMENT,
                                DocumentSegment.completed_at.isnot(None),
                            ),
                            1,
                        ),
                        else_=0,
                    )
                ),
                0,
            ),
            func.coalesce(
                func.sum(case((DocumentSegment.status != SegmentStatus.RE_SEGMENT, 1), else_=0)),
                0,
            ),
        )
        .where(
            tuple_(DocumentSegment.tenant_id, DocumentSegment.dataset_id, DocumentSegment.document_id).in_(
                document_owner_keys
            )
        )
        .group_by(DocumentSegment.document_id)
    ).all()
    for document_id, hit_count, completed_count, total_count in rows:
        document_id = str(document_id)
        hit_counts[document_id] = int(hit_count)
        completed_counts[document_id] = int(completed_count)
        total_counts[document_id] = int(total_count)
    return hit_counts, completed_counts, total_counts


def _load_data_source_details(documents: Sequence[Document], *, session: Session) -> dict[str, dict[str, Any]]:
    details: dict[str, dict[str, Any]] = {}
    document_upload_file_keys: dict[str, tuple[str, str]] = {}
    for document in documents:
        document_id = str(document.id)
        details[document_id] = {}
        if document.data_source_info:
            if document.data_source_type == "upload_file":
                data_source_info: dict[str, Any] = json.loads(document.data_source_info)
                document_upload_file_keys[document_id] = (
                    str(document.tenant_id),
                    str(data_source_info["upload_file_id"]),
                )
            elif document.data_source_type in {"notion_import", "website_crawl"}:
                details[document_id] = json.loads(document.data_source_info)

    upload_file_keys = set(document_upload_file_keys.values())
    upload_file_map: dict[tuple[str, str], UploadFile] = {}
    if upload_file_keys:
        upload_files = session.scalars(
            select(UploadFile).where(tuple_(UploadFile.tenant_id, UploadFile.id).in_(upload_file_keys))
        ).all()
        upload_file_map = {
            (str(upload_file.tenant_id), str(upload_file.id)): upload_file for upload_file in upload_files
        }

    for document in documents:
        document_id = str(document.id)
        upload_file_key = document_upload_file_keys.get(document_id)
        upload_file = upload_file_map.get(upload_file_key) if upload_file_key else None
        if upload_file is not None:
            details[document_id] = {
                "upload_file": {
                    "id": upload_file.id,
                    "name": upload_file.name,
                    "size": upload_file.size,
                    "extension": upload_file.extension,
                    "mime_type": upload_file.mime_type,
                    "created_by": upload_file.created_by,
                    "created_at": upload_file.created_at.timestamp(),
                }
            }
    return details


def _load_process_rule_dicts(documents: Sequence[Document], *, session: Session) -> dict[str, ProcessRuleDict | None]:
    process_rule_keys = {
        (str(document.dataset_id), str(document.dataset_process_rule_id))
        for document in documents
        if document.dataset_process_rule_id
    }
    process_rule_map: dict[tuple[str, str], DatasetProcessRule] = {}
    if process_rule_keys:
        process_rules = session.scalars(
            select(DatasetProcessRule).where(
                tuple_(DatasetProcessRule.dataset_id, DatasetProcessRule.id).in_(process_rule_keys)
            )
        ).all()
        process_rule_map = {
            (str(process_rule.dataset_id), str(process_rule.id)): process_rule for process_rule in process_rules
        }

    return {
        str(document.id): (
            process_rule_map[(str(document.dataset_id), str(document.dataset_process_rule_id))].to_dict()
            if document.dataset_process_rule_id
            and (str(document.dataset_id), str(document.dataset_process_rule_id)) in process_rule_map
            else None
        )
        for document in documents
    }


def _built_in_metadata(document: Document, *, uploader_name: str | None) -> list[DocMetadataDetailItem]:
    return [
        {
            "id": "built-in",
            "name": BuiltInField.document_name,
            "type": "string",
            "value": document.name,
        },
        {
            "id": "built-in",
            "name": BuiltInField.uploader,
            "type": "string",
            "value": uploader_name,
        },
        {
            "id": "built-in",
            "name": BuiltInField.upload_date,
            "type": "time",
            "value": str(document.created_at.timestamp()),
        },
        {
            "id": "built-in",
            "name": BuiltInField.last_update_date,
            "type": "time",
            "value": str(document.updated_at.timestamp()),
        },
        {
            "id": "built-in",
            "name": BuiltInField.source,
            "type": "string",
            "value": MetadataDataSource[document.data_source_type],
        },
    ]


def _load_metadata_details(
    documents: Sequence[Document], *, session: Session
) -> dict[str, list[DocMetadataDetailItem] | None]:
    document_ids = [str(document.id) for document in documents]
    details: dict[str, list[DocMetadataDetailItem] | None] = dict.fromkeys(document_ids)
    metadata_documents = [document for document in documents if document.doc_metadata]
    if not metadata_documents:
        return details

    metadata_document_owner_keys = {
        (str(document.tenant_id), str(document.dataset_id), str(document.id)) for document in metadata_documents
    }
    metadata_by_document: dict[str, list[DatasetMetadata]] = {}
    rows = session.execute(
        select(DatasetMetadataBinding.document_id, DatasetMetadata)
        .join(
            DatasetMetadata,
            and_(
                DatasetMetadata.id == DatasetMetadataBinding.metadata_id,
                DatasetMetadata.tenant_id == DatasetMetadataBinding.tenant_id,
                DatasetMetadata.dataset_id == DatasetMetadataBinding.dataset_id,
            ),
        )
        .where(
            tuple_(
                DatasetMetadataBinding.tenant_id,
                DatasetMetadataBinding.dataset_id,
                DatasetMetadataBinding.document_id,
            ).in_(metadata_document_owner_keys),
        )
    ).all()
    for document_id, metadata in rows:
        metadata_by_document.setdefault(str(document_id), []).append(metadata)

    creator_ids = {str(document.created_by) for document in metadata_documents if document.created_by}
    uploader_names: dict[str, str] = {}
    if creator_ids:
        uploader_names = {
            str(account_id): name
            for account_id, name in session.execute(
                select(Account.id, Account.name).where(Account.id.in_(creator_ids))
            ).all()
        }

    for document in metadata_documents:
        document_id = str(document.id)
        document_metadata: list[DocMetadataDetailItem] = [
            {
                "id": metadata.id,
                "name": metadata.name,
                "type": metadata.type,
                "value": document.doc_metadata.get(metadata.name),
            }
            for metadata in metadata_by_document.get(document_id, [])
        ]
        document_metadata.extend(
            _built_in_metadata(document, uploader_name=uploader_names.get(str(document.created_by)))
        )
        details[document_id] = document_metadata
    return details


@dataclass(frozen=True)
class DocumentResponsePrefetch:
    """Session-backed response fields loaded in batches for a document page."""

    data_source_details: Mapping[str, dict[str, Any]]
    hit_counts: Mapping[str, int]
    metadata_details: Mapping[str, list[DocMetadataDetailItem] | None]
    process_rule_dicts: Mapping[str, ProcessRuleDict | None]
    completed_segment_counts: Mapping[str, int]
    total_segment_counts: Mapping[str, int]
    include_segment_counts: bool

    @classmethod
    def load(
        cls,
        documents: Sequence[Document],
        *,
        session: Session,
        include_segment_counts: bool = False,
    ) -> "DocumentResponsePrefetch":
        document_ids = [str(document.id) for document in documents]
        if not document_ids:
            return cls({}, {}, {}, {}, {}, {}, include_segment_counts)

        hit_counts, completed_counts, total_counts = _load_segment_counts(documents, session=session)
        return cls(
            data_source_details=_load_data_source_details(documents, session=session),
            hit_counts=hit_counts,
            metadata_details=_load_metadata_details(documents, session=session),
            process_rule_dicts=_load_process_rule_dicts(documents, session=session),
            completed_segment_counts=completed_counts,
            total_segment_counts=total_counts,
            include_segment_counts=include_segment_counts,
        )
