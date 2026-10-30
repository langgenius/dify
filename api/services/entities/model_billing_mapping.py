"""Immutable, revision-scoped contracts for hosted-credit model migration."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from graphon.model_runtime.entities.model_entities import ModelType


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
    id: Literal["identity_v1"]
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
