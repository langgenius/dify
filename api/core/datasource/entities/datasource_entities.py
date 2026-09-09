from __future__ import annotations

import enum
import re
import string
from datetime import datetime
from enum import StrEnum
from typing import Any, Literal, TypedDict

from pydantic import BaseModel, Field, ValidationInfo, field_validator
from yarl import URL

from configs import dify_config
from core.entities.provider_entities import ProviderConfig
from core.plugin.entities import OAuthSchema
from core.plugin.entities.parameters import (
    PluginParameter,
    PluginParameterOption,
    PluginParameterType,
    as_normal_type,
    cast_parameter_value,
    init_frontend_parameter,
)
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolInvokeMessage, ToolLabelEnum


class DatasourceProviderType(enum.StrEnum):
    """
    Enum class for datasource provider
    """

    ONLINE_DOCUMENT = "online_document"
    LOCAL_FILE = "local_file"
    WEBSITE_CRAWL = "website_crawl"
    ONLINE_DRIVE = "online_drive"

    @classmethod
    def value_of(cls, value: str) -> DatasourceProviderType:
        """
        Get value of given mode.

        :param value: mode value
        :return: mode
        """
        for mode in cls:
            if mode.value == value:
                return mode
        raise ValueError(f"invalid mode value {value}")


class DatasourceParameter(PluginParameter):
    """
    Overrides type
    """

    class DatasourceParameterType(enum.StrEnum):
        """
        removes TOOLS_SELECTOR from PluginParameterType
        """

        STRING = PluginParameterType.STRING
        NUMBER = PluginParameterType.NUMBER
        BOOLEAN = PluginParameterType.BOOLEAN
        SELECT = PluginParameterType.SELECT
        SECRET_INPUT = PluginParameterType.SECRET_INPUT
        FILE = PluginParameterType.FILE
        FILES = PluginParameterType.FILES

        # deprecated, should not use.
        SYSTEM_FILES = PluginParameterType.SYSTEM_FILES

        def as_normal_type(self):
            return as_normal_type(self)

        def cast_value(self, value: Any):
            return cast_parameter_value(self, value)

    type: DatasourceParameterType = Field(..., description="The type of the parameter")
    description: I18nObject = Field(..., description="The description of the parameter")

    @classmethod
    def get_simple_instance(
        cls,
        name: str,
        typ: DatasourceParameterType,
        required: bool,
        options: list[str] | None = None,
    ) -> DatasourceParameter:
        """
        get a simple datasource parameter

        :param name: the name of the parameter
        :param llm_description: the description presented to the LLM
        :param typ: the type of the parameter
        :param required: if the parameter is required
        :param options: the options of the parameter
        """
        # convert options to ToolParameterOption
        # FIXME fix the type error
        if options:
            option_objs = [
                PluginParameterOption(value=option, label=I18nObject(en_US=option, zh_Hans=option))
                for option in options
            ]
        else:
            option_objs = []

        return cls(
            name=name,
            label=I18nObject(en_US="", zh_Hans=""),
            placeholder=None,
            type=typ,
            required=required,
            options=option_objs,
            description=I18nObject(en_US="", zh_Hans=""),
        )

    def init_frontend_parameter(self, value: Any):
        return init_frontend_parameter(self, self.type, value)


class DatasourceIdentity(BaseModel):
    author: str = Field(..., description="The author of the datasource")
    name: str = Field(..., description="The name of the datasource")
    label: I18nObject = Field(..., description="The label of the datasource")
    provider: str = Field(..., description="The provider of the datasource")
    icon: str | None = None


class DatasourceEntity(BaseModel):
    identity: DatasourceIdentity
    parameters: list[DatasourceParameter] = Field(default_factory=list)
    description: I18nObject = Field(..., description="The label of the datasource")
    output_schema: dict[str, Any] | None = None

    @field_validator("parameters", mode="before")
    @classmethod
    def set_parameters(cls, v, validation_info: ValidationInfo) -> list[DatasourceParameter]:
        return v or []


class DatasourceProviderIdentity(BaseModel):
    author: str = Field(..., description="The author of the tool")
    name: str = Field(..., description="The name of the tool")
    description: I18nObject = Field(..., description="The description of the tool")
    icon: str = Field(..., description="The icon of the tool")
    label: I18nObject = Field(..., description="The label of the tool")
    tags: list[ToolLabelEnum] | None = Field(
        default=[],
        description="The tags of the tool",
    )

    def generate_datasource_icon_url(self, tenant_id: str) -> str:
        HARD_CODED_DATASOURCE_ICONS = ["https://assets.dify.ai/images/File%20Upload.svg"]
        if self.icon in HARD_CODED_DATASOURCE_ICONS:
            return self.icon
        return str(
            URL(dify_config.CONSOLE_API_URL or "/")
            / "console"
            / "api"
            / "workspaces"
            / "current"
            / "plugin"
            / "icon"
            % {"tenant_id": tenant_id, "filename": self.icon}
        )


class DatasourceProviderEntity(BaseModel):
    """
    Datasource provider entity
    """

    identity: DatasourceProviderIdentity
    credentials_schema: list[ProviderConfig] = Field(default_factory=list)
    oauth_schema: OAuthSchema | None = None
    provider_type: DatasourceProviderType


class DatasourceProviderEntityWithPlugin(DatasourceProviderEntity):
    datasources: list[DatasourceEntity] = Field(default_factory=list)


class DatasourceInvokeMetaDict(TypedDict):
    time_cost: float
    error: str | None
    tool_config: dict[str, Any] | None


class DatasourceInvokeMeta(BaseModel):
    """
    Datasource invoke meta
    """

    time_cost: float = Field(..., description="The time cost of the tool invoke")
    error: str | None = None
    tool_config: dict[str, Any] | None = None

    @classmethod
    def empty(cls) -> DatasourceInvokeMeta:
        """
        Get an empty instance of DatasourceInvokeMeta
        """
        return cls(time_cost=0.0, error=None, tool_config={})

    @classmethod
    def error_instance(cls, error: str) -> DatasourceInvokeMeta:
        """
        Get an instance of DatasourceInvokeMeta with error
        """
        return cls(time_cost=0.0, error=error, tool_config={})

    def to_dict(self) -> DatasourceInvokeMetaDict:
        result: DatasourceInvokeMetaDict = {
            "time_cost": self.time_cost,
            "error": self.error,
            "tool_config": self.tool_config,
        }
        return result


class DatasourceLabel(BaseModel):
    """
    Datasource label
    """

    name: str = Field(..., description="The name of the tool")
    label: I18nObject = Field(..., description="The label of the tool")
    icon: str = Field(..., description="The icon of the tool")


class DatasourceInvokeFrom(StrEnum):
    """
    Enum class for datasource invoke
    """

    RAG_PIPELINE = "rag_pipeline"


class OnlineDocumentPage(BaseModel):
    """
    Online document page
    """

    page_id: str = Field(..., description="The page id")
    page_name: str = Field(..., description="The page title")
    page_icon: dict[str, Any] | None = Field(None, description="The page icon")
    type: str = Field(..., description="The type of the page")
    last_edited_time: str = Field(..., description="The last edited time")
    parent_id: str | None = Field(None, description="The parent page id")


class OnlineDocumentInfo(BaseModel):
    """
    Online document info
    """

    workspace_id: str | None = Field(None, description="The workspace id")
    workspace_name: str | None = Field(None, description="The workspace name")
    workspace_icon: str | None = Field(None, description="The workspace icon")
    total: int = Field(..., description="The total number of documents")
    pages: list[OnlineDocumentPage] = Field(..., description="The pages of the online document")


class OnlineDocumentPagesMessage(BaseModel):
    """
    Get online document pages response
    """

    result: list[OnlineDocumentInfo]


class GetOnlineDocumentPageContentRequest(BaseModel):
    """
    Get online document page content request
    """

    workspace_id: str = Field(..., description="The workspace id")
    page_id: str = Field(..., description="The page id")
    type: str = Field(..., description="The type of the page")


class OnlineDocumentPageContent(BaseModel):
    """
    Online document page content
    """

    workspace_id: str = Field(..., description="The workspace id")
    page_id: str = Field(..., description="The page id")
    content: str = Field(..., description="The content of the page")


class GetOnlineDocumentPageContentResponse(BaseModel):
    """
    Get online document page content response
    """

    result: OnlineDocumentPageContent


class GetWebsiteCrawlRequest(BaseModel):
    """
    Get website crawl request
    """

    crawl_parameters: dict[str, Any] = Field(..., description="The crawl parameters")


class WebSiteInfoDetail(BaseModel):
    source_url: str = Field(..., description="The url of the website")
    content: str = Field(..., description="The content of the website")
    title: str = Field(..., description="The title of the website")
    description: str = Field(..., description="The description of the website")


class WebSiteInfo(BaseModel):
    """
    Website info
    """

    status: str | None = Field(..., description="crawl job status")
    web_info_list: list[WebSiteInfoDetail] | None = []
    total: int | None = Field(default=0, description="The total number of websites")
    completed: int | None = Field(default=0, description="The number of completed websites")


class WebsiteCrawlMessage(BaseModel):
    """
    Get website crawl response
    """

    result: WebSiteInfo = WebSiteInfo(status="", web_info_list=[], total=0, completed=0)


#########################
# Online drive file
#########################


class OnlineDriveChecksum(TypedDict):
    """Optional full-file checksum supplied by an online-drive provider."""

    algorithm: Literal["md5", "sha256"]
    value: str


class OnlineDriveRemoteMetadata(TypedDict, total=False):
    """Bounded wire metadata used as a hint for online-drive change detection."""

    version_id: str
    etag: str
    checksum: OnlineDriveChecksum
    modified_time: str


_ONLINE_DRIVE_TIMESTAMP_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$")


def _online_drive_token(value: Any) -> str | None:
    if (
        not isinstance(value, str)
        or not value.strip()
        or len(value) > 1024
        or any(ord(character) < 32 or ord(character) == 127 for character in value)
    ):
        return None
    return value


def _online_drive_timestamp(value: Any) -> str | None:
    if not isinstance(value, str) or len(value) > 64 or not _ONLINE_DRIVE_TIMESTAMP_PATTERN.fullmatch(value):
        return None
    try:
        datetime.fromisoformat(value)
    except ValueError:
        return None
    return value


def _bounded_online_drive_remote_metadata(value: Any) -> OnlineDriveRemoteMetadata | None:
    """Keep only the optional, non-secret fields understood by KnowledgeFS."""
    if not isinstance(value, dict):
        return None

    result: OnlineDriveRemoteMetadata = {}
    version_id = _online_drive_token(value.get("version_id"))
    if version_id and version_id != "null":
        result["version_id"] = version_id
    etag = _online_drive_token(value.get("etag"))
    if etag and not etag.lower().startswith("w/"):
        result["etag"] = etag
    modified_time = _online_drive_timestamp(value.get("modified_time"))
    if modified_time:
        result["modified_time"] = modified_time

    checksum = value.get("checksum")
    if isinstance(checksum, dict):
        algorithm, digest = checksum.get("algorithm"), checksum.get("value")
        normalized_algorithm: Literal["md5", "sha256"] | None = None
        if algorithm == "md5":
            normalized_algorithm = "md5"
        elif algorithm == "sha256":
            normalized_algorithm = "sha256"
        digest_length = 32 if normalized_algorithm == "md5" else 64 if normalized_algorithm == "sha256" else None
        if (
            normalized_algorithm is not None
            and digest_length is not None
            and isinstance(digest, str)
            and len(digest) == digest_length
            and all(character in string.hexdigits for character in digest)
        ):
            result["checksum"] = {"algorithm": normalized_algorithm, "value": digest.lower()}
    return result or None


class DatasourceMessage(ToolInvokeMessage):
    pass


class OnlineDriveDownloadMessage(DatasourceMessage):
    """Datasource invoke message with a bounded online-drive download receipt."""

    @field_validator("meta", mode="before")
    @classmethod
    def bounded_remote_metadata(cls, value: Any) -> Any:
        if not isinstance(value, dict) or "remote_metadata" not in value:
            return value
        result = dict(value)
        remote_metadata = _bounded_online_drive_remote_metadata(value.get("remote_metadata"))
        if remote_metadata:
            result["remote_metadata"] = remote_metadata
        else:
            result.pop("remote_metadata", None)
        return result


class OnlineDriveFile(BaseModel):
    """Online drive file."""

    id: str = Field(..., description="The file ID")
    name: str = Field(..., description="The file name")
    size: int = Field(..., description="The file size")
    type: str = Field(..., description="The file type: folder or file")
    remote_metadata: OnlineDriveRemoteMetadata | None = Field(
        None,
        description="Optional provider version_id, etag, checksum and modified_time; not credentials",
    )

    @field_validator("remote_metadata", mode="before")
    @classmethod
    def bounded_remote_metadata(cls, value: Any) -> OnlineDriveRemoteMetadata | None:
        """Keep the optional wire extension bounded without rejecting legacy file listings."""
        return _bounded_online_drive_remote_metadata(value)


class OnlineDriveFileBucket(BaseModel):
    """
    Online drive file bucket
    """

    bucket: str | None = Field(None, description="The file bucket")
    files: list[OnlineDriveFile] = Field(..., description="The file list")
    is_truncated: bool = Field(False, description="Whether the result is truncated")
    next_page_parameters: dict[str, Any] | None = Field(None, description="Parameters for fetching the next page")


class OnlineDriveBrowseFilesRequest(BaseModel):
    """
    Get online drive file list request
    """

    bucket: str | None = Field(None, description="The file bucket")
    prefix: str = Field(..., description="The parent folder ID")
    max_keys: int = Field(20, description="Page size for pagination")
    next_page_parameters: dict[str, Any] | None = Field(None, description="Parameters for fetching the next page")


class OnlineDriveBrowseFilesResponse(BaseModel):
    """
    Get online drive file list response
    """

    result: list[OnlineDriveFileBucket] = Field(..., description="The list of file buckets")


class OnlineDriveDownloadFileRequest(BaseModel):
    """
    Get online drive file
    """

    id: str = Field(..., description="The id of the file")
    bucket: str = Field("", description="The name of the bucket")

    @field_validator("bucket", mode="before")
    @classmethod
    def _coerce_bucket(cls, v) -> str:
        if v is None:
            return ""
        return str(v)
