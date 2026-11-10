"""Closed V8 Gemini source shapes, separate from immutable V6 declarations.

This DTO validates declaration shape only. A syntactically valid digest is not
reviewed source, SDK/runtime, installed package or target capability evidence.
No registry dispatch, factory, credential, SYSTEM/BYOK or upgrade authority is
added here. Real 0913 contracts must be reviewed before this family is wired.
"""

from dataclasses import dataclass
from typing import Annotated, Literal, Self

from pydantic import Field, model_validator

from services.entities.model_billing_gemini_mapping import (
    GEMINI_SOURCE_UID,
    GeminiMappingSource,
    GeminiMappingTarget,
    GeminiSourceSettings,
    gemini_source_operations,
)
from services.entities.model_billing_mapping import _StrictModel

GEMINI_0913_SOURCE_UID = "langgenius/gemini:0.9.13@4378187cfc50d4253573f4d96baa13228d8ed2eb746ac3bae492a8eaee2da458"

type GeminiV8SourceUID = Literal[
    "langgenius/gemini:0.9.12@9bb9eff3f9c99a8f1f87bdd5e0f178d5493918939dd0e02825ae8383bd0fd7ed",
    "langgenius/gemini:0.9.13@4378187cfc50d4253573f4d96baa13228d8ed2eb746ac3bae492a8eaee2da458",
]


class GeminiV8SourceAdapter(_StrictModel):
    id: Literal["gemini_credit_source_v1", "gemini_credit_source_v2"]
    revision: Literal["1"]
    rules_digest: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")


class GeminiV8SourceVariant(_StrictModel):
    variant_id: str = Field(min_length=1)
    source_plugin_uid: GeminiV8SourceUID
    source_settings: GeminiSourceSettings
    source_schema_digest: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    source_runtime_schema_digest: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    source_profile_id: str = Field(min_length=1)
    parameter_adapter: GeminiV8SourceAdapter
    target: GeminiMappingTarget
    operations: list[str] = Field(min_length=3, max_length=4)
    conformance_fixture_ids: list[Annotated[str, Field(min_length=1)]] = Field(min_length=1)

    @model_validator(mode="after")
    def closed_capability(self) -> Self:
        prefix, adapter = (
            ("gemini0912-native-v1:", "gemini_credit_source_v1")
            if self.source_plugin_uid == GEMINI_SOURCE_UID
            else ("gemini0913-native-v1:", "gemini_credit_source_v2")
        )
        if (
            self.source_profile_id != prefix + self.target.model
            or self.parameter_adapter.id != adapter
            or not self.source_settings.matches_model_type(self.target.model_type)
            or set(self.operations) != gemini_source_operations(self.target.model)
            or len(set(self.operations)) != len(self.operations)
            or len(set(self.conformance_fixture_ids)) != len(self.conformance_fixture_ids)
        ):
            raise ValueError("Invalid bounded V8 Gemini source capability")
        return self


class SourceGeminiV8VariantMapping(_StrictModel):
    schema_version: Literal[8]
    mapping_revision: str = Field(min_length=1)
    source: GeminiMappingSource
    settlement_owner: Literal["shared_credit_pool"]
    pool_types: list[Literal["paid", "trial"]] = Field(min_length=1)
    variants: list[GeminiV8SourceVariant] = Field(min_length=1, max_length=2)

    @model_validator(mode="before")
    @classmethod
    def exact_version(cls, value: object) -> object:
        if type(value) is not dict or type(value.get("schema_version")) is not int or value["schema_version"] != 8:
            raise ValueError("Gemini schema version must be integer 8")
        return value

    @model_validator(mode="after")
    def finite_exact_sources(self) -> Self:
        if len(set(self.pool_types)) != len(self.pool_types):
            raise ValueError("Duplicate V8 Gemini pools")
        if len({item.variant_id for item in self.variants}) != len(self.variants):
            raise ValueError("Duplicate V8 Gemini variant identity")
        selectors = {(item.source_plugin_uid, item.source_settings.model_dump_json()) for item in self.variants}
        if len(selectors) != len(self.variants):
            raise ValueError("Ambiguous V8 Gemini source selector")
        if any(
            item.target.model != self.source.model or item.target.model_type is not self.source.model_type
            for item in self.variants
        ):
            raise ValueError("V8 Gemini source/target identity changed")
        return self


class SourceGeminiV8VariantSelection(_StrictModel):
    schema_version: Literal[8]
    variant_id: str = Field(min_length=1)
    source_plugin_uid: GeminiV8SourceUID
    source_settings: GeminiSourceSettings
    source_schema_digest: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    source_runtime_schema_digest: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    registry_digest: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")

    @model_validator(mode="before")
    @classmethod
    def exact_version(cls, value: object) -> object:
        if type(value) is not dict or type(value.get("schema_version")) is not int or value["schema_version"] != 8:
            raise ValueError("Gemini schema version must be integer 8")
        return value


@dataclass(frozen=True, slots=True)
class SelectedGeminiV8SourceVariant:
    """Future registry-selected wrapper; constructing it grants no authority."""

    envelope: SourceGeminiV8VariantMapping
    variant: GeminiV8SourceVariant
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
    def parameter_adapter(self) -> GeminiV8SourceAdapter:
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
