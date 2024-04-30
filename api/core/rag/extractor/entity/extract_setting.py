from pydantic import BaseModel

from models.dataset import Document
from models.model import UploadFile


class NotionInfo(BaseModel):
    """
    Notion import info.
    """
    notion_workspace_id: str
    notion_obj_id: str
    notion_page_type: str
    document: Document = None
    tenant_id: str

    class Config:
        arbitrary_types_allowed = True

    def __init__(self, **data) -> None:
        super().__init__(**data)

class FirecrawlInfo(BaseModel):
    """
    Firecrawl import info.
    """
    url: str
    mode: str
    ## [Review] Not sure if these belong here
    firecrawl_api_key: str
    firecrawl_base_url: str
    ## ---
    document: Document = None
    tenant_id: str

    class Config:
        arbitrary_types_allowed = True

    def __init__(self, **data) -> None:
        super().__init__(**data)


class ExtractSetting(BaseModel):
    """
    Model class for provider response.
    """
    datasource_type: str
    upload_file: UploadFile = None
    notion_info: NotionInfo = None
    firecrawl_info: FirecrawlInfo = None
    document_model: str = None

    class Config:
        arbitrary_types_allowed = True

    def __init__(self, **data) -> None:
        super().__init__(**data)
