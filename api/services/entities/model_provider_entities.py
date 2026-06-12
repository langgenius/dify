from collections.abc import Sequence
from decimal import Decimal
from enum import StrEnum
from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, Field, model_validator

from configs import dify_config
from core.entities.model_entities import (
    ModelWithProviderEntity,
    ProviderModelWithStatusEntity,
)
from core.entities.provider_entities import (
    CredentialConfiguration,
    CustomModelConfiguration,
    ProviderQuotaType,
    QuotaConfiguration,
    UnaddedModelConfiguration,
)
from graphon.model_runtime.entities.common_entities import I18nObject
from graphon.model_runtime.entities.model_entities import ModelPropertyKey, ModelType
from graphon.model_runtime.entities.provider_entities import (
    AIModelEntity,
    ConfigurateMethod,
    ModelCredentialSchema,
    ProviderCredentialSchema,
    ProviderHelpEntity,
    SimpleProviderEntity,
)
from models.provider import ProviderType

_OPAQUE_JSON_SCHEMA = {"x-dify-opaque": True}
_DECIMAL_STRING_PATTERN = r"^(?![-+.]*$)[+-]?0*\d*\.?\d*$"
CodegenSafeDecimal = Annotated[Decimal, Field(json_schema_extra={"pattern": _DECIMAL_STRING_PATTERN})]


class CustomConfigurationStatus(StrEnum):
    """
    Enum class for custom configuration status.
    """

    ACTIVE = "active"
    NO_CONFIGURE = "no-configure"


class CustomConfigurationResponse(BaseModel):
    """
    Model class for provider custom configuration response.
    """

    status: CustomConfigurationStatus
    current_credential_id: str | None = None
    current_credential_name: str | None = None
    available_credentials: list[CredentialConfiguration] | None = None
    custom_models: list[CustomModelConfiguration] | None = None
    can_added_models: list[UnaddedModelConfiguration] | None = None


class SystemConfigurationResponse(BaseModel):
    """
    Model class for provider system configuration response.
    """

    enabled: bool
    current_quota_type: ProviderQuotaType | None = None
    quota_configurations: list[QuotaConfiguration] = []


class ProviderResponse(BaseModel):
    """
    Model class for provider response.
    """

    tenant_id: str
    provider: str
    label: I18nObject
    description: I18nObject | None = None
    icon_small: I18nObject | None = None
    icon_small_dark: I18nObject | None = None
    background: str | None = None
    help: ProviderHelpEntity | None = None
    supported_model_types: Sequence[ModelType]
    configurate_methods: list[ConfigurateMethod]
    provider_credential_schema: ProviderCredentialSchema | None = None
    model_credential_schema: ModelCredentialSchema | None = None
    preferred_provider_type: ProviderType
    custom_configuration: CustomConfigurationResponse
    system_configuration: SystemConfigurationResponse

    # pydantic configs
    model_config = ConfigDict(protected_namespaces=())

    @model_validator(mode="after")
    def _(self):
        url_prefix = (
            dify_config.CONSOLE_API_URL + f"/console/api/workspaces/{self.tenant_id}/model-providers/{self.provider}"
        )
        if self.icon_small is not None:
            self.icon_small = I18nObject(
                en_US=f"{url_prefix}/icon_small/en_US", zh_Hans=f"{url_prefix}/icon_small/zh_Hans"
            )
        if self.icon_small_dark is not None:
            self.icon_small_dark = I18nObject(
                en_US=f"{url_prefix}/icon_small_dark/en_US",
                zh_Hans=f"{url_prefix}/icon_small_dark/zh_Hans",
            )
        return self


class ProviderWithModelsResponse(BaseModel):
    """
    Model class for provider with models response.
    """

    tenant_id: str
    provider: str
    label: I18nObject
    icon_small: I18nObject | None = None
    icon_small_dark: I18nObject | None = None
    status: CustomConfigurationStatus
    models: list[ProviderModelWithStatusEntity]

    @model_validator(mode="after")
    def _(self):
        url_prefix = (
            dify_config.CONSOLE_API_URL + f"/console/api/workspaces/{self.tenant_id}/model-providers/{self.provider}"
        )
        if self.icon_small is not None:
            self.icon_small = I18nObject(
                en_US=f"{url_prefix}/icon_small/en_US", zh_Hans=f"{url_prefix}/icon_small/zh_Hans"
            )

        if self.icon_small_dark is not None:
            self.icon_small_dark = I18nObject(
                en_US=f"{url_prefix}/icon_small_dark/en_US", zh_Hans=f"{url_prefix}/icon_small_dark/zh_Hans"
            )
        return self


class PriceConfigResponse(BaseModel):
    """Serialized pricing info with codegen-safe decimal string patterns."""

    input: CodegenSafeDecimal
    output: CodegenSafeDecimal | None = None
    unit: CodegenSafeDecimal
    currency: str


class AIModelEntityResponse(AIModelEntity):
    model_properties: dict[ModelPropertyKey, Any] = Field(json_schema_extra=_OPAQUE_JSON_SCHEMA)
    pricing: PriceConfigResponse | None = None


class SimpleProviderEntityResponse(SimpleProviderEntity):
    """
    Simple provider entity response.
    """

    tenant_id: str
    models: list[AIModelEntityResponse] = []

    @model_validator(mode="after")
    def _(self):
        url_prefix = (
            dify_config.CONSOLE_API_URL + f"/console/api/workspaces/{self.tenant_id}/model-providers/{self.provider}"
        )
        if self.icon_small is not None:
            self.icon_small = I18nObject(
                en_US=f"{url_prefix}/icon_small/en_US", zh_Hans=f"{url_prefix}/icon_small/zh_Hans"
            )

        if self.icon_small_dark is not None:
            self.icon_small_dark = I18nObject(
                en_US=f"{url_prefix}/icon_small_dark/en_US", zh_Hans=f"{url_prefix}/icon_small_dark/zh_Hans"
            )
        return self


class DefaultModelResponse(BaseModel):
    """
    Default model entity.
    """

    model: str
    model_type: ModelType
    provider: SimpleProviderEntityResponse

    # pydantic configs
    model_config = ConfigDict(protected_namespaces=())


class ModelWithProviderEntityResponse(ProviderModelWithStatusEntity):
    """
    Model with provider entity.
    """

    provider: SimpleProviderEntityResponse

    def __init__(self, tenant_id: str, model: ModelWithProviderEntity):
        dump_model = model.model_dump()
        dump_model["provider"]["tenant_id"] = tenant_id
        super().__init__(**dump_model)
