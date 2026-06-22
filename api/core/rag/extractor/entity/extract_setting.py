from pydantic import BaseModel, ConfigDict

from models.dataset import Document
from models.model import UploadFile


class NotionInfo(BaseModel):
    """
    Notion import info.
    """

    credential_id: str = None
    notion_workspace_id: str | None = ""
    notion_obj_id: str
    notion_page_type: str
    document: Document = None
    tenant_id: str
    model_config = ConfigDict(arbitrary_types_allowed=True)


class WebsiteInfo(BaseModel):
    """
    website import info.
    """

    model_config = ConfigDict(arbitrary_types_allowed=True)

    provider: str
    job_id: str
    url: str
    mode: str
    tenant_id: str
    only_main_content: bool = False


class ExtractSetting(BaseModel):
    """
    Model class for provider response.
    """

    datasource_type: str
    upload_file: UploadFile = None
    notion_info: NotionInfo = None
    website_info: WebsiteInfo = None
    document_model: str = None
    model_config = ConfigDict(arbitrary_types_allowed=True)
