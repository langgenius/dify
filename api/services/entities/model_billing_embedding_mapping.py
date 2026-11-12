"""NEW closed embedding declarations, separate from immutable V1/LLM-only V2.

Shape validation never approves a source profile. Registry selection and the
exact-source embedding factory must additionally prove the reviewed rules,
actual SYSTEM facts and independent source/target runtime-schema boundaries.
This family cannot broaden the old LLM-only V2 declaration or selection shape.
"""

from dataclasses import dataclass
from typing import Literal, Self

from pydantic import ConfigDict, Field, model_validator

from graphon.model_runtime.entities.model_entities import ModelType
from services.entities.model_billing_mapping import MappingSource, MappingTarget, _StrictModel


class EmbeddingSourceSettings(_StrictModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    source_endpoint_class: Literal["unset", "official_root"]
    request_metadata_behavior: Literal["not_used"]


class EmbeddingMappingSource(MappingSource):
    provider_id: Literal["langgenius/openai/openai"]
    model_type: Literal[ModelType.TEXT_EMBEDDING]
    model: Literal["text-embedding-3-small", "text-embedding-3-large", "text-embedding-ada-002"]
    mode: Literal["text-embedding"]


class EmbeddingMappingTarget(MappingTarget):
    model_type: Literal[ModelType.TEXT_EMBEDDING]
    model: Literal["text-embedding-3-small", "text-embedding-3-large", "text-embedding-ada-002"]


class EmbeddingSourceVariantAdapter(_StrictModel):
    id: Literal["openai_embedding_source_v1"]
    revision: Literal["1"]
    rules_digest: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")


class SourceEmbeddingVariant(_StrictModel):
    variant_id: str = Field(min_length=1)
    source_plugin_uid: Literal[
        "langgenius/openai:0.4.2@21195ee1321849e0a7d4b3f6b2fd8c2be23ea6c7182e1b444ecc4c1711b52468",
        "langgenius/openai:1.1.0@95f7de6ee42124cb7649f20d3f175c5b0adb66ad92640a97e4027c15b266141c",
        "langgenius/openai:1.1.0@1ded02acee56efd5788c86fd447d792e4923e959554a4942f440c7859d164340",
    ]
    source_settings: EmbeddingSourceSettings
    source_schema_digest: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    source_runtime_schema_digest: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    source_profile_id: str = Field(min_length=1)
    parameter_adapter: EmbeddingSourceVariantAdapter
    target: EmbeddingMappingTarget
    operations: list[str] = Field(min_length=3, max_length=3)
    conformance_fixture_ids: list[str] = Field(min_length=1)

    @model_validator(mode="after")
    def closed_operations(self) -> Self:
        if set(self.operations) != {"model/schema", "text_embedding/invoke", "text_embedding/num_tokens"} or len(
            set(self.conformance_fixture_ids)
        ) != len(self.conformance_fixture_ids):
            raise ValueError("Invalid bounded embedding operations")
        return self


class SourceEmbeddingVariantMapping(_StrictModel):
    schema_version: Literal[3]
    mapping_revision: str = Field(min_length=1)
    source: EmbeddingMappingSource
    settlement_owner: Literal["shared_credit_pool"]
    pool_types: list[Literal["paid", "trial"]] = Field(min_length=1)
    variants: list[SourceEmbeddingVariant] = Field(min_length=1)

    @model_validator(mode="after")
    def finite_exact_embedding_variants(self) -> Self:
        if len(set(self.pool_types)) != len(self.pool_types) or len({row.variant_id for row in self.variants}) != len(
            self.variants
        ):
            raise ValueError("Duplicate embedding variants or pools")
        selectors = {(row.source_plugin_uid, row.source_settings.model_dump_json()) for row in self.variants}
        if len(selectors) != len(self.variants):
            raise ValueError("Ambiguous embedding source selector")
        for row in self.variants:
            version = {
                "langgenius/openai:0.4.2@21195ee1321849e0a7d4b3f6b2fd8c2be23ea6c7182e1b444ecc4c1711b52468": "042",
                "langgenius/openai:1.1.0@95f7de6ee42124cb7649f20d3f175c5b0adb66ad92640a97e4027c15b266141c": "110",
                "langgenius/openai:1.1.0@1ded02acee56efd5788c86fd447d792e4923e959554a4942f440c7859d164340": "110-1ded",
            }[row.source_plugin_uid]
            if row.target.model != self.source.model or row.source_profile_id != (
                f"openai-{version}-embedding-runtime-v1:{self.source.model}"
            ):
                raise ValueError("Embedding source profile identity changed")
        return self


class SourceEmbeddingVariantSelection(_StrictModel):
    """A separately discriminated proof restored only for a declared V3 source."""

    schema_version: Literal[3]
    variant_id: str = Field(min_length=1)
    source_plugin_uid: Literal[
        "langgenius/openai:0.4.2@21195ee1321849e0a7d4b3f6b2fd8c2be23ea6c7182e1b444ecc4c1711b52468",
        "langgenius/openai:1.1.0@95f7de6ee42124cb7649f20d3f175c5b0adb66ad92640a97e4027c15b266141c",
        "langgenius/openai:1.1.0@1ded02acee56efd5788c86fd447d792e4923e959554a4942f440c7859d164340",
    ]
    source_settings: EmbeddingSourceSettings
    source_schema_digest: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    source_runtime_schema_digest: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    registry_digest: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")


@dataclass(frozen=True, slots=True)
class SelectedEmbeddingSourceVariant:
    """A server-selected embedding route, not a client marker or native alias."""

    envelope: SourceEmbeddingVariantMapping
    variant: SourceEmbeddingVariant
    registry_digest: str

    @property
    def mapping_revision(self) -> str:
        return self.envelope.mapping_revision

    @property
    def source(self) -> EmbeddingMappingSource:
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
    def parameter_adapter(self) -> EmbeddingSourceVariantAdapter:
        return self.variant.parameter_adapter

    @property
    def target(self) -> EmbeddingMappingTarget:
        return self.variant.target

    @property
    def operations(self) -> list[str]:
        return self.variant.operations

    @property
    def conformance_fixture_ids(self) -> list[str]:
        return self.variant.conformance_fixture_ids
