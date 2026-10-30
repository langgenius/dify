from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol

from pydantic import BaseModel, ConfigDict, Field

from services.data_source.entities import website as website_entities
from services.entities import upload_file as upload_file_entities


@dataclass(frozen=True)
class ExtractionResult[DocumentType]:
    documents: list[DocumentType]
    created_upload_artifacts: tuple[upload_file_entities.CreatedUploadArtifact, ...] = ()
    source_version: str | None = None


class DatasourceType(StrEnum):
    FILE = "upload_file"
    NOTION = "notion_import"
    WEBSITE = "website_crawl"


@dataclass(frozen=True, slots=True, kw_only=True)
class ExtractedImage:
    """Image content and format emitted by a document parser."""

    content: bytes
    extension: str
    mime_type: str


@dataclass(frozen=True, slots=True, kw_only=True)
class ImageReference:
    """The image preview address a parser can embed in its output."""

    preview_url: str


class ImageWriter(Protocol):
    def write(self, image: ExtractedImage) -> ImageReference: ...


class UploadFileExtractionInput(BaseModel):
    """Detached values required to extract one tenant-owned upload."""

    id: str
    tenant_id: str
    key: str
    created_by: str
    model_config = ConfigDict(from_attributes=True)


class NotionInfo(BaseModel):
    """
    Notion import info.
    """

    credential_id: str | None = None
    notion_workspace_id: str | None = ""
    notion_obj_id: str
    notion_page_type: str
    tenant_id: str
    notion_access_token: str | None = Field(default=None, exclude=True, repr=False)


class WebsiteInfo(BaseModel):
    """
    website import info.
    """

    job_ref: website_entities.WebsiteJobRef
    url: str
    mode: str
    only_main_content: bool = False


class ExtractSetting(BaseModel):
    """
    Model class for provider response.
    """

    datasource_type: str
    upload_file: UploadFileExtractionInput | None = None
    notion_info: NotionInfo | None = None
    website_info: WebsiteInfo | None = None
    document_model: str | None = None
