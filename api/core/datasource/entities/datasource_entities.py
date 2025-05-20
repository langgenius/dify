import enum
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field, ValidationInfo, field_validator

from core.plugin.entities.parameters import (
    PluginParameter,
    PluginParameterOption,
    PluginParameterType,
    as_normal_type,
    cast_parameter_value,
    init_frontend_parameter,
)
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolProviderEntity


class DatasourceProviderType(enum.StrEnum):
    """
    Enum class for datasource provider
    """

    ONLINE_DOCUMENT = "online_document"
    LOCAL_FILE = "local_file"
    WEBSITE = "website"

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
    author: str = Field(..., description="The author of the tool")
    name: str = Field(..., description="The name of the tool")
    label: I18nObject = Field(..., description="The label of the tool")
    provider: str = Field(..., description="The provider of the tool")
    icon: Optional[str] = None


class DatasourceDescription(BaseModel):
    human: I18nObject = Field(..., description="The description presented to the user")
    llm: str = Field(..., description="The description presented to the LLM")


class DatasourceEntity(BaseModel):
    identity: DatasourceIdentity
    parameters: list[DatasourceParameter] = Field(default_factory=list)
    description: Optional[DatasourceDescription] = None
    output_schema: Optional[dict] = None
    has_runtime_parameters: bool = Field(default=False, description="Whether the tool has runtime parameters")

    @field_validator("parameters", mode="before")
    @classmethod
    def set_parameters(cls, v, validation_info: ValidationInfo) -> list[DatasourceParameter]:
        return v or []


class DatasourceProviderEntity(ToolProviderEntity):
    """
    Datasource provider entity
    """

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
