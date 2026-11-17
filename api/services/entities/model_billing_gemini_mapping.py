"""Closed V6 Gemini0912 declarations, independent of immutable V1–V5 shapes.

These records attest reviewed capability, never current installation, native
backend readiness or authorization. No source credential or URL is serialized.
"""

from dataclasses import dataclass
from typing import Literal, Self

from pydantic import ConfigDict, Field, model_validator

from graphon.model_runtime.entities.model_entities import ModelType
from services.entities.model_billing_mapping import MappingSource, MappingTarget, _StrictModel

GEMINI_SOURCE_UID = "langgenius/gemini:0.9.12@9bb9eff3f9c99a8f1f87bdd5e0f178d5493918939dd0e02825ae8383bd0fd7ed"
GEMINI_SOURCE_LLM_MODELS = frozenset(
    {
        "gemini-2.5-flash",
        "gemini-3.1-flash-lite",
        "gemini-3.1-pro-preview",
        "gemini-3.5-flash",
        "gemini-3.5-flash-lite",
        "gemini-3.7-flash",
        "gemini-3-flash-preview",
    }
)
GEMINI_SOURCE_EMBEDDING_MODELS = frozenset({"gemini-embedding-001", "gemini-embedding-2-preview"})


def gemini_source_model_type(model: str) -> ModelType:
    if model in GEMINI_SOURCE_LLM_MODELS:
        return ModelType.LLM
    if model in GEMINI_SOURCE_EMBEDDING_MODELS:
        return ModelType.TEXT_EMBEDDING
    raise ValueError("Unreviewed Gemini source model")


def gemini_source_operations(model: str) -> frozenset[str]:
    if gemini_source_model_type(model) is ModelType.LLM:
        return frozenset({"model/schema", "llm/invoke", "llm/num_tokens"})
    operations = {"model/schema", "text_embedding/invoke", "text_embedding/num_tokens"}
    if model == "gemini-embedding-2-preview":
        operations.add("multimodal_embedding/invoke")
    return frozenset(operations)


class GeminiSourceSettings(_StrictModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    source_base_policy: Literal["unset_or_exact_google_root", "not_used"]
    request_metadata_policy: Literal["system_false_only", "not_used"]
    file_url_policy: Literal["actual_system_absent_or_empty_only", "not_used"]

    def matches_model_type(self, model_type: ModelType) -> bool:
        if model_type is ModelType.LLM:
            return self.model_dump() == {
                "source_base_policy": "unset_or_exact_google_root",
                "request_metadata_policy": "system_false_only",
                "file_url_policy": "actual_system_absent_or_empty_only",
            }
        return model_type is ModelType.TEXT_EMBEDDING and all(
            value == "not_used" for value in self.model_dump().values()
        )


class GeminiMappingSource(MappingSource):
    provider_id: Literal["langgenius/gemini/google"]
    model_type: Literal[ModelType.LLM, ModelType.TEXT_EMBEDDING]
    mode: Literal["chat", "text-embedding"]

    @model_validator(mode="after")
    def exact_identity(self) -> Self:
        kind = gemini_source_model_type(self.model)
        if self.model_type is not kind or self.mode != ("chat" if kind is ModelType.LLM else "text-embedding"):
            raise ValueError("Gemini source type or mode changed")
        return self


class GeminiMappingTarget(MappingTarget):
    model_type: Literal[ModelType.LLM, ModelType.TEXT_EMBEDDING]

    @model_validator(mode="after")
    def exact_identity(self) -> Self:
        if self.model_type is not gemini_source_model_type(self.model):
            raise ValueError("Gemini target type changed")
        return self


class GeminiSourceAdapter(_StrictModel):
    id: Literal["gemini_credit_source_v1"]
    revision: Literal["1"]
    rules_digest: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")


class GeminiSourceVariant(_StrictModel):
    variant_id: str = Field(min_length=1)
    source_plugin_uid: Literal[
        "langgenius/gemini:0.9.12@9bb9eff3f9c99a8f1f87bdd5e0f178d5493918939dd0e02825ae8383bd0fd7ed"
    ]
    source_settings: GeminiSourceSettings
    source_schema_digest: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    source_runtime_schema_digest: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    source_profile_id: str = Field(min_length=1)
    parameter_adapter: GeminiSourceAdapter
    target: GeminiMappingTarget
    operations: list[str] = Field(min_length=3, max_length=4)
    conformance_fixture_ids: list[str] = Field(min_length=1)

    @model_validator(mode="after")
    def closed_capability(self) -> Self:
        if (
            not self.source_settings.matches_model_type(self.target.model_type)
            or set(self.operations) != gemini_source_operations(self.target.model)
            or len(set(self.operations)) != len(self.operations)
            or len(set(self.conformance_fixture_ids)) != len(self.conformance_fixture_ids)
            or self.source_profile_id != "gemini0912-native-v1:" + self.target.model
        ):
            raise ValueError("Invalid bounded Gemini source capability")
        return self


class SourceGeminiVariantMapping(_StrictModel):
    schema_version: Literal[6]
    mapping_revision: str = Field(min_length=1)
    source: GeminiMappingSource
    settlement_owner: Literal["shared_credit_pool"]
    pool_types: list[Literal["paid", "trial"]] = Field(min_length=1)
    variants: list[GeminiSourceVariant] = Field(min_length=1, max_length=1)

    @model_validator(mode="before")
    @classmethod
    def exact_version(cls, value: object) -> object:
        if type(value) is not dict or type(value.get("schema_version")) is not int or value["schema_version"] != 6:
            raise ValueError("Gemini schema version must be integer 6")
        return value

    @model_validator(mode="after")
    def finite_exact_source(self) -> Self:
        if len(set(self.pool_types)) != len(self.pool_types):
            raise ValueError("Duplicate Gemini pools")
        for row in self.variants:
            if row.target.model != self.source.model or row.target.model_type is not self.source.model_type:
                raise ValueError("Gemini source/target identity changed")
        return self


class SourceGeminiVariantSelection(_StrictModel):
    schema_version: Literal[6]
    variant_id: str = Field(min_length=1)
    source_plugin_uid: Literal[
        "langgenius/gemini:0.9.12@9bb9eff3f9c99a8f1f87bdd5e0f178d5493918939dd0e02825ae8383bd0fd7ed"
    ]
    source_settings: GeminiSourceSettings
    source_schema_digest: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    source_runtime_schema_digest: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    registry_digest: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")

    @model_validator(mode="before")
    @classmethod
    def exact_version(cls, value: object) -> object:
        if type(value) is not dict or type(value.get("schema_version")) is not int or value["schema_version"] != 6:
            raise ValueError("Gemini schema version must be integer 6")
        return value


@dataclass(frozen=True, slots=True)
class SelectedGeminiSourceVariant:
    envelope: SourceGeminiVariantMapping
    variant: GeminiSourceVariant
    registry_digest: str

    @property
    def mapping_revision(self) -> str:
        return self.envelope.mapping_revision

    @property
    def source(self) -> GeminiMappingSource:
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
    def parameter_adapter(self) -> GeminiSourceAdapter:
        return self.variant.parameter_adapter

    @property
    def target(self) -> GeminiMappingTarget:
        return self.variant.target

    @property
    def operations(self) -> list[str]:
        return self.variant.operations

    @property
    def conformance_fixture_ids(self) -> list[str]:
        return self.variant.conformance_fixture_ids
