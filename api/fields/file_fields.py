from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, field_validator


class ResponseModel(BaseModel):
    model_config = ConfigDict(
        from_attributes=True,
        extra="ignore",
        populate_by_name=True,
        serialize_by_alias=True,
        protected_namespaces=(),
    )


def _to_timestamp(value: datetime | int | None) -> int | None:
    if isinstance(value, datetime):
        return int(value.timestamp())
    return value


class UploadConfig(ResponseModel):
    file_size_limit: int
    batch_count_limit: int
    file_upload_limit: int | None = None
    image_file_size_limit: int
    video_file_size_limit: int
    audio_file_size_limit: int
    workflow_file_upload_limit: int
    image_file_batch_limit: int
    single_chunk_attachment_limit: int
    attachment_image_file_size_limit: int | None = None


class FileResponse(ResponseModel):
    id: str
    name: str
    size: int
    extension: str | None = None
    mime_type: str | None = None
    created_by: str | None = None
    created_at: int | None = None
    preview_url: str | None = None
    source_url: str | None = None
    original_url: str | None = None
    user_id: str | None = None
    tenant_id: str | None = None
    conversation_id: str | None = None
    file_key: str | None = None

    @field_validator("created_at", mode="before")
    @classmethod
    def _normalize_created_at(cls, value: datetime | int | None) -> int | None:
        return _to_timestamp(value)


class RemoteFileInfo(ResponseModel):
    file_type: str
    file_length: int


class FileWithSignedUrl(ResponseModel):
    id: str
    name: str
    size: int
    extension: str | None = None
    url: str | None = None
    mime_type: str | None = None
    created_by: str | None = None
    created_at: int | None = None

    @field_validator("created_at", mode="before")
    @classmethod
    def _normalize_created_at(cls, value: datetime | int | None) -> int | None:
        return _to_timestamp(value)


__all__ = [
    "FileResponse",
    "FileWithSignedUrl",
    "RemoteFileInfo",
    "UploadConfig",
]
