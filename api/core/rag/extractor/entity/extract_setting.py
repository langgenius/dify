from typing import Literal

from pydantic import BaseModel, ConfigDict, field_validator

from core.rag.extractor.entity.datasource_type import DatasourceType
from models.dataset import Document
from models.model import UploadFile
from services.auth.auth_type import AuthType


class NotionInfo(BaseModel):
    """
    Notion import info.
    """

    credential_id: str | None = None
    notion_workspace_id: str | None = ""
    notion_obj_id: str
    notion_page_type: Literal["database", "page"]
    document: Document | None = None
    tenant_id: str
    model_config = ConfigDict(arbitrary_types_allowed=True)


class WebsiteInfo(BaseModel):
    """
    website import info.
    """

    model_config = ConfigDict(arbitrary_types_allowed=True)

    provider: AuthType
    job_id: str
    url: str
    mode: Literal["crawl", "crawl_return_urls", "scrape"]
    tenant_id: str
    only_main_content: bool = False

    @field_validator("mode", mode="before")
    @classmethod
    def _normalize_legacy_mode(cls, value: str) -> str:
        if value == "single":
            return "crawl"
        return value


class ExtractSetting(BaseModel):
    """
    Model class for provider response.
    """

    datasource_type: DatasourceType
    upload_file: UploadFile | None = None
    notion_info: NotionInfo | None = None
    website_info: WebsiteInfo | None = None
    document_model: str | None = None
    model_config = ConfigDict(arbitrary_types_allowed=True)
