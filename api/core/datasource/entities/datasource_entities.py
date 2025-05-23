import enum
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field, ValidationInfo, field_validator

from core.entities.provider_entities import ProviderConfig
from core.plugin.entities.oauth import OAuthSchema
from core.plugin.entities.parameters import (
    PluginParameter,
    PluginParameterOption,
    PluginParameterType,
    as_normal_type,
    cast_parameter_value,
    init_frontend_parameter,
)
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolLabelEnum


class DatasourceProviderType(enum.StrEnum):
    """
    Enum class for datasource provider
    """

    ONLINE_DOCUMENT = "online_document"
    LOCAL_FILE = "local_file"
    WEBSITE_CRAWL = "website_crawl"

    @classmethod
    def value_of(cls, value: str) -> "DatasourceProviderType":
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

        STRING = PluginParameterType.STRING.value
        NUMBER = PluginParameterType.NUMBER.value
        BOOLEAN = PluginParameterType.BOOLEAN.value
        SELECT = PluginParameterType.SELECT.value
        SECRET_INPUT = PluginParameterType.SECRET_INPUT.value
        FILE = PluginParameterType.FILE.value
        FILES = PluginParameterType.FILES.value

        # deprecated, should not use.
        SYSTEM_FILES = PluginParameterType.SYSTEM_FILES.value

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
        options: Optional[list[str]] = None,
    ) -> "DatasourceParameter":
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
    icon: Optional[str] = None


class DatasourceEntity(BaseModel):
    identity: DatasourceIdentity
    parameters: list[DatasourceParameter] = Field(default_factory=list)
    description: I18nObject = Field(..., description="The label of the datasource")

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
    tags: Optional[list[ToolLabelEnum]] = Field(
        default=[],
        description="The tags of the tool",
    )


class DatasourceProviderEntity(BaseModel):
    """
    Datasource provider entity
    """

    identity: DatasourceProviderIdentity
    credentials_schema: list[ProviderConfig] = Field(default_factory=list)
    oauth_schema: Optional[OAuthSchema] = None
    provider_type: DatasourceProviderType


class DatasourceProviderEntityWithPlugin(DatasourceProviderEntity):
    datasources: list[DatasourceEntity] = Field(default_factory=list)


class DatasourceInvokeMeta(BaseModel):
    """
    Datasource invoke meta
    """

    time_cost: float = Field(..., description="The time cost of the tool invoke")
    error: Optional[str] = None
    tool_config: Optional[dict] = None

    @classmethod
    def empty(cls) -> "DatasourceInvokeMeta":
        """
        Get an empty instance of DatasourceInvokeMeta
        """
        return cls(time_cost=0.0, error=None, tool_config={})

    @classmethod
    def error_instance(cls, error: str) -> "DatasourceInvokeMeta":
        """
        Get an instance of DatasourceInvokeMeta with error
        """
        return cls(time_cost=0.0, error=error, tool_config={})

    def to_dict(self) -> dict:
        return {
            "time_cost": self.time_cost,
            "error": self.error,
            "tool_config": self.tool_config,
        }


class DatasourceLabel(BaseModel):
    """
    Datasource label
    """

    name: str = Field(..., description="The name of the tool")
    label: I18nObject = Field(..., description="The label of the tool")
    icon: str = Field(..., description="The icon of the tool")


class DatasourceInvokeFrom(Enum):
    """
    Enum class for datasource invoke
    """

    RAG_PIPELINE = "rag_pipeline"


class GetOnlineDocumentPagesRequest(BaseModel):
    """
    Get online document pages request
    """


class OnlineDocumentPageIcon(BaseModel):
    """
    Online document page icon
    """

    type: str = Field(..., description="The type of the icon")
    url: str = Field(..., description="The url of the icon")


class OnlineDocumentPage(BaseModel):
    """
    Online document page
    """

    page_id: str = Field(..., description="The page id")
    page_title: str = Field(..., description="The page title")
    page_icon: Optional[OnlineDocumentPageIcon] = Field(None, description="The page icon")
    type: str = Field(..., description="The type of the page")
    last_edited_time: str = Field(..., description="The last edited time")


class OnlineDocumentInfo(BaseModel):
    """
    Online document info
    """

    workspace_id: str = Field(..., description="The workspace id")
    workspace_name: str = Field(..., description="The workspace name")
    workspace_icon: str = Field(..., description="The workspace icon")
    total: int = Field(..., description="The total number of documents")
    pages: list[OnlineDocumentPage] = Field(..., description="The pages of the online document")


class GetOnlineDocumentPagesResponse(BaseModel):
    """
    Get online document pages response
    """

    result: list[OnlineDocumentInfo]


class GetOnlineDocumentPageContentRequest(BaseModel):
    """
    Get online document page content request
    """

    online_document_info: OnlineDocumentInfo


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

    crawl_parameters: dict = Field(..., description="The crawl parameters")


class WebSiteInfo(BaseModel):
    """
    Website info
    """

    source_url: str = Field(..., description="The url of the website")
    content: str = Field(..., description="The content of the website")
    title: str = Field(..., description="The title of the website")
    description: str = Field(..., description="The description of the website")


class GetWebsiteCrawlResponse(BaseModel):
    """
    Get website crawl response
    """

    result: list[WebSiteInfo]
