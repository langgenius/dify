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


class ExtractSetting(BaseModel):
    """
    Model class for provider response.
    """
    datasource_type: str
    upload_file: UploadFile = None
    notion_info: NotionInfo = None
    document_model: str = None

    def __init__(self, **data) -> None:
        super().__init__(**data)
