from pydantic import BaseModel, ConfigDict, Field


class UploadFileExtractionInput(BaseModel):
    """Detached values required to extract one tenant-owned upload."""

    id: str
    tenant_id: str
    key: str
    created_by: str
    model_config = ConfigDict(from_attributes=True)


class StoredDocumentExtractionInput(BaseModel):
    """Detached document values needed to record a source's last edited time."""

    id: str
    tenant_id: str
    dataset_id: str
    data_source_info_dict: dict[str, object] | None
    model_config = ConfigDict(from_attributes=True)


class NotionInfo(BaseModel):
    """
    Notion import info.
    """

    credential_id: str | None = None
    notion_workspace_id: str | None = ""
    notion_obj_id: str
    notion_page_type: str
    document: StoredDocumentExtractionInput | None = None
    tenant_id: str
    notion_access_token: str | None = Field(default=None, exclude=True, repr=False)


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


class ExtractSetting(BaseModel):
    """
    Model class for provider response.
    """

    datasource_type: str
    upload_file: UploadFileExtractionInput | None = None
    notion_info: NotionInfo | None = None
    website_info: WebsiteInfo | None = None
    document_model: str | None = None
