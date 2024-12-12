import base64
import enum
from enum import Enum
from typing import Any, Mapping, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, ValidationInfo, field_serializer, field_validator

from core.entities.parameter_entities import (
    AppSelectorScope,
    CommonParameterType,
    ModelSelectorScope,
    ToolSelectorScope,
)
from core.entities.provider_entities import ProviderConfig
from core.tools.entities.common_entities import I18nObject


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
        variable_value: str = Field(..., description="The value of the variable")
        stream: bool = Field(default=False, description="Whether the variable is streamed")

        @field_validator("variable_value", mode="before")
        @classmethod
        def transform_variable_value(cls, value, values) -> Any:
            """
            Only basic types and lists are allowed.
            """
            if not isinstance(value, dict | list | str | int | float | bool):
                raise ValueError("Only basic types and lists are allowed.")

            # if stream is true, the value must be a string
            if values.get("stream"):
                if not isinstance(value, str):
                    raise ValueError("When 'stream' is True, 'variable_value' must be a string.")

            return value

        @field_validator("variable_name", mode="before")
        @classmethod
        def transform_variable_name(cls, value) -> str:
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
        parent_id: Optional[str] = Field(default=None, description="Leave empty for root log")
        error: Optional[str] = Field(default=None, description="The error message")
        status: LogStatus = Field(..., description="The status of the log")
        data: Mapping[str, Any] = Field(..., description="Detailed log data")

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
    message: JsonMessage | TextMessage | BlobMessage | VariableMessage | FileMessage | LogMessage | None
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


class ToolParameterOption(BaseModel):
    value: str = Field(..., description="The value of the option")
    label: I18nObject = Field(..., description="The label of the option")

    @field_validator("value", mode="before")
    @classmethod
    def transform_id_to_str(cls, value) -> str:
        if not isinstance(value, str):
            return str(value)
        else:
            return value


class ToolParameter(BaseModel):
    class ToolParameterType(enum.StrEnum):
        STRING = CommonParameterType.STRING.value
        NUMBER = CommonParameterType.NUMBER.value
        BOOLEAN = CommonParameterType.BOOLEAN.value
        SELECT = CommonParameterType.SELECT.value
        SECRET_INPUT = CommonParameterType.SECRET_INPUT.value
        FILE = CommonParameterType.FILE.value
        FILES = CommonParameterType.FILES.value
        APP_SELECTOR = CommonParameterType.APP_SELECTOR.value
        TOOL_SELECTOR = CommonParameterType.TOOL_SELECTOR.value
        MODEL_SELECTOR = CommonParameterType.MODEL_SELECTOR.value

        # deprecated, should not use.
        SYSTEM_FILES = CommonParameterType.SYSTEM_FILES.value

        def as_normal_type(self):
            if self in {
                ToolParameter.ToolParameterType.SECRET_INPUT,
                ToolParameter.ToolParameterType.SELECT,
            }:
                return "string"
            return self.value

        def cast_value(self, value: Any, /):
            try:
                match self:
                    case (
                        ToolParameter.ToolParameterType.STRING
                        | ToolParameter.ToolParameterType.SECRET_INPUT
                        | ToolParameter.ToolParameterType.SELECT
                    ):
                        if value is None:
                            return ""
                        else:
                            return value if isinstance(value, str) else str(value)

                    case ToolParameter.ToolParameterType.BOOLEAN:
                        if value is None:
                            return False
                        elif isinstance(value, str):
                            # Allowed YAML boolean value strings: https://yaml.org/type/bool.html
                            # and also '0' for False and '1' for True
                            match value.lower():
                                case "true" | "yes" | "y" | "1":
                                    return True
                                case "false" | "no" | "n" | "0":
                                    return False
                                case _:
                                    return bool(value)
                        else:
                            return value if isinstance(value, bool) else bool(value)

                    case ToolParameter.ToolParameterType.NUMBER:
                        if isinstance(value, int | float):
                            return value
                        elif isinstance(value, str) and value:
                            if "." in value:
                                return float(value)
                            else:
                                return int(value)
                    case ToolParameter.ToolParameterType.SYSTEM_FILES | ToolParameter.ToolParameterType.FILES:
                        if not isinstance(value, list):
                            return [value]
                        return value
                    case ToolParameter.ToolParameterType.FILE:
                        if isinstance(value, list):
                            if len(value) != 1:
                                raise ValueError(
                                    "This parameter only accepts one file but got multiple files while invoking."
                                )
                            else:
                                return value[0]
                        return value
                    case (
                        ToolParameter.ToolParameterType.TOOL_SELECTOR
                        | ToolParameter.ToolParameterType.MODEL_SELECTOR
                        | ToolParameter.ToolParameterType.APP_SELECTOR
                    ):
                        if not isinstance(value, dict):
                            raise ValueError("The selector must be a dictionary.")
                        return value
                    case _:
                        return str(value)

            except Exception:
                raise ValueError(f"The tool parameter value {value} is not in correct type of {self.as_normal_type()}.")

    class ToolParameterForm(Enum):
        SCHEMA = "schema"  # should be set while adding tool
        FORM = "form"  # should be set before invoking tool
        LLM = "llm"  # will be set by LLM

    name: str = Field(..., description="The name of the parameter")
    label: I18nObject = Field(..., description="The label presented to the user")
    human_description: Optional[I18nObject] = Field(default=None, description="The description presented to the user")
    placeholder: Optional[I18nObject] = Field(default=None, description="The placeholder presented to the user")
    type: ToolParameterType = Field(..., description="The type of the parameter")
    scope: AppSelectorScope | ModelSelectorScope | ToolSelectorScope | None = None
    form: ToolParameterForm = Field(..., description="The form of the parameter, schema/form/llm")
    llm_description: Optional[str] = None
    required: Optional[bool] = False
    default: Optional[Union[float, int, str]] = None
    min: Optional[Union[float, int]] = None
    max: Optional[Union[float, int]] = None
    options: list[ToolParameterOption] = Field(default_factory=list)

    @field_validator("options", mode="before")
    @classmethod
    def transform_options(cls, v):
        if not isinstance(v, list):
            return []
        return v

    @classmethod
    def get_simple_instance(
        cls,
        name: str,
        llm_description: str,
        type: ToolParameterType,
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
        if options:
            option_objs = [
                ToolParameterOption(value=option, label=I18nObject(en_US=option, zh_Hans=option)) for option in options
            ]
        else:
            option_objs = []
        return cls(
            name=name,
            label=I18nObject(en_US="", zh_Hans=""),
            placeholder=None,
            human_description=I18nObject(en_US="", zh_Hans=""),
            type=type,
            form=cls.ToolParameterForm.LLM,
            llm_description=llm_description,
            required=required,
            options=option_objs,
        )


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
    plugin_id: Optional[str] = Field(None, description="The id of the plugin")
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
