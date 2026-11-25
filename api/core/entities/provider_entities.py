from __future__ import annotations

from enum import StrEnum, auto
from typing import Any, override

from pydantic import BaseModel, ConfigDict, Field

from core.entities.parameter_entities import (
    AppSelectorScope,
    CommonParameterType,
    ModelSelectorScope,
    ToolSelectorScope,
)
from core.tools.entities.common_entities import I18nObject
from graphon.model_runtime.entities.model_entities import ModelType


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
    credentials: dict[str, Any] | None = Field(default=None)
    # The hosted model catalog still belongs to the source provider. Only
    # execution and settlement belong to Tokener for this SYSTEM selection.
    tokener_funded: bool = False


# ModelRuntime accepts dict credentials end-to-end; no routing data becomes a dict entry.
class TokenerHostedModelCredentials(dict[str, Any]):  # noqa: FURB189
    """Internal typed marker for a hosted selection; never an app credential value.

    Only provider configuration can select this route. The transport checks all
    three identifiers against the operation and re-reads the current tenant
    binding before sending a key. A plain credential dict cannot opt in.
    """

    def __init__(self, *, tenant_id: str, provider: str, model_type: str, model: str) -> None:
        """Carry the admitted route as attributes while leaving the mapping empty."""
        super().__init__()
        self.tenant_id = tenant_id
        self.provider = provider
        self.model_type = model_type
        self.model = model

    def __bool__(self) -> bool:
        """A valid route represents configured credentials, without a source key."""
        return True

    @override
    def copy(self) -> TokenerHostedModelCredentials:
        """Maintain the trusted binding when an in-process consumer copies credentials."""
        return TokenerHostedModelCredentials(
            tenant_id=self.tenant_id, provider=self.provider, model_type=self.model_type, model=self.model
        )


class CustomProviderConfiguration(BaseModel):
    """
    Model class for provider custom configuration.
    """

    credentials: dict[str, Any]
    current_credential_id: str | None = None
    current_credential_name: str | None = None
    available_credentials: list[CredentialConfiguration] = []


class CustomModelConfiguration(BaseModel):
    """
    Model class for provider custom model configuration.
    """

    model: str
    model_type: ModelType
    credentials: dict[str, Any] | None
    current_credential_id: str | None = None
    current_credential_name: str | None = None
    available_model_credentials: list[CredentialConfiguration] = []
    unadded_to_model_list: bool = False

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
    credentials: dict[str, Any]
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


class ProviderConfigType(StrEnum):
    SECRET_INPUT = CommonParameterType.SECRET_INPUT
    TEXT_INPUT = CommonParameterType.TEXT_INPUT
    SELECT = CommonParameterType.SELECT
    BOOLEAN = CommonParameterType.BOOLEAN
    APP_SELECTOR = CommonParameterType.APP_SELECTOR
    MODEL_SELECTOR = CommonParameterType.MODEL_SELECTOR
    TOOLS_SELECTOR = CommonParameterType.TOOLS_SELECTOR

    @classmethod
    def value_of(cls, value: str) -> ProviderConfigType:
        """
        Get value of given mode.

        :param value: mode value
        :return: mode
        """
        for mode in cls:
            if mode.value == value:
                return mode
        raise ValueError(f"invalid mode value {value}")


class BasicProviderConfig(BaseModel):
    """
    Base model class for common provider settings like credentials
    """

    type: ProviderConfigType = Field(..., description="The type of the credentials")
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
    default: int | str | float | bool | None = None
    options: list[Option] | None = None
    multiple: bool = False
    label: I18nObject | None = None
    help: I18nObject | None = None
    url: str | None = None
    placeholder: I18nObject | None = None

    def to_basic_provider_config(self) -> BasicProviderConfig:
        return BasicProviderConfig(type=self.type, name=self.name)
