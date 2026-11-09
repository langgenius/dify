"""Closed V7 Tongyi0226 local capability, separate from immutable V1–V6.

These values prove only a reviewed dev15 staging candidate contract. They authorize
no installation, runtime route, credentials, registry publication or funding.
"""

from dataclasses import dataclass
from typing import Literal, Self

from pydantic import ConfigDict, Field, model_validator

from graphon.model_runtime.entities.model_entities import ModelType
from services.entities.model_billing_mapping import MappingSource, MappingTarget, _StrictModel

TONGYI_SOURCE_UID = "langgenius/tongyi:0.2.26@6c75a6b95954ef3c97f0d3225bad7cbfbff7cdbc82d9425074aae121cc056a64"
TONGYI_SOURCE_LLM_MODELS = frozenset(
    {
        "qwen-flash",
        "qwen-max",
        "qwen-plus",
        "qwen-plus-latest",
        "qwen3-vl-plus",
        "qwen3.5-flash",
        "qwen3.5-plus",
        "qwen3.6-flash",
        "qwen3.6-plus",
        "qwen3.7-max",
        "qwen3.7-plus",
    }
)
TONGYI_SOURCE_EMBEDDING_MODELS = frozenset({"text-embedding-v3", "text-embedding-v4"})
TONGYI_SOURCE_RERANK_MODELS = frozenset({"qwen3-rerank"})


def tongyi_source_model_type(model: str) -> ModelType:
    if model in TONGYI_SOURCE_LLM_MODELS:
        return ModelType.LLM
    if model in TONGYI_SOURCE_EMBEDDING_MODELS:
        return ModelType.TEXT_EMBEDDING
    if model in TONGYI_SOURCE_RERANK_MODELS:
        return ModelType.RERANK
    raise ValueError("Unreviewed Tongyi source model")


def tongyi_source_operations(model: str) -> frozenset[str]:
    kind = tongyi_source_model_type(model)
    if kind is ModelType.LLM:
        return frozenset({"model/schema", "llm/invoke", "llm/num_tokens"})
    if kind is ModelType.TEXT_EMBEDDING:
        return frozenset({"model/schema", "text_embedding/invoke", "text_embedding/num_tokens"})
    return frozenset({"model/schema", "rerank/invoke"})


class TongyiSourceSettings(_StrictModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    source_endpoint_policy: Literal["reviewed_shared_international_string_true"]
    api_host_policy: Literal["actual_absent_or_blank"]
    request_metadata_policy: Literal["actual_system_disabled", "not_used"]

    def matches_model_type(self, model_type: ModelType) -> bool:
        if model_type is ModelType.LLM:
            return self.request_metadata_policy == "actual_system_disabled"
        return model_type in {ModelType.TEXT_EMBEDDING, ModelType.RERANK} and self.request_metadata_policy == "not_used"


class TongyiMappingSource(MappingSource):
    provider_id: Literal["langgenius/tongyi/tongyi"]
    model_type: Literal[ModelType.LLM, ModelType.TEXT_EMBEDDING, ModelType.RERANK]
    mode: Literal["chat", "text-embedding", "rerank"]

    @model_validator(mode="after")
    def exact_identity(self) -> Self:
        kind = tongyi_source_model_type(self.model)
        expected_mode = {ModelType.LLM: "chat", ModelType.TEXT_EMBEDDING: "text-embedding", ModelType.RERANK: "rerank"}[
            kind
        ]
        if self.model_type is not kind or self.mode != expected_mode:
            raise ValueError("Tongyi source type or mode changed")
        return self


class TongyiMappingTarget(MappingTarget):
    model_type: Literal[ModelType.LLM, ModelType.TEXT_EMBEDDING, ModelType.RERANK]

    @model_validator(mode="after")
    def exact_identity(self) -> Self:
        if self.model_type is not tongyi_source_model_type(self.model):
            raise ValueError("Tongyi target type changed")
        return self


class TongyiSourceAdapter(_StrictModel):
    id: Literal["tongyi_credit_source_v1"]
    revision: Literal["1"]
    rules_digest: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")


class TongyiSourceVariant(_StrictModel):
    variant_id: str = Field(min_length=1)
    source_plugin_uid: Literal[
        "langgenius/tongyi:0.2.26@6c75a6b95954ef3c97f0d3225bad7cbfbff7cdbc82d9425074aae121cc056a64"
    ]
    source_settings: TongyiSourceSettings
    source_schema_digest: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    source_runtime_schema_digest: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    source_profile_id: str = Field(min_length=1)
    parameter_adapter: TongyiSourceAdapter
    target: TongyiMappingTarget
    operations: list[str] = Field(min_length=2, max_length=3)
    conformance_fixture_ids: list[str] = Field(min_length=1)

    @model_validator(mode="after")
    def closed_capability(self) -> Self:
        if (
            not self.source_settings.matches_model_type(self.target.model_type)
            or set(self.operations) != tongyi_source_operations(self.target.model)
            or len(set(self.operations)) != len(self.operations)
            or len(set(self.conformance_fixture_ids)) != len(self.conformance_fixture_ids)
            or self.source_profile_id != "tongyi0226-native-v1:" + self.target.model
        ):
            raise ValueError("Invalid bounded Tongyi source capability")
        return self


class SourceTongyiVariantMapping(_StrictModel):
    schema_version: Literal[7]
    mapping_revision: str = Field(min_length=1)
    source: TongyiMappingSource
    settlement_owner: Literal["shared_credit_pool"]
    pool_types: list[Literal["paid", "trial"]] = Field(min_length=1)
    variants: list[TongyiSourceVariant] = Field(min_length=1, max_length=1)

    @model_validator(mode="before")
    @classmethod
    def exact_version(cls, value: object) -> object:
        if type(value) is not dict or type(value.get("schema_version")) is not int or value["schema_version"] != 7:
            raise ValueError("Tongyi schema version must be integer 7")
        return value

    @model_validator(mode="after")
    def finite_exact_source(self) -> Self:
        if len(set(self.pool_types)) != len(self.pool_types):
            raise ValueError("Duplicate Tongyi pools")
        for row in self.variants:
            if row.target.model != self.source.model or row.target.model_type is not self.source.model_type:
                raise ValueError("Tongyi source/target identity changed")
        return self


class SourceTongyiVariantSelection(_StrictModel):
    schema_version: Literal[7]
    variant_id: str = Field(min_length=1)
    source_plugin_uid: Literal[
        "langgenius/tongyi:0.2.26@6c75a6b95954ef3c97f0d3225bad7cbfbff7cdbc82d9425074aae121cc056a64"
    ]
    source_settings: TongyiSourceSettings
    source_schema_digest: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    source_runtime_schema_digest: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    registry_digest: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")

    @model_validator(mode="before")
    @classmethod
    def exact_version(cls, value: object) -> object:
        if type(value) is not dict or type(value.get("schema_version")) is not int or value["schema_version"] != 7:
            raise ValueError("Tongyi schema version must be integer 7")
        return value


@dataclass(frozen=True, slots=True)
class SelectedTongyiSourceVariant:
    envelope: SourceTongyiVariantMapping
    variant: TongyiSourceVariant
    registry_digest: str

    @property
    def mapping_revision(self) -> str:
        return self.envelope.mapping_revision

    @property
    def source(self) -> TongyiMappingSource:
        return self.envelope.source

    @property
    def settlement_owner(self) -> Literal["shared_credit_pool"]:
        return self.envelope.settlement_owner

    @property
    def pool_types(self) -> list[Literal["paid", "trial"]]:
        return self.envelope.pool_types

    @property
    def source_schema_digest(self) -> str:
        return self.variant.source_schema_digest

    @property
    def parameter_adapter(self) -> TongyiSourceAdapter:
        return self.variant.parameter_adapter

    @property
    def target(self) -> TongyiMappingTarget:
        return self.variant.target

    @property
    def operations(self) -> list[str]:
        return self.variant.operations

    @property
    def conformance_fixture_ids(self) -> list[str]:
        return self.variant.conformance_fixture_ids
