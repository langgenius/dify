from enum import Enum
from typing import Any, Optional, Union, cast

from pydantic import BaseModel, Field, field_validator

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


class ToolProviderType(Enum):
    """
    Enum class for tool provider
    """

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
    class MessageType(Enum):
        TEXT = "text"
        IMAGE = "image"
        LINK = "link"
        BLOB = "blob"
        JSON = "json"
        IMAGE_LINK = "image_link"
        FILE = "file"

    type: MessageType = MessageType.TEXT
    """
        plain text, image url or link url
    """
    message: str | bytes | dict | None = None
    # TODO: Use a BaseModel for meta
    meta: dict[str, Any] = Field(default_factory=dict)
    save_as: str = ""


class ToolInvokeMessageBinary(BaseModel):
    mimetype: str = Field(..., description="The mimetype of the binary")
    url: str = Field(..., description="The url of the binary")
    save_as: str = ""
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
    class ToolParameterType(str, Enum):
        STRING = "string"
        NUMBER = "number"
        BOOLEAN = "boolean"
        SELECT = "select"
        SECRET_INPUT = "secret-input"
        FILE = "file"
        FILES = "files"

        # deprecated, should not use.
        SYSTEM_FILES = "systme-files"

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
                    case (
                        ToolParameter.ToolParameterType.SYSTEM_FILES
                        | ToolParameter.ToolParameterType.FILE
                        | ToolParameter.ToolParameterType.FILES
                    ):
                        return value
                    case _:
                        return str(value)

            except Exception:
                raise ValueError(f"The tool parameter value {value} is not in correct type of {parameter_type}.")

    class ToolParameterForm(Enum):
        SCHEMA = "schema"  # should be set while adding tool
        FORM = "form"  # should be set before invoking tool
        LLM = "llm"  # will be set by LLM

    name: str = Field(..., description="The name of the parameter")
    label: I18nObject = Field(..., description="The label presented to the user")
    human_description: Optional[I18nObject] = Field(None, description="The description presented to the user")
    placeholder: Optional[I18nObject] = Field(None, description="The placeholder presented to the user")
    type: ToolParameterType = Field(..., description="The type of the parameter")
    form: ToolParameterForm = Field(..., description="The form of the parameter, schema/form/llm")
    llm_description: Optional[str] = None
    required: Optional[bool] = False
    default: Optional[Union[float, int, str]] = None
    min: Optional[Union[float, int]] = None
    max: Optional[Union[float, int]] = None
    options: Optional[list[ToolParameterOption]] = None

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
            options = [
                ToolParameterOption(value=option, label=I18nObject(en_US=option, zh_Hans=option)) for option in options
            ]
        return cls(
            name=name,
            label=I18nObject(en_US="", zh_Hans=""),
            human_description=I18nObject(en_US="", zh_Hans=""),
            type=type,
            form=cls.ToolParameterForm.LLM,
            llm_description=llm_description,
            required=required,
            options=options,
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


class ToolDescription(BaseModel):
    human: I18nObject = Field(..., description="The description presented to the user")
    llm: str = Field(..., description="The description presented to the LLM")


class ToolIdentity(BaseModel):
    author: str = Field(..., description="The author of the tool")
    name: str = Field(..., description="The name of the tool")
    label: I18nObject = Field(..., description="The label of the tool")
    provider: str = Field(..., description="The provider of the tool")
    icon: Optional[str] = None


class ToolCredentialsOption(BaseModel):
    value: str = Field(..., description="The value of the option")
    label: I18nObject = Field(..., description="The label of the option")


class ToolProviderCredentials(BaseModel):
    class CredentialsType(Enum):
        SECRET_INPUT = "secret-input"
        TEXT_INPUT = "text-input"
        SELECT = "select"
        BOOLEAN = "boolean"

        @classmethod
        def value_of(cls, value: str) -> "ToolProviderCredentials.CredentialsType":
            """
            Get value of given mode.

            :param value: mode value
            :return: mode
            """
            for mode in cls:
                if mode.value == value:
                    return mode
            raise ValueError(f"invalid mode value {value}")

        @staticmethod
        def default(value: str) -> str:
            return ""

    name: str = Field(..., description="The name of the credentials")
    type: CredentialsType = Field(..., description="The type of the credentials")
    required: bool = False
    default: Optional[Union[int, str]] = None
    options: Optional[list[ToolCredentialsOption]] = None
    label: Optional[I18nObject] = None
    help: Optional[I18nObject] = None
    url: Optional[str] = None
    placeholder: Optional[I18nObject] = None

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "type": self.type.value,
            "required": self.required,
            "default": self.default,
            "options": self.options,
            "help": self.help.to_dict() if self.help else None,
            "label": self.label.to_dict(),
            "url": self.url,
            "placeholder": self.placeholder.to_dict() if self.placeholder else None,
        }


class ToolRuntimeVariableType(Enum):
    TEXT = "text"
    IMAGE = "image"


class ToolRuntimeVariable(BaseModel):
    type: ToolRuntimeVariableType = Field(..., description="The type of the variable")
    name: str = Field(..., description="The name of the variable")
    position: int = Field(..., description="The position of the variable")
    tool_name: str = Field(..., description="The name of the tool")


class ToolRuntimeTextVariable(ToolRuntimeVariable):
    value: str = Field(..., description="The value of the variable")


class ToolRuntimeImageVariable(ToolRuntimeVariable):
    value: str = Field(..., description="The path of the image")


class ToolRuntimeVariablePool(BaseModel):
    conversation_id: str = Field(..., description="The conversation id")
    user_id: str = Field(..., description="The user id")
    tenant_id: str = Field(..., description="The tenant id of assistant")

    pool: list[ToolRuntimeVariable] = Field(..., description="The pool of variables")

    def __init__(self, **data: Any):
        pool = data.get("pool", [])
        # convert pool into correct type
        for index, variable in enumerate(pool):
            if variable["type"] == ToolRuntimeVariableType.TEXT.value:
                pool[index] = ToolRuntimeTextVariable(**variable)
            elif variable["type"] == ToolRuntimeVariableType.IMAGE.value:
                pool[index] = ToolRuntimeImageVariable(**variable)
        super().__init__(**data)

    def dict(self) -> dict:
        return {
            "conversation_id": self.conversation_id,
            "user_id": self.user_id,
            "tenant_id": self.tenant_id,
            "pool": [variable.model_dump() for variable in self.pool],
        }

    def set_text(self, tool_name: str, name: str, value: str) -> None:
        """
        set a text variable
        """
        for variable in self.pool:
            if variable.name == name:
                if variable.type == ToolRuntimeVariableType.TEXT:
                    variable = cast(ToolRuntimeTextVariable, variable)
                    variable.value = value
                    return

        variable = ToolRuntimeTextVariable(
            type=ToolRuntimeVariableType.TEXT,
            name=name,
            position=len(self.pool),
            tool_name=tool_name,
            value=value,
        )

        self.pool.append(variable)

    def set_file(self, tool_name: str, value: str, name: Optional[str] = None) -> None:
        """
        set an image variable

        :param tool_name: the name of the tool
        :param value: the id of the file
        """
        # check how many image variables are there
        image_variable_count = 0
        for variable in self.pool:
            if variable.type == ToolRuntimeVariableType.IMAGE:
                image_variable_count += 1

        if name is None:
            name = f"file_{image_variable_count}"

        for variable in self.pool:
            if variable.name == name:
                if variable.type == ToolRuntimeVariableType.IMAGE:
                    variable = cast(ToolRuntimeImageVariable, variable)
                    variable.value = value
                    return

        variable = ToolRuntimeImageVariable(
            type=ToolRuntimeVariableType.IMAGE,
            name=name,
            position=len(self.pool),
            tool_name=tool_name,
            value=value,
        )

        self.pool.append(variable)


class ModelToolPropertyKey(Enum):
    IMAGE_PARAMETER_NAME = "image_parameter_name"


class ModelToolConfiguration(BaseModel):
    """
    Model tool configuration
    """

    type: str = Field(..., description="The type of the model tool")
    model: str = Field(..., description="The model")
    label: I18nObject = Field(..., description="The label of the model tool")
    properties: dict[ModelToolPropertyKey, Any] = Field(..., description="The properties of the model tool")


class ModelToolProviderConfiguration(BaseModel):
    """
    Model tool provider configuration
    """

    provider: str = Field(..., description="The provider of the model tool")
    models: list[ModelToolConfiguration] = Field(..., description="The models of the model tool")
    label: I18nObject = Field(..., description="The label of the model tool")


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
