"""Closed xAI V5 declaration/selection; no V1/V2/V3 or generic alias widening."""

from dataclasses import dataclass
from typing import Literal, Self

from pydantic import ConfigDict, Field, model_validator

from graphon.model_runtime.entities.model_entities import ModelType
from services.entities.model_billing_mapping import MappingSource, MappingTarget, _StrictModel


class XAISourceSettings(_StrictModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    source_base_is_set: bool
    request_metadata_enabled: bool
    # Financial-safe outer evidence explicitly records the source does not
    # read this selector. Only the pure-factory boundary converts it to None.
    protocol_selector: Literal["not_used"]

    @model_validator(mode="after")
    def positive_settings(self) -> Self:
        if self.source_base_is_set is not True or self.request_metadata_enabled is not False:
            raise ValueError("Invalid bounded xAI source settings")
        return self


class XAIMappingSource(MappingSource):
    provider_id: Literal["langgenius/x/x"]
    model_type: Literal[ModelType.LLM]
    model: Literal["grok-4.3", "grok-4.5", "grok-4.6"]
    mode: Literal["chat"]


class XAIMappingTarget(MappingTarget):
    model_type: Literal[ModelType.LLM]
    model: Literal["grok-4.3", "grok-4.5", "grok-4.6"]


class XAISourceAdapter(_StrictModel):
    id: Literal["xai_credit_llm_source_v1"]
    revision: Literal["1"]
    rules_digest: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")


class XAISourceVariant(_StrictModel):
    variant_id: str = Field(min_length=1)
    source_plugin_uid: Literal["langgenius/x:0.0.27@895dd0c90fd73ca6a668860a01e4629fbca15f880b1b38a73e36a1ac45a4b8eb"]
    source_settings: XAISourceSettings
    # Independent server-derived fact; True base-is-set alone proves nothing.
    source_endpoint_class: Literal["official_root"]
    source_schema_digest: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    source_runtime_schema_digest: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    source_profile_id: str = Field(min_length=1)
    parameter_adapter: XAISourceAdapter
    target: XAIMappingTarget
    operations: list[str] = Field(min_length=3, max_length=3)
    conformance_fixture_ids: list[str] = Field(min_length=1)

    @model_validator(mode="after")
    def closed_operations(self) -> Self:
        if set(self.operations) != {"model/schema", "llm/invoke", "llm/num_tokens"} or len(
            set(self.conformance_fixture_ids)
        ) != len(self.conformance_fixture_ids):
            raise ValueError("Invalid bounded xAI operations")
        return self


class SourceXAIVariantMapping(_StrictModel):
    schema_version: Literal[5]
    mapping_revision: str = Field(min_length=1)
    source: XAIMappingSource
    settlement_owner: Literal["shared_credit_pool"]
    pool_types: list[Literal["paid", "trial"]] = Field(min_length=1)
    variants: list[XAISourceVariant] = Field(min_length=1)

    @model_validator(mode="after")
    def finite_exact_xai_variants(self) -> Self:
        if len(set(self.pool_types)) != len(self.pool_types) or len({row.variant_id for row in self.variants}) != len(
            self.variants
        ):
            raise ValueError("Duplicate xAI variants or pools")
        selectors = {
            (row.source_plugin_uid, row.source_settings.model_dump_json(), row.source_endpoint_class)
            for row in self.variants
        }
        if len(selectors) != len(self.variants):
            raise ValueError("Ambiguous xAI source selector")
        for row in self.variants:
            if (
                row.target.model != self.source.model
                or row.source_profile_id != f"xai-credit-027-official-v1:{self.source.model}"
            ):
                raise ValueError("xAI source profile identity changed")
        return self


class SourceXAIVariantSelection(_StrictModel):
    schema_version: Literal[5]
    variant_id: str = Field(min_length=1)
    source_plugin_uid: Literal["langgenius/x:0.0.27@895dd0c90fd73ca6a668860a01e4629fbca15f880b1b38a73e36a1ac45a4b8eb"]
    source_settings: XAISourceSettings
    source_endpoint_class: Literal["official_root"]
    source_schema_digest: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    source_runtime_schema_digest: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    registry_digest: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")


@dataclass(frozen=True, slots=True)
class SelectedXAISourceVariant:
    envelope: SourceXAIVariantMapping
    variant: XAISourceVariant
    registry_digest: str

    @property
    def mapping_revision(self) -> str:
        return self.envelope.mapping_revision

    @property
    def source(self) -> XAIMappingSource:
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
    def parameter_adapter(self) -> XAISourceAdapter:
        return self.variant.parameter_adapter

    @property
    def target(self) -> XAIMappingTarget:
        return self.variant.target

    @property
    def operations(self) -> list[str]:
        return self.variant.operations

    @property
    def conformance_fixture_ids(self) -> list[str]:
        return self.variant.conformance_fixture_ids
