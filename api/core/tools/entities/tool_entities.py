from __future__ import annotations

import base64
import contextlib
from collections.abc import Mapping
from enum import StrEnum, auto
from typing import Any, Union

from pydantic import BaseModel, ConfigDict, Field, ValidationInfo, field_serializer, field_validator, model_validator

from core.entities.provider_entities import ProviderConfig
from core.plugin.entities.parameters import (
    MCPServerParameterType,
    PluginParameter,
    PluginParameterOption,
    PluginParameterType,
    as_normal_type,
    cast_parameter_value,
    init_frontend_parameter,
)
from core.rag.entities.citation_metadata import RetrievalSourceMetadata
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.constants import TOOL_SELECTOR_MODEL_IDENTITY


class ToolLabelEnum(StrEnum):
    SEARCH = "search"
    IMAGE = "image"
    VIDEOS = "videos"
    WEATHER = "weather"
    FINANCE = "finance"
    DESIGN = "design"
    TRAVEL = "travel"
    SOCIAL = "social"
    NEWS = "news"
    MEDICAL = "medical"
    PRODUCTIVITY = "productivity"
    EDUCATION = "education"
    BUSINESS = "business"
    ENTERTAINMENT = "entertainment"
    UTILITIES = "utilities"
    RAG = "rag"
    OTHER = "other"


class ToolProviderType(StrEnum):
    """
    Enum class for tool provider
    """

    PLUGIN = auto()
    BUILT_IN = "builtin"
    WORKFLOW = auto()
    API = auto()
    APP = auto()
    DATASET_RETRIEVAL = "dataset-retrieval"
    MCP = auto()

    @classmethod
    def value_of(cls, value: str) -> ToolProviderType:
        """
        Get value of given mode.

        :param value: mode value
        :return: mode
        """
        for mode in cls:
            if mode.value == value:
                return mode
        raise ValueError(f"invalid mode value {value}")


class ApiProviderSchemaType(StrEnum):
    """
    Enum class for api provider schema type.
    """

    OPENAPI = auto()
    SWAGGER = auto()
    OPENAI_PLUGIN = auto()
    OPENAI_ACTIONS = auto()

    @classmethod
    def value_of(cls, value: str) -> ApiProviderSchemaType:
        """
        Get value of given mode.

        :param value: mode value
        :return: mode
        """
        for mode in cls:
            if mode.value == value:
                return mode
        raise ValueError(f"invalid mode value {value}")


class ApiProviderAuthType(StrEnum):
    """
    Enum class for api provider auth type.
    """

    NONE = auto()
    API_KEY_HEADER = auto()
    API_KEY_QUERY = auto()

    @classmethod
    def value_of(cls, value: str) -> ApiProviderAuthType:
        """
        Get value of given mode.

        :param value: mode value
        :return: mode
        """
        # 'api_key' deprecated in PR #21656
        # normalize & tiny alias for backward compatibility
        v = (value or "").strip().lower()
        if v == "api_key":
            v = cls.API_KEY_HEADER

        for mode in cls:
            if mode.value == v:
                return mode

        valid = ", ".join(m.value for m in cls)
        raise ValueError(f"invalid mode value '{value}', expected one of: {valid}")


class ToolInvokeMessage(BaseModel):
    class TextMessage(BaseModel):
        text: str

    class JsonMessage(BaseModel):
        json_object: dict | list
        suppress_output: bool = Field(default=False, description="Whether to suppress JSON output in result string")

    class BlobMessage(BaseModel):
        blob: bytes

    class BlobChunkMessage(BaseModel):
        id: str = Field(..., description="The id of the blob")
        sequence: int = Field(..., description="The sequence of the chunk")
        total_length: int = Field(..., description="The total length of the blob")
        blob: bytes = Field(..., description="The blob data of the chunk")
        end: bool = Field(..., description="Whether the chunk is the last chunk")

    class FileMessage(BaseModel):
        file_marker: str = Field(default="file_marker")

        @model_validator(mode="before")
        @classmethod
        def validate_file_message(cls, values):
            if isinstance(values, dict) and "file_marker" not in values:
                raise ValueError("Invalid FileMessage: missing file_marker")
            return values

    class VariableMessage(BaseModel):
        variable_name: str = Field(..., description="The name of the variable")
        variable_value: Any = Field(..., description="The value of the variable")
        stream: bool = Field(default=False, description="Whether the variable is streamed")

        @model_validator(mode="before")
        @classmethod
        def transform_variable_value(cls, values):
            """
            Only basic types, lists, and None are allowed.
            """
            value = values.get("variable_value")
            if value is not None and not isinstance(value, dict | list | str | int | float | bool):
                raise ValueError("Only basic types, lists, and None are allowed.")

            # if stream is true, the value must be a string
            if values.get("stream"):
                if not isinstance(value, str):
                    raise ValueError("When 'stream' is True, 'variable_value' must be a string.")

            return values

        @field_validator("variable_name", mode="before")
        @classmethod
        def transform_variable_name(cls, value: str) -> str:
            """
            The variable name must be a string.
            """
            if value in {"json", "text", "files"}:
                raise ValueError(f"The variable name '{value}' is reserved.")
            return value

    class LogMessage(BaseModel):
        class LogStatus(StrEnum):
            START = auto()
            ERROR = auto()
            SUCCESS = auto()

        id: str
        label: str = Field(..., description="The label of the log")
        parent_id: str | None = Field(default=None, description="Leave empty for root log")
        error: str | None = Field(default=None, description="The error message")
        status: LogStatus = Field(..., description="The status of the log")
        data: Mapping[str, Any] = Field(..., description="Detailed log data")
        metadata: Mapping[str, Any] = Field(default_factory=dict, description="The metadata of the log")

        @field_validator("metadata", mode="before")
        @classmethod
        def _normalize_metadata(cls, value: Mapping[str, Any] | None) -> Mapping[str, Any]:
            return value or {}

    class RetrieverResourceMessage(BaseModel):
        retriever_resources: list[RetrievalSourceMetadata] = Field(..., description="retriever resources")
        context: str = Field(..., description="context")

    class MessageType(StrEnum):
        TEXT = auto()
        IMAGE = auto()
        LINK = auto()
        BLOB = auto()
        JSON = auto()
        IMAGE_LINK = auto()
        BINARY_LINK = auto()
        VARIABLE = auto()
        FILE = auto()
        LOG = auto()
        BLOB_CHUNK = auto()
        RETRIEVER_RESOURCES = auto()

    type: MessageType = MessageType.TEXT
    """
        plain text, image url or link url
    """
    message: (
        JsonMessage
        | TextMessage
        | BlobChunkMessage
        | BlobMessage
        | LogMessage
        | FileMessage
        | None
        | VariableMessage
        | RetrieverResourceMessage
    )
    meta: dict[str, Any] | None = None

    @field_validator("message", mode="before")
    @classmethod
    def decode_blob_message(cls, v, info: ValidationInfo):
        # 处理 blob 解码
        if isinstance(v, dict) and "blob" in v:
            with contextlib.suppress(Exception):
                v["blob"] = base64.b64decode(v["blob"])

        # Force correct message type based on type field
        # Only wrap dict types to avoid wrapping already parsed Pydantic model objects
        if info.data and isinstance(info.data, dict) and isinstance(v, dict):
            msg_type = info.data.get("type")
            if msg_type == cls.MessageType.JSON:
                if "json_object" not in v:
                    v = {"json_object": v}
            elif msg_type == cls.MessageType.FILE:
                v = {"file_marker": "file_marker"}

        return v

    @field_serializer("message")
    def serialize_message(self, v):
        if isinstance(v, self.BlobMessage):
            return {"blob": base64.b64encode(v.blob).decode("utf-8")}
        return v


class ToolInvokeMessageBinary(BaseModel):
    mimetype: str = Field(..., description="The mimetype of the binary")
    url: str = Field(..., description="The url of the binary")
    file_var: dict[str, Any] | None = None


class ToolParameter(PluginParameter):
    """
    Overrides type
    """

    class ToolParameterType(StrEnum):
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
        CHECKBOX = PluginParameterType.CHECKBOX
        APP_SELECTOR = PluginParameterType.APP_SELECTOR
        MODEL_SELECTOR = PluginParameterType.MODEL_SELECTOR
        ANY = PluginParameterType.ANY
        DYNAMIC_SELECT = PluginParameterType.DYNAMIC_SELECT

        # MCP object and array type parameters
        ARRAY = MCPServerParameterType.ARRAY
        OBJECT = MCPServerParameterType.OBJECT

        # deprecated, should not use.
        SYSTEM_FILES = PluginParameterType.SYSTEM_FILES

        def as_normal_type(self):
            return as_normal_type(self)

        def cast_value(self, value: Any):
            return cast_parameter_value(self, value)

    class ToolParameterForm(StrEnum):
        SCHEMA = auto()  # should be set while adding tool
        FORM = auto()  # should be set before invoking tool
        LLM = auto()  # will be set by LLM

    type: ToolParameterType = Field(..., description="The type of the parameter")
    human_description: I18nObject | None = Field(default=None, description="The description presented to the user")
    form: ToolParameterForm = Field(..., description="The form of the parameter, schema/form/llm")
    llm_description: str | None = None
    # MCP object and array type parameters use this field to store the schema
    input_schema: dict | None = None

    @classmethod
    def get_simple_instance(
        cls,
        name: str,
        llm_description: str,
        typ: ToolParameterType,
        required: bool,
        options: list[str] | None = None,
    ) -> ToolParameter:
        """
        get a simple tool parameter

        :param name: the name of the parameter
        :param llm_description: the description presented to the LLM
        :param typ: the type of the parameter
        :param required: if the parameter is required
        :param options: the options of the parameter
        """
        # convert options to ToolParameterOption
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
            human_description=I18nObject(en_US="", zh_Hans=""),
            type=typ,
            form=cls.ToolParameterForm.LLM,
            llm_description=llm_description,
            required=required,
            options=option_objs,
        )

    def init_frontend_parameter(self, value: Any):
        return init_frontend_parameter(self, self.type, value)


class ToolProviderIdentity(BaseModel):
    author: str = Field(..., description="The author of the tool")
    name: str = Field(..., description="The name of the tool")
    description: I18nObject = Field(..., description="The description of the tool")
    icon: str = Field(..., description="The icon of the tool")
    icon_dark: str | None = Field(default=None, description="The dark icon of the tool")
    label: I18nObject = Field(..., description="The label of the tool")
    tags: list[ToolLabelEnum] | None = Field(
        default=[],
        description="The tags of the tool",
    )


class ToolIdentity(BaseModel):
    author: str = Field(..., description="The author of the tool")
    name: str = Field(..., description="The name of the tool")
    label: I18nObject = Field(..., description="The label of the tool")
    provider: str = Field(..., description="The provider of the tool")
    icon: str | None = None


class ToolDescription(BaseModel):
    human: I18nObject = Field(..., description="The description presented to the user")
    llm: str = Field(..., description="The description presented to the LLM")


class ToolEntity(BaseModel):
    identity: ToolIdentity
    parameters: list[ToolParameter] = Field(default_factory=list[ToolParameter])
    description: ToolDescription | None = None
    output_schema: Mapping[str, object] = Field(default_factory=dict)
    has_runtime_parameters: bool = Field(default=False, description="Whether the tool has runtime parameters")

    # pydantic configs
    model_config = ConfigDict(protected_namespaces=())

    @field_validator("parameters", mode="before")
    @classmethod
    def set_parameters(cls, v, validation_info: ValidationInfo) -> list[ToolParameter]:
        return v or []

    @field_validator("output_schema", mode="before")
    @classmethod
    def _normalize_output_schema(cls, value: Mapping[str, object] | None) -> Mapping[str, object]:
        return value or {}


class OAuthSchema(BaseModel):
    client_schema: list[ProviderConfig] = Field(
        default_factory=list[ProviderConfig], description="The schema of the OAuth client"
    )
    credentials_schema: list[ProviderConfig] = Field(
        default_factory=list[ProviderConfig], description="The schema of the OAuth credentials"
    )


class ToolProviderEntity(BaseModel):
    identity: ToolProviderIdentity
    plugin_id: str | None = None
    credentials_schema: list[ProviderConfig] = Field(default_factory=list[ProviderConfig])
    oauth_schema: OAuthSchema | None = None


class ToolProviderEntityWithPlugin(ToolProviderEntity):
    tools: list[ToolEntity] = Field(default_factory=list[ToolEntity])


class WorkflowToolParameterConfiguration(BaseModel):
    """
    Workflow tool configuration
    """

    name: str = Field(..., description="The name of the parameter")
    description: str = Field(..., description="The description of the parameter")
    form: ToolParameter.ToolParameterForm = Field(..., description="The form of the parameter")


class ToolInvokeMeta(BaseModel):
    """
    Tool invoke meta
    """

    time_cost: float = Field(..., description="The time cost of the tool invoke")
    error: str | None = None
    tool_config: dict | None = None

    @classmethod
    def empty(cls) -> ToolInvokeMeta:
        """
        Get an empty instance of ToolInvokeMeta
        """
        return cls(time_cost=0.0, error=None, tool_config={})

    @classmethod
    def error_instance(cls, error: str) -> ToolInvokeMeta:
        """
        Get an instance of ToolInvokeMeta with error
        """
        return cls(time_cost=0.0, error=error, tool_config={})

    def to_dict(self):
        return {
            "time_cost": self.time_cost,
            "error": self.error,
            "tool_config": self.tool_config,
        }


class ToolLabel(BaseModel):
    """
    Tool label
    """

    name: str = Field(..., description="The name of the tool")
    label: I18nObject = Field(..., description="The label of the tool")
    icon: str = Field(..., description="The icon of the tool")


class ToolInvokeFrom(StrEnum):
    """
    Enum class for tool invoke
    """

    WORKFLOW = auto()
    AGENT = auto()
    PLUGIN = auto()


class ToolSelector(BaseModel):
    dify_model_identity: str = TOOL_SELECTOR_MODEL_IDENTITY

    class Parameter(BaseModel):
        name: str = Field(..., description="The name of the parameter")
        type: ToolParameter.ToolParameterType = Field(..., description="The type of the parameter")
        required: bool = Field(..., description="Whether the parameter is required")
        description: str = Field(..., description="The description of the parameter")
        default: Union[int, float, str] | None = None
        options: list[PluginParameterOption] | None = None

    provider_id: str = Field(..., description="The id of the provider")
    credential_id: str | None = Field(default=None, description="The id of the credential")
    tool_name: str = Field(..., description="The name of the tool")
    tool_description: str = Field(..., description="The description of the tool")
    tool_configuration: Mapping[str, Any] = Field(..., description="Configuration, type form")
    tool_parameters: Mapping[str, Parameter] = Field(..., description="Parameters, type llm")

    def to_plugin_parameter(self) -> dict[str, Any]:
        return self.model_dump()
