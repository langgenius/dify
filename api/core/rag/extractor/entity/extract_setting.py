from typing import Optional

from pydantic import BaseModel, ConfigDict

from models.dataset import Document
from models.model import UploadFile


class NotionInfo(BaseModel):
    """
    Notion import info.
    """

    notion_workspace_id: str
    notion_obj_id: str
    notion_page_type: str
    document: Optional[Document] = None
    tenant_id: str
    model_config = ConfigDict(arbitrary_types_allowed=True)

    def __init__(self, **data) -> None:
        super().__init__(**data)


class WebsiteInfo(BaseModel):
    """
    website import info.
    """

    provider: str
    job_id: str
    url: str
    mode: str
    tenant_id: str
    only_main_content: bool = False

    class Config:
        arbitrary_types_allowed = True

    def __init__(self, **data) -> None:
        super().__init__(**data)


class ExtractSetting(BaseModel):
    """
    Model class for provider response.
    """

    datasource_type: str
    upload_file: Optional[UploadFile] = None
    notion_info: Optional[NotionInfo] = None
    website_info: Optional[WebsiteInfo] = None
    document_model: Optional[str] = None
    model_config = ConfigDict(arbitrary_types_allowed=True)

    def __init__(self, **data) -> None:
        super().__init__(**data)
