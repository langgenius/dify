"""Resolve migration mappings and source schemas without changing hosted policy.

The registry is an append-only collection of immutable revisions. Callers must
select their migration's exact revision; neither list order nor a newer revision
can change the target of an already prepared or active migration.
"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import Any

from pydantic import TypeAdapter

from core.entities.provider_entities import ProviderQuotaType, QuotaUnit, RestrictModel, SystemConfiguration
from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelType
from models.provider_ids import ModelProviderID
from services.entities.model_billing_mapping import ModelMapping

type SourceIdentity = tuple[ModelType, str]
type MappingIdentity = tuple[str, ModelType, str]
type SchemaLookup = Callable[[ModelType, str, dict[str, Any]], AIModelEntity | None]


def mappings_for_revision(raw_registry: str, revision: str) -> dict[MappingIdentity, ModelMapping]:
    """Validate every revision, then select exactly one; no implicit latest."""
    if not revision:
        raise ValueError("Missing mapping revision")
    records = TypeAdapter(list[ModelMapping]).validate_json(raw_registry)
    versions: dict[str, dict[MappingIdentity, ModelMapping]] = {}
    for record in records:
        identity = (str(ModelProviderID(record.source.provider_id)), record.source.model_type, record.source.model)
        version = versions.setdefault(record.mapping_revision, {})
        if identity in version or record.target.model_type != record.source.model_type:
            raise ValueError("Duplicate source within revision or incompatible model type")
        version[identity] = record
    if revision not in versions:
        raise ValueError("Unknown mapping revision")
    return versions[revision]


@dataclass
class HostedMigrationSource:
    schema: AIModelEntity
    pool_types: set[ProviderQuotaType] = field(default_factory=set)


def hosted_migration_sources(
    system: SystemConfiguration,
    models: Sequence[AIModelEntity],
    supported_model_types: Sequence[ModelType],
    lookup: SchemaLookup,
) -> dict[SourceIdentity, HostedMigrationSource]:
    """Resolve allowlist names using installed schemas, not legacy LLM placeholders.

    Environment allowlists historically label every model LLM. Correct that
    metadata only for this inventory, using a unique actual schema. Explicit
    non-LLM/deployment restrictions retain their type and base-model binding.
    Ambiguous names, missing schemas and empty unrestricted inventories fail
    closed, rather than silently narrowing the migration's coverage.
    """
    sources: dict[SourceIdentity, HostedMigrationSource] = {}
    for quota in system.quota_configurations:
        if (
            quota.quota_type not in {ProviderQuotaType.PAID, ProviderQuotaType.TRIAL}
            or quota.quota_limit == -1
            or quota.quota_unit not in {QuotaUnit.TIMES, QuotaUnit.CREDITS}
        ):
            continue
        if quota.restrict_models:
            schemas = [
                _restricted_schema(restricted, system, models, supported_model_types, lookup)
                for restricted in quota.restrict_models
            ]
        else:
            schemas = list(models)
            if not schemas:
                raise ValueError("Unrestricted source inventory is unavailable")
        for schema in schemas:
            if schema.model_type not in supported_model_types:
                raise ValueError("Source schema has an unsupported type")
            identity = (schema.model_type, schema.model)
            previous = sources.get(identity)
            if previous is not None and previous.schema != schema:
                raise ValueError("Conflicting source schema")
            source = sources.setdefault(identity, HostedMigrationSource(schema))
            source.pool_types.add(quota.quota_type)
    return sources


def _restricted_schema(
    restricted: RestrictModel,
    system: SystemConfiguration,
    models: Sequence[AIModelEntity],
    supported_model_types: Sequence[ModelType],
    lookup: SchemaLookup,
) -> AIModelEntity:
    explicit_type = restricted.model_type != ModelType.LLM or restricted.base_model_name is not None
    candidates = [
        schema
        for schema in models
        if schema.model == restricted.model and (not explicit_type or schema.model_type == restricted.model_type)
    ]
    if not candidates:
        credentials = dict(system.credentials or {})
        if restricted.base_model_name:
            credentials["base_model_name"] = restricted.base_model_name
        types = [restricted.model_type] if explicit_type else supported_model_types
        for model_type in types:
            schema = lookup(model_type, restricted.model, credentials)
            if schema is not None:
                if (schema.model_type, schema.model) != (model_type, restricted.model):
                    raise ValueError("Source schema identity mismatch")
                candidates.append(schema)
    if len(candidates) != 1:
        raise ValueError("Missing or ambiguous source model schema")
    return candidates[0]
