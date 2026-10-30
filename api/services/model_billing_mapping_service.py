"""Resolve migration mappings and source schemas without changing hosted policy.

The registry is an append-only collection of immutable revisions. Callers must
select their migration's exact revision; neither list order nor a newer revision
can change the target of an already prepared or active migration.
"""

import hashlib
import json
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import Any

from packaging.version import InvalidVersion, Version
from pydantic import TypeAdapter

from core.entities.provider_entities import (
    ProviderQuotaType,
    QuotaConfiguration,
    QuotaUnit,
    RestrictModel,
    SystemConfiguration,
)
from core.hosting_configuration import HostingProvider, TrialHostingQuota
from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelPropertyKey, ModelType
from models.provider_ids import ModelProviderID
from services.entities.model_billing_mapping import ModelMapping
from services.model_billing_retirement_policy import ModelRetirementPolicy, resolve_retirement_policy

type SourceIdentity = tuple[ModelType, str]
type MappingIdentity = tuple[str, ModelType, str]
type SchemaLookup = Callable[[ModelType, str, dict[str, Any]], AIModelEntity | None]


def migration_policy_allows_empty_sources(eligibility_policy_version: str | None) -> bool:
    """Only the persisted legacy-free policy can migrate without hosted sources.

    None is the historical caller contract and remains strict, as do paid and
    unknown policies. This does not authorize missing schemas or mappings for
    any source that is present, and never grants permission to spend a quota.
    """
    return eligibility_policy_version == "free-legacy-v1"


def model_schema_digest(schema: AIModelEntity) -> str:
    """Hash the same complete source contract during preparation and late admission."""
    return (
        "sha256:"
        + hashlib.sha256(
            json.dumps(
                schema.model_dump(mode="json"), sort_keys=True, separators=(",", ":"), ensure_ascii=False
            ).encode()
        ).hexdigest()
    )


def provider_has_prepared_ownership(provider: str, state: dict[str, Any]) -> bool:
    """Only a missing key is a new provider; malformed provenance is never upgraded."""
    ownership = state.get("source_ownership")
    return not isinstance(ownership, dict) or str(ModelProviderID(provider)) in ownership


def has_finite_hosted_credit_pool(hosting: HostingProvider) -> bool:
    return (
        hosting.enabled
        and hosting.quota_unit in {QuotaUnit.CREDITS, QuotaUnit.TIMES}
        and any(
            pool.quota_type in {ProviderQuotaType.PAID, ProviderQuotaType.TRIAL}
            and not (isinstance(pool, TrialHostingQuota) and pool.quota_limit == -1)
            for pool in hosting.quotas
        )
    )


def additional_model_is_authorized(
    *, system: SystemConfiguration, installed_models: Sequence[AIModelEntity], mapping: ModelMapping
) -> bool:
    """Require the narrowed, typed availability contract even on direct API calls."""
    quota = next(
        (quota for quota in system.quota_configurations if quota.quota_type == system.current_quota_type), None
    )
    if quota is None or not any(
        (restricted.model_type, restricted.model) == (mapping.source.model_type, mapping.source.model)
        for restricted in quota.restrict_models
    ):
        return False
    schemas = [
        schema
        for schema in installed_models
        if (schema.model_type, schema.model) == (mapping.source.model_type, mapping.source.model)
    ]
    return (
        len(schemas) == 1
        and model_schema_digest(schemas[0]) == mapping.source_schema_digest
        and mapping_has_required_operations(mapping)
        and (
            mapping.source.model_type != ModelType.LLM
            or schemas[0].model_properties.get(ModelPropertyKey.MODE) == mapping.source.mode
        )
    )


def mapping_has_required_operations(mapping: ModelMapping) -> bool:
    required = {"model/schema", f"{mapping.source.model_type.value}/invoke"}
    if mapping.source.model_type == ModelType.LLM:
        required.add("llm/num_tokens")
    elif mapping.source.model_type == ModelType.TEXT_EMBEDDING:
        # ModelType uses hyphens, while daemon operations use underscores.
        required = {"model/schema", "text_embedding/invoke", "text_embedding/num_tokens"}
    return required <= set(mapping.operations)


def mapping_supports_installed_plugin(mapping: ModelMapping, plugin_unique_identifier: str) -> bool:
    try:
        plugin_id, version_and_hash = plugin_unique_identifier.split(":", 1)
        version = version_and_hash.split("@", 1)[0]
        return plugin_id == mapping.target.plugin_id and Version(version) >= Version(
            mapping.target.minimum_plugin_version
        )
    except (ValueError, InvalidVersion):
        return False


@dataclass(frozen=True)
class HostedCompatibilityAvailability:
    """Read-only availability metadata, not an issued or spendable legacy quota."""

    quotas: list[QuotaConfiguration]
    current_quota_type: ProviderQuotaType


def additional_hosted_availability(
    *,
    provider: str,
    hosting: HostingProvider,
    installed_models: Sequence[AIModelEntity],
    original_quotas: Sequence[QuotaConfiguration],
    raw_registry: str,
    revision: str,
) -> HostedCompatibilityAvailability | None:
    """Admit a newly installed trusted provider using explicit, frozen contracts.

    The caller must verify Marketplace provenance and the installed signature.
    No old wallet or migration manifest is changed. Each finite pool exposes
    only the intersection of server hosting policy, installed source schemas,
    and exact mappings in the tenant's existing revision. Other revisions never
    authorize a model. Invalid or absent contracts make this provider unavailable
    without preventing an unrelated provider or an explicit BYOK from loading.
    Independent provider-free and originally unlimited quota semantics survive.
    """
    if not hosting.enabled:
        return None
    independent = [
        quota.model_copy(deep=True)
        for quota in original_quotas
        if quota.quota_type == ProviderQuotaType.FREE or quota.quota_limit == -1
    ]
    try:
        registry = mappings_for_revision(raw_registry, revision)
    except ValueError:
        registry = {}
    provider_id = str(ModelProviderID(provider))
    quotas = list(independent)
    if hosting.quota_unit in {QuotaUnit.CREDITS, QuotaUnit.TIMES}:
        for pool in hosting.quotas:
            if (
                pool.quota_type not in {ProviderQuotaType.PAID, ProviderQuotaType.TRIAL}
                or isinstance(pool, TrialHostingQuota)
                and pool.quota_limit == -1
                or any(quota.quota_type == pool.quota_type for quota in independent)
            ):
                continue
            restrictions: list[RestrictModel] = []
            for schema in installed_models:
                rule = registry.get((provider_id, schema.model_type, schema.model))
                if (
                    rule is None
                    or pool.quota_type not in rule.pool_types
                    or not mapping_has_required_operations(rule)
                    or model_schema_digest(schema) != rule.source_schema_digest
                    or schema.model_type == ModelType.LLM
                    and schema.model_properties.get(ModelPropertyKey.MODE) != rule.source.mode
                ):
                    continue
                matching = [restricted for restricted in pool.restrict_models if restricted.model == schema.model]
                if pool.restrict_models and not any(
                    len(candidates := _installed_restricted_schemas(restricted, installed_models)) == 1
                    and candidates[0] == schema
                    for restricted in matching
                ):
                    continue
                restrictions.append(RestrictModel(model=schema.model, model_type=schema.model_type))
            if restrictions:
                quotas.append(
                    QuotaConfiguration(
                        quota_type=pool.quota_type,
                        quota_unit=hosting.quota_unit,
                        quota_limit=0,
                        quota_used=0,
                        is_valid=False,
                        restrict_models=restrictions,
                    )
                )
    # Preserve the ordinary paid > free > trial selection if a real preexisting
    # row is valid. In particular a free pool must not displace an available
    # paid pool, and an originally unlimited pool must never become billable.
    for pool_type in (ProviderQuotaType.PAID, ProviderQuotaType.FREE, ProviderQuotaType.TRIAL):
        if any(quota.quota_type == pool_type and quota.is_valid for quota in original_quotas):
            if any(quota.quota_type == pool_type for quota in quotas):
                return HostedCompatibilityAvailability(quotas, pool_type)
            return None
    for pool_type in (ProviderQuotaType.PAID, ProviderQuotaType.TRIAL):
        if any(quota.quota_type == pool_type and quota.quota_limit != -1 for quota in quotas):
            return HostedCompatibilityAvailability(quotas, pool_type)
    return None


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


def retirement_policy_for_revision(
    raw_policy: str, revision: str, mappings: dict[MappingIdentity, ModelMapping]
) -> ModelRetirementPolicy:
    policy = resolve_retirement_policy(raw_policy, revision)
    if policy.identities.intersection(mappings):
        raise ValueError("A source cannot be both retired and routed in the same revision")
    return policy


@dataclass(frozen=True)
class HostedMigrationPartition:
    system: SystemConfiguration
    models: list[AIModelEntity]
    retired: dict[SourceIdentity, set[ProviderQuotaType]]


def partition_hosted_migration_sources(
    system: SystemConfiguration,
    models: Sequence[AIModelEntity],
    retired_sources: frozenset[SourceIdentity],
) -> HostedMigrationPartition:
    """Remove only declared retirements before preparation's schema lookup.

    An exhausted restriction list removes that quota rather than becoming an
    unrestricted pool. Original ownership and quota objects stay unchanged.
    Ambiguous installed types retain strict rejection, not name-only retirement.
    """
    if not retired_sources:
        return HostedMigrationPartition(system, list(models), {})
    retired: dict[SourceIdentity, set[ProviderQuotaType]] = {}
    active_quotas: list[QuotaConfiguration] = []
    for quota in system.quota_configurations:
        if (
            quota.quota_type not in {ProviderQuotaType.PAID, ProviderQuotaType.TRIAL}
            or quota.quota_limit == -1
            or quota.quota_unit not in {QuotaUnit.TIMES, QuotaUnit.CREDITS}
        ):
            active_quotas.append(quota)
            continue
        if not quota.restrict_models:
            for schema in models:
                identity = (schema.model_type, schema.model)
                if identity in retired_sources:
                    retired.setdefault(identity, set()).add(quota.quota_type)
            active_quotas.append(quota)
            continue
        restrictions: list[RestrictModel] = []
        for restricted in quota.restrict_models:
            candidates = _installed_restricted_schemas(restricted, models)
            if len(candidates) > 1:
                raise ValueError("Ambiguous source model schema")
            kind = candidates[0].model_type if candidates else restricted.model_type
            identity = (kind, restricted.model)
            if identity in retired_sources:
                retired.setdefault(identity, set()).add(quota.quota_type)
            else:
                restrictions.append(restricted)
        if restrictions:
            active_quotas.append(quota.model_copy(update={"restrict_models": restrictions}))
    active_models = [schema for schema in models if (schema.model_type, schema.model) not in retired_sources]
    if models and not active_models:
        # A known all-retired unrestricted inventory is empty by policy. An
        # unknown empty inventory still reaches the ordinary strict lookup.
        active_quotas = [
            quota
            for quota in active_quotas
            if quota.restrict_models
            or quota.quota_type not in {ProviderQuotaType.PAID, ProviderQuotaType.TRIAL}
            or quota.quota_limit == -1
            or quota.quota_unit not in {QuotaUnit.TIMES, QuotaUnit.CREDITS}
        ]
    return HostedMigrationPartition(
        system.model_copy(update={"quota_configurations": active_quotas}), active_models, retired
    )


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
    candidates = _installed_restricted_schemas(restricted, models)
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


def _installed_restricted_schemas(restricted: RestrictModel, models: Sequence[AIModelEntity]) -> list[AIModelEntity]:
    explicit_type = restricted.model_type != ModelType.LLM or restricted.base_model_name is not None
    return [
        schema
        for schema in models
        if schema.model == restricted.model and (not explicit_type or schema.model_type == restricted.model_type)
    ]
