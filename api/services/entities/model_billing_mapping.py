"""Immutable, revision-scoped contracts for hosted-credit model migration."""

import hashlib
import json
from dataclasses import dataclass
from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelType


@dataclass(frozen=True, slots=True)
class SourceParameterContract:
    """Reviewed, non-secret source profile frozen into a managed invocation.

    Concrete adapter families own construction and validate against their own
    exact allowlist. This record alone never authorizes routing or a profile.
    """

    profile_id: str
    source_plugin_unique_identifier: str
    source_model: str
    source_schema_digest: str
    target_model: str
    rules_digest: str
    adapter_id: str
    algorithm_revision: str
    # New reviewed profiles may separate daemon management/catalog metadata
    # from the exact source SDK's model/schema RPC. None preserves all prior
    # contracts; it is never an invitation to infer a runtime digest.
    source_runtime_schema_digest: str | None = None


def model_schema_digest(schema: AIModelEntity) -> str:
    """Canonical source contract hash; preserve the existing frozen algorithm."""
    return (
        "sha256:"
        + hashlib.sha256(
            json.dumps(
                schema.model_dump(mode="json"), sort_keys=True, separators=(",", ":"), ensure_ascii=False
            ).encode()
        ).hexdigest()
    )


class _StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class MappingSource(_StrictModel):
    provider_id: str
    model_type: ModelType
    model: str = Field(min_length=1)
    mode: str = Field(min_length=1)


class MappingTarget(_StrictModel):
    plugin_id: Literal["langgenius/tokener"]
    provider: Literal["tokener"]
    model_type: ModelType
    model: str = Field(min_length=1)
    catalog_revision: str = Field(min_length=1)
    minimum_plugin_version: str = Field(min_length=1)


class ParameterAdapter(_StrictModel):
    id: Literal["identity_v1", "tts_source_voice_v1", "anthropic_source_v1", "openai_chat_source_v1"]
    revision: str = Field(min_length=1)
    rules_digest: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")


class ModelMapping(_StrictModel):
    schema_version: Literal[1]
    mapping_revision: str = Field(min_length=1)
    source: MappingSource
    source_schema_digest: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    settlement_owner: Literal["shared_credit_pool"]
    pool_types: list[Literal["paid", "trial"]] = Field(min_length=1)
    target: MappingTarget
    parameter_adapter: ParameterAdapter
    operations: list[str] = Field(min_length=1)
    conformance_fixture_ids: list[str] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_parameter_adapter(self) -> Self:
        if self.parameter_adapter.id == "tts_source_voice_v1":
            if self.source.model_type != ModelType.TTS or self.target.model_type != ModelType.TTS:
                raise ValueError("TTS voice adapter requires TTS source and target")
            if self.parameter_adapter.revision != "1":
                raise ValueError("Unsupported TTS voice adapter revision")
        if self.parameter_adapter.id == "anthropic_source_v1":
            if self.source.model_type != ModelType.LLM or self.target.model_type != ModelType.LLM:
                raise ValueError("Anthropic source adapter requires LLM source and target")
            if self.parameter_adapter.revision not in {"1", "2"}:
                raise ValueError("Unsupported Anthropic source adapter revision")
        if self.parameter_adapter.id == "openai_chat_source_v1":
            if self.source.model_type != ModelType.LLM or self.target.model_type != ModelType.LLM:
                raise ValueError("OpenAI Chat source adapter requires LLM source and target")
            if self.parameter_adapter.revision not in {"1", "2"}:
                raise ValueError("Unsupported OpenAI Chat source adapter revision")
        return self


class SourceVariantSettings(_StrictModel):
    """Positive public facts, not defaults inferred from missing credentials."""

    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    protocol_selector: Literal["absent", "chat", "responses"]
    source_base_is_set: bool
    request_metadata_enabled: bool


class SourceVariantAdapter(_StrictModel):
    """V2 has its own closed adapter family; V1 validation is unchanged."""

    id: Literal[
        "openai_chat_source_v1",
        "openai_provider110_source_v1",
        "openai_provider042_source_v1",
        "openai_credit_llm_source_v1",
        "openai_credit_llm_source_v2",
    ]
    revision: str = Field(min_length=1)
    rules_digest: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")


class SourceMappingVariant(_StrictModel):
    variant_id: str = Field(min_length=1)
    source_plugin_uid: str = Field(pattern=r"^langgenius/openai:[^@\s]+@[0-9a-f]{64}$")
    source_settings: SourceVariantSettings
    source_schema_digest: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    source_runtime_schema_digest: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    source_profile_id: str = Field(min_length=1)
    parameter_adapter: SourceVariantAdapter
    target: MappingTarget
    operations: list[str] = Field(min_length=1)
    conformance_fixture_ids: list[str] = Field(min_length=1)

    @model_validator(mode="after")
    def closed_operations(self) -> Self:
        if (
            self.target.model_type != ModelType.LLM
            or self.parameter_adapter.id not in {"openai_credit_llm_source_v1", "openai_credit_llm_source_v2"}
            and self.target.model not in {"gpt-4o-mini", "gpt-5.5"}
            or set(self.operations) != {"model/schema", "llm/invoke", "llm/num_tokens"}
            or len(self.operations) != 3
            or len(set(self.conformance_fixture_ids)) != len(self.conformance_fixture_ids)
        ):
            raise ValueError("Invalid bounded source variant contract")
        return self


class SourceVariantSelection(_StrictModel):
    variant_id: str = Field(min_length=1)
    source_plugin_uid: str = Field(pattern=r"^langgenius/openai:[^@\s]+@[0-9a-f]{64}$")
    source_settings: SourceVariantSettings
    source_schema_digest: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    source_runtime_schema_digest: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    registry_digest: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")


class SourceVariantMapping(_StrictModel):
    """Finite exact-source variants for one logical identity in a new revision."""

    schema_version: Literal[2]
    mapping_revision: str = Field(min_length=1)
    source: MappingSource
    settlement_owner: Literal["shared_credit_pool"]
    pool_types: list[Literal["paid", "trial"]] = Field(min_length=1)
    variants: list[SourceMappingVariant] = Field(min_length=1)

    @model_validator(mode="after")
    def finite_source_variants(self) -> Self:
        if (
            self.source.provider_id != "langgenius/openai/openai"
            or self.source.model_type != ModelType.LLM
            or self.source.mode != "chat"
            or len(set(self.pool_types)) != len(self.pool_types)
            or len({item.variant_id for item in self.variants}) != len(self.variants)
        ):
            raise ValueError("Invalid bounded source variant mapping")
        credit_families = {
            item.parameter_adapter.id
            for item in self.variants
            if item.parameter_adapter.id in {"openai_credit_llm_source_v1", "openai_credit_llm_source_v2"}
        }
        if credit_families:
            if len(credit_families) != 1:
                raise ValueError("Mixed credit LLM source adapter families")
            credit_family = next(iter(credit_families))
            # Import only when validating the new family: its pure owner uses
            # the shared settings DTO, and owns the finite UID/model/alias rules.
            if credit_family == "openai_credit_llm_source_v2":
                from services.model_billing_openai_credit_llm_v2_adapter import (
                    openai_credit_llm_protocol,
                    validate_openai_credit_llm_identity,
                )
            else:
                from services.model_billing_openai_credit_llm_adapter import (
                    openai_credit_llm_protocol,
                    validate_openai_credit_llm_identity,
                )

            for item in self.variants:
                if item.parameter_adapter.id != credit_family or item.parameter_adapter.revision != "1":
                    raise ValueError("Invalid bounded source variant mapping")
                validate_openai_credit_llm_identity(
                    source_provider=self.source.provider_id,
                    source_model=self.source.model,
                    source_plugin_unique_identifier=item.source_plugin_uid,
                    model_type=self.source.model_type,
                    target_model=item.target.model,
                )
                openai_credit_llm_protocol(
                    source_plugin_unique_identifier=item.source_plugin_uid,
                    source_settings=item.source_settings,
                    source_endpoint_class="official_root" if item.source_settings.source_base_is_set else "unset",
                )
        elif (
            self.source.model not in {"gpt-4o-mini", "gpt-5.5"}
            or any(item.target.model != self.source.model for item in self.variants)
            or any(
                (item.parameter_adapter.id == "openai_provider042_source_v1") != (self.source.model == "gpt-5.5")
                for item in self.variants
            )
        ):
            raise ValueError("Invalid bounded source variant mapping")
        selectors = {(item.source_plugin_uid, item.source_settings.model_dump_json()) for item in self.variants}
        if len(selectors) != len(self.variants):
            raise ValueError("Ambiguous source variant selector")
        return self


@dataclass(frozen=True, slots=True)
class SelectedSourceVariant:
    """A server-selected immutable route, never a client routing instruction."""

    envelope: SourceVariantMapping
    variant: SourceMappingVariant
    registry_digest: str

    @property
    def mapping_revision(self) -> str:
        return self.envelope.mapping_revision

    @property
    def source(self) -> MappingSource:
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
    def parameter_adapter(self) -> SourceVariantAdapter:
        return self.variant.parameter_adapter

    @property
    def target(self) -> MappingTarget:
        return self.variant.target

    @property
    def operations(self) -> list[str]:
        return self.variant.operations

    @property
    def conformance_fixture_ids(self) -> list[str]:
        return self.variant.conformance_fixture_ids
