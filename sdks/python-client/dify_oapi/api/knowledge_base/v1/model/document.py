from __future__ import annotations

from pydantic import BaseModel


class Document(BaseModel):
    id: str | None = None
    position: int | None = None
    data_source_type: str | None = None
    data_source_info: DocumentDataSourceInfo | None = None
    data_source_detail_dict: DocumentDataSourceDetailDict | None = None
    dataset_process_rule_id: str | None = None
    name: str | None = None
    created_from: str | None = None
    created_by: str | None = None
    created_at: int | None = None
    tokens: int | None = None
    indexing_status: str | None = None
    error: str | None = None
    enabled: bool | None = None
    disabled_at: int | None = None
    disabled_by: str | None = None
    archived: bool | None = None
    display_status: str | None = None
    word_count: int | None = None
    hit_count: int | None = None
    doc_form: str | None = None


class DocumentDataSourceInfo(BaseModel):
    upload_file_id: str | None = None


class DocumentDataSourceDetailDict(BaseModel):
    upload_file: DocumentDataSourceDetailDictUploadFile | None = None


class DocumentDataSourceDetailDictUploadFile(BaseModel):
    id: str | None = None
    name: str | None = None
    size: int | None = None
    extension: str | None = None
    mime_type: str | None = None
    created_by: str | None = None
    created_at: float | None = None
