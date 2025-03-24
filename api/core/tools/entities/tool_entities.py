import base64
import enum
from collections.abc import Mapping
from enum import Enum
from typing import Any, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, ValidationInfo, field_serializer, field_validator, model_validator

from core.entities.provider_entities import ProviderConfig
from core.plugin.entities.parameters import (
    PluginParameter,
    PluginParameterOption,
    PluginParameterType,
    as_normal_type,
    cast_parameter_value,
    init_frontend_parameter,
)
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.constants import TOOL_SELECTOR_MODEL_IDENTITY


class ToolLabelEnum(Enum):
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
    OTHER = "other"


class ToolProviderType(enum.StrEnum):
    """
    Enum class for tool provider
    """

    PLUGIN = "plugin"
    BUILT_IN = "builtin"
    WORKFLOW = "workflow"
    API = "api"
    APP = "app"
    DATASET_RETRIEVAL = "dataset-retrieval"

    @classmethod
    def value_of(cls, value: str) -> "ToolProviderType":
        """
        Get value of given mode.

        :param value: mode value
        :return: mode
        """
        for mode in cls:
            if mode.value == value:
                return mode
        raise ValueError(f"invalid mode value {value}")


class ApiProviderSchemaType(Enum):
    """
    Enum class for api provider schema type.
    """

    OPENAPI = "openapi"
    SWAGGER = "swagger"
    OPENAI_PLUGIN = "openai_plugin"
    OPENAI_ACTIONS = "openai_actions"

    @classmethod
    def value_of(cls, value: str) -> "ApiProviderSchemaType":
        """
        Get value of given mode.

        :param value: mode value
        :return: mode
        """
        for mode in cls:
            if mode.value == value:
                return mode
        raise ValueError(f"invalid mode value {value}")


class ApiProviderAuthType(Enum):
    """
    Enum class for api provider auth type.
    """

    NONE = "none"
    API_KEY = "api_key"

    @classmethod
    def value_of(cls, value: str) -> "ApiProviderAuthType":
        """
        Get value of given mode.

        :param value: mode value
        :return: mode
        """
        for mode in cls:
            if mode.value == value:
                return mode
        raise ValueError(f"invalid mode value {value}")


class ToolInvokeMessage(BaseModel):
    class TextMessage(BaseModel):
        text: str

    class JsonMessage(BaseModel):
        json_object: dict

    class BlobMessage(BaseModel):
        blob: bytes

    class FileMessage(BaseModel):
        pass

    class VariableMessage(BaseModel):
        variable_name: str = Field(..., description="The name of the variable")
        variable_value: Any = Field(..., description="The value of the variable")
        stream: bool = Field(default=False, description="Whether the variable is streamed")

        @model_validator(mode="before")
        @classmethod
        def transform_variable_value(cls, values) -> Any:
            """
            Only basic types and lists are allowed.
            """
            value = values.get("variable_value")
            if not isinstance(value, dict | list | str | int | float | bool):
                raise ValueError("Only basic types and lists are allowed.")

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
        class LogStatus(Enum):
            START = "start"
            ERROR = "error"
            SUCCESS = "success"

        id: str
        label: str = Field(..., description="The label of the log")
        parent_id: Optional[str] = Field(default=None, description="Leave empty for root log")
        error: Optional[str] = Field(default=None, description="The error message")
        status: LogStatus = Field(..., description="The status of the log")
        data: Mapping[str, Any] = Field(..., description="Detailed log data")
        metadata: Optional[Mapping[str, Any]] = Field(default=None, description="The metadata of the log")

    class MessageType(Enum):
        TEXT = "text"
        IMAGE = "image"
        LINK = "link"
        BLOB = "blob"
        JSON = "json"
        IMAGE_LINK = "image_link"
        BINARY_LINK = "binary_link"
        VARIABLE = "variable"
        FILE = "file"
        LOG = "log"

    type: MessageType = MessageType.TEXT
    """
        plain text, image url or link url
    """
    message: JsonMessage | TextMessage | BlobMessage | LogMessage | FileMessage | None | VariableMessage
    meta: dict[str, Any] | None = None

    @field_validator("message", mode="before")
    @classmethod
    def decode_blob_message(cls, v):
        if isinstance(v, dict) and "blob" in v:
            try:
                v["blob"] = base64.b64decode(v["blob"])
            except Exception:
                pass
        return v

    @field_serializer("message")
    def serialize_message(self, v):
        if isinstance(v, self.BlobMessage):
            return {"blob": base64.b64encode(v.blob).decode("utf-8")}
        return v


class ToolInvokeMessageBinary(BaseModel):
    mimetype: str = Field(..., description="The mimetype of the binary")
    url: str = Field(..., description="The url of the binary")
    file_var: Optional[dict[str, Any]] = None


class ToolParameter(PluginParameter):
    """
    Overrides type
    """

    class ToolParameterType(enum.StrEnum):
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
        APP_SELECTOR = PluginParameterType.APP_SELECTOR.value
        MODEL_SELECTOR = PluginParameterType.MODEL_SELECTOR.value

        # deprecated, should not use.
        SYSTEM_FILES = PluginParameterType.SYSTEM_FILES.value

        def as_normal_type(self):
            return as_normal_type(self)

        def cast_value(self, value: Any):
            return cast_parameter_value(self, value)

    class ToolParameterForm(Enum):
        SCHEMA = "schema"  # should be set while adding tool
        FORM = "form"  # should be set before invoking tool
        LLM = "llm"  # will be set by LLM

    type: ToolParameterType = Field(..., description="The type of the parameter")
    human_description: Optional[I18nObject] = Field(default=None, description="The description presented to the user")
    form: ToolParameterForm = Field(..., description="The form of the parameter, schema/form/llm")
    llm_description: Optional[str] = None

    @classmethod
    def get_simple_instance(
        cls,
        name: str,
        llm_description: str,
        typ: ToolParameterType,
        required: bool,
        options: Optional[list[str]] = None,
    ) -> "ToolParameter":
        """
        get a simple tool parameter

        :param name: the name of the parameter
        :param llm_description: the description presented to the LLM
        :param type: the type of the parameter
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
    label: I18nObject = Field(..., description="The label of the tool")
    tags: Optional[list[ToolLabelEnum]] = Field(
        default=[],
        description="The tags of the tool",
    )


class ToolIdentity(BaseModel):
    author: str = Field(..., description="The author of the tool")
    name: str = Field(..., description="The name of the tool")
    label: I18nObject = Field(..., description="The label of the tool")
    provider: str = Field(..., description="The provider of the tool")
    icon: Optional[str] = None


class ToolDescription(BaseModel):
    human: I18nObject = Field(..., description="The description presented to the user")
    llm: str = Field(..., description="The description presented to the LLM")


class ToolEntity(BaseModel):
    identity: ToolIdentity
    parameters: list[ToolParameter] = Field(default_factory=list)
    description: Optional[ToolDescription] = None
    output_schema: Optional[dict] = None
    has_runtime_parameters: bool = Field(default=False, description="Whether the tool has runtime parameters")

    # pydantic configs
    model_config = ConfigDict(protected_namespaces=())

    @field_validator("parameters", mode="before")
    @classmethod
    def set_parameters(cls, v, validation_info: ValidationInfo) -> list[ToolParameter]:
        return v or []


class ToolProviderEntity(BaseModel):
    identity: ToolProviderIdentity
    plugin_id: Optional[str] = None
    credentials_schema: list[ProviderConfig] = Field(default_factory=list)


class ToolProviderEntityWithPlugin(ToolProviderEntity):
    tools: list[ToolEntity] = Field(default_factory=list)


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
    error: Optional[str] = None
    tool_config: Optional[dict] = None

    @classmethod
    def empty(cls) -> "ToolInvokeMeta":
        """
        Get an empty instance of ToolInvokeMeta
        """
        return cls(time_cost=0.0, error=None, tool_config={})

    @classmethod
    def error_instance(cls, error: str) -> "ToolInvokeMeta":
        """
        Get an instance of ToolInvokeMeta with error
        """
        return cls(time_cost=0.0, error=error, tool_config={})

    def to_dict(self) -> dict:
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


class ToolInvokeFrom(Enum):
    """
    Enum class for tool invoke
    """

    WORKFLOW = "workflow"
    AGENT = "agent"
    PLUGIN = "plugin"


class ToolSelector(BaseModel):
    dify_model_identity: str = TOOL_SELECTOR_MODEL_IDENTITY

    class Parameter(BaseModel):
        name: str = Field(..., description="The name of the parameter")
        type: ToolParameter.ToolParameterType = Field(..., description="The type of the parameter")
        required: bool = Field(..., description="Whether the parameter is required")
        description: str = Field(..., description="The description of the parameter")
        default: Optional[Union[int, float, str]] = None
        options: Optional[list[PluginParameterOption]] = None

    provider_id: str = Field(..., description="The id of the provider")
    tool_name: str = Field(..., description="The name of the tool")
    tool_description: str = Field(..., description="The description of the tool")
    tool_configuration: Mapping[str, Any] = Field(..., description="Configuration, type form")
    tool_parameters: Mapping[str, Parameter] = Field(..., description="Parameters, type llm")

    def to_plugin_parameter(self) -> dict[str, Any]:
        return self.model_dump()
