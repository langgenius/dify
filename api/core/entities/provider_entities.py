from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum, auto
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, PrivateAttr

from core.entities.parameter_entities import (
    AppSelectorScope,
    CommonParameterType,
    ModelSelectorScope,
    ToolSelectorScope,
)
from core.tools.entities.common_entities import I18nObject
from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelType


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


@dataclass(frozen=True, slots=True)
class HostedSourceProtocolFact:
    """Non-secret SYSTEM settings captured before managed credentials replace them.

    ``absent`` is positive evidence from an existing source credential dict,
    not a fallback for missing settings. Catalog digests and the immutable
    installation bind this request-local fact to the original provider.
    """

    provider: str
    plugin_unique_identifier: str
    catalog_schema_digests: tuple[tuple[ModelType, str, str], ...]
    selector: Literal["absent", "chat", "responses"]


@dataclass(frozen=True, slots=True)
class HostedSourceVariantFact:
    """New V2-only public settings; absence of this record proves nothing."""

    provider: str
    plugin_unique_identifier: str
    catalog_schema_digests: tuple[tuple[ModelType, str, str], ...]
    selector: Literal["absent", "chat", "responses"]
    source_base_is_set: bool
    request_metadata_enabled: bool
    # Request-local positive classification, never a persisted V2 setting or
    # a raw URL. A truthy base flag alone cannot authorize an official route.
    source_endpoint_class: Literal["unset", "official_root", "unreviewed"]


@dataclass(frozen=True, slots=True)
class HostedEmbeddingSourceFact:
    """Request-local embedding facts; LLM protocol selection is not applicable.

    Metadata behavior is proved by the exact source implementation, not inferred
    from a credential default. It does not claim a False value for the original
    dictionary. No raw source URL, key or dictionary is retained in this record.
    """

    provider: str
    plugin_unique_identifier: str
    catalog_schema_digests: tuple[tuple[ModelType, str, str], ...]
    source_endpoint_class: Literal["unset", "official_root", "unreviewed"]
    request_metadata_behavior: Literal["not_used"]


@dataclass(frozen=True, slots=True)
class HostedAudioSourceFact:
    """Positive SYSTEM audio behavior; never raw False protocol/metadata guesses."""

    provider: str
    plugin_unique_identifier: str
    catalog_schema_digests: tuple[tuple[ModelType, str, str], ...]
    source_endpoint_class: Literal["unset", "official_root", "unreviewed"]
    api_protocol_behavior: Literal["not_used"]
    request_metadata_behavior: Literal["not_used"]


@dataclass(frozen=True, slots=True)
class HostedXAISourceFact:
    """Exact x0.0.27 public facts captured before replacing SYSTEM credentials."""

    provider: str
    plugin_unique_identifier: str
    catalog_schema_digests: tuple[tuple[ModelType, str, str], ...]
    source_endpoint_class: Literal["unset", "official_root", "unreviewed"]
    source_base_is_set: bool
    request_metadata_enabled: bool
    protocol_selector: Literal["not_used"]


@dataclass(frozen=True, slots=True)
class HostedGeminiSourceFact:
    """Private, positive SYSTEM classifications; no credential or raw URL.

    LLM settings retain an explicit unreviewed state. Exact source embeddings
    do not use those fields; services determine that separate reviewed policy.
    """

    provider: str
    plugin_unique_identifier: str
    catalog_schema_digests: tuple[tuple[ModelType, str, str], ...]
    llm_source_base_policy: Literal["unset_or_exact_google_root", "unreviewed"]
    llm_request_metadata_policy: Literal["system_false_only", "unreviewed"]
    llm_file_url_policy: Literal["actual_system_absent_or_empty_only", "unreviewed"]


@dataclass(frozen=True, slots=True)
class HostedTongyiSourceFact:
    """Positive before-clear SYSTEM classifications, never source key/URL/dict."""

    provider: str
    plugin_unique_identifier: str
    catalog_schema_digests: tuple[tuple[ModelType, str, str], ...]
    endpoint_selector: Literal["string_true", "string_false", "unreviewed"]
    api_host_policy: Literal["actual_absent_or_blank", "unreviewed"]
    llm_metadata_policy: Literal["actual_system_disabled", "unreviewed"]


class SystemConfiguration(BaseModel):
    """
    Model class for provider system configuration.
    """

    enabled: bool
    current_quota_type: ProviderQuotaType | None = None
    quota_configurations: list[QuotaConfiguration] = []
    credentials: dict[str, Any] | None = Field(default=None)
    # Request-scoped, server-verified schema evidence, never serialized as
    # provider configuration or persisted into the source catalog.
    _tokener_source_schemas: tuple[AIModelEntity, ...] = PrivateAttr(default=())
    _tokener_source_plugin_unique_identifier: str | None = PrivateAttr(default=None)
    _tokener_source_protocol_fact: HostedSourceProtocolFact | None = PrivateAttr(default=None)
    _tokener_source_variant_fact: HostedSourceVariantFact | None = PrivateAttr(default=None)
    _tokener_embedding_source_fact: HostedEmbeddingSourceFact | None = PrivateAttr(default=None)
    _tokener_audio_source_fact: HostedAudioSourceFact | None = PrivateAttr(default=None)
    _tokener_xai_source_fact: HostedXAISourceFact | None = PrivateAttr(default=None)
    _tokener_gemini_source_fact: HostedGeminiSourceFact | None = PrivateAttr(default=None)
    _tokener_tongyi_source_fact: HostedTongyiSourceFact | None = PrivateAttr(default=None)


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
