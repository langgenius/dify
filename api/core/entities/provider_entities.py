from enum import StrEnum, auto
from typing import Union

from pydantic import BaseModel, ConfigDict, Field

from core.entities.parameter_entities import (
    AppSelectorScope,
    CommonParameterType,
    ModelSelectorScope,
    ToolSelectorScope,
)
from core.model_runtime.entities.model_entities import ModelType
from core.tools.entities.common_entities import I18nObject


class ProviderQuotaType(StrEnum):
    PAID = auto()
    """hosted paid quota"""

    FREE = auto()
    """third-party free quota"""

    TRIAL = auto()
    """hosted trial quota"""

    @staticmethod
    def value_of(value):
        for member in ProviderQuotaType:
            if member.value == value:
                return member
        raise ValueError(f"No matching enum found for value '{value}'")


class QuotaUnit(StrEnum):
    TIMES = auto()
    TOKENS = auto()
    CREDITS = auto()


class SystemConfigurationStatus(StrEnum):
    """
    Enum class for system configuration status.
    """

    ACTIVE = auto()
    QUOTA_EXCEEDED = "quota-exceeded"
    UNSUPPORTED = auto()


class RestrictModel(BaseModel):
    model: str
    base_model_name: str | None = None
    model_type: ModelType

    # pydantic configs
    model_config = ConfigDict(protected_namespaces=())


class QuotaConfiguration(BaseModel):
    """
    Model class for provider quota configuration.
    """

    quota_type: ProviderQuotaType
    quota_unit: QuotaUnit
    quota_limit: int
    quota_used: int
    is_valid: bool
    restrict_models: list[RestrictModel] = []


class CredentialConfiguration(BaseModel):
    """
    Model class for credential configuration.
    """

    credential_id: str
    credential_name: str


class SystemConfiguration(BaseModel):
    """
    Model class for provider system configuration.
    """

    enabled: bool
    current_quota_type: ProviderQuotaType | None = None
    quota_configurations: list[QuotaConfiguration] = []
    credentials: dict | None = None


class CustomProviderConfiguration(BaseModel):
    """
    Model class for provider custom configuration.
    """

    credentials: dict
    current_credential_id: str | None = None
    current_credential_name: str | None = None
    available_credentials: list[CredentialConfiguration] = []


class CustomModelConfiguration(BaseModel):
    """
    Model class for provider custom model configuration.
    """

    model: str
    model_type: ModelType
    credentials: dict | None = None
    current_credential_id: str | None = None
    current_credential_name: str | None = None
    available_model_credentials: list[CredentialConfiguration] = []
    unadded_to_model_list: bool | None = False

    # pydantic configs
    model_config = ConfigDict(protected_namespaces=())


class UnaddedModelConfiguration(BaseModel):
    """
    Model class for provider unadded model configuration.
    """

    model: str
    model_type: ModelType


class CustomConfiguration(BaseModel):
    """
    Model class for provider custom configuration.
    """

    provider: CustomProviderConfiguration | None = None
    models: list[CustomModelConfiguration] = []
    can_added_models: list[UnaddedModelConfiguration] = []


class ModelLoadBalancingConfiguration(BaseModel):
    """
    Class for model load balancing configuration.
    """

    id: str
    name: str
    credentials: dict
    credential_source_type: str | None = None
    credential_id: str | None = None


class ModelSettings(BaseModel):
    """
    Model class for model settings.
    """

    model: str
    model_type: ModelType
    enabled: bool = True
    load_balancing_enabled: bool = False
    load_balancing_configs: list[ModelLoadBalancingConfiguration] = []

    # pydantic configs
    model_config = ConfigDict(protected_namespaces=())


class BasicProviderConfig(BaseModel):
    """
    Base model class for common provider settings like credentials
    """

    class Type(StrEnum):
        SECRET_INPUT = CommonParameterType.SECRET_INPUT
        TEXT_INPUT = CommonParameterType.TEXT_INPUT
        SELECT = CommonParameterType.SELECT
        BOOLEAN = CommonParameterType.BOOLEAN
        APP_SELECTOR = CommonParameterType.APP_SELECTOR
        MODEL_SELECTOR = CommonParameterType.MODEL_SELECTOR
        TOOLS_SELECTOR = CommonParameterType.TOOLS_SELECTOR

        @classmethod
        def value_of(cls, value: str) -> "ProviderConfig.Type":
            """
            Get value of given mode.

            :param value: mode value
            :return: mode
            """
            for mode in cls:
                if mode.value == value:
                    return mode
            raise ValueError(f"invalid mode value {value}")

    type: Type = Field(..., description="The type of the credentials")
    name: str = Field(..., description="The name of the credentials")


class ProviderConfig(BasicProviderConfig):
    """
    Model class for common provider settings like credentials
    """

    class Option(BaseModel):
        value: str = Field(..., description="The value of the option")
        label: I18nObject = Field(..., description="The label of the option")

    scope: AppSelectorScope | ModelSelectorScope | ToolSelectorScope | None = None
    required: bool = False
    default: Union[int, str, float, bool] | None = None
    options: list[Option] | None = None
    label: I18nObject | None = None
    help: I18nObject | None = None
    url: str | None = None
    placeholder: I18nObject | None = None

    def to_basic_provider_config(self) -> BasicProviderConfig:
        return BasicProviderConfig(type=self.type, name=self.name)
