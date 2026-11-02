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
from graphon.model_runtime.entities.provider_entities import ConfigurateMethod, ProviderEntity
from models.provider_ids import ModelProviderID
from services.entities.model_billing_mapping import ModelMapping
from services.entities.model_billing_mapping import SourceParameterContract as SourceParameterContract  # noqa: PLC0414
from services.entities.model_billing_mapping import model_schema_digest as model_schema_digest  # noqa: PLC0414
from services.model_billing_anthropic_adapter import AnthropicSourceContract as AnthropicSourceContract  # noqa: PLC0414
from services.model_billing_anthropic_adapter import anthropic_source_marker as anthropic_source_marker  # noqa: PLC0414
from services.model_billing_anthropic_adapter import build_anthropic_source_contract
from services.model_billing_anthropic_adapter import (
    restore_anthropic_source_contract as restore_anthropic_source_contract,  # noqa: PLC0414
)
from services.model_billing_openai_chat_adapter import (
    OpenAIChatSourceContract,
    build_openai_chat_source_contract,
    openai_chat_source_marker,
    restore_openai_chat_source_contract,
)
from services.model_billing_retirement_policy import ModelRetirementPolicy, resolve_retirement_policy
from services.model_billing_source_capability_policy import SourceCapabilityDeclaration, UnavailableSourceEvidence
from services.model_billing_source_capability_policy import (
    resolve_source_capability_policy as resolve_source_capability_policy,  # noqa: PLC0414
)
from services.model_billing_tts_adapter import TTSVoiceContract as TTSVoiceContract  # noqa: PLC0414
from services.model_billing_tts_adapter import build_tts_voice_contract as build_tts_voice_contract  # noqa: PLC0414
from services.model_billing_tts_adapter import normalize_tts_voice as normalize_tts_voice  # noqa: PLC0414

type SourceIdentity = tuple[ModelType, str]
type MappingIdentity = tuple[str, ModelType, str]
type SchemaLookup = Callable[[ModelType, str, dict[str, Any]], AIModelEntity | None]


def build_source_adapter_contract(
    mapping: ModelMapping,
    *,
    source_provider: str,
    source_plugin_unique_identifier: str,
    source_schema: AIModelEntity,
    source_credentials: dict[str, Any] | None,
) -> TTSVoiceContract | SourceParameterContract | None:
    """Dispatch the typed source adapter; identity preserves historical behavior."""
    if mapping.parameter_adapter.id == "identity_v1":
        return None
    arguments = {
        "adapter_id": mapping.parameter_adapter.id,
        "adapter_revision": mapping.parameter_adapter.revision,
        "expected_rules_digest": mapping.parameter_adapter.rules_digest,
        "source_provider": source_provider,
        "source_model": mapping.source.model,
        "source_plugin_unique_identifier": source_plugin_unique_identifier,
        "expected_source_schema_digest": mapping.source_schema_digest,
    }
    if mapping.parameter_adapter.id == "anthropic_source_v1":
        return build_anthropic_source_contract(
            **arguments, source_schema=source_schema, target_model=mapping.target.model
        )
    if mapping.parameter_adapter.id == "openai_chat_source_v1":
        if source_credentials is None:
            raise ValueError("Actual source SYSTEM credential settings are unavailable")
        return build_openai_chat_source_contract(
            **arguments,
            source_schema=source_schema,
            target_model=mapping.target.model,
            source_api_protocol=source_credentials.get("api_protocol"),
        )
    return build_tts_voice_contract(**arguments, source_schema=source_schema)


def source_parameter_marker(
    contract: SourceParameterContract,
    *,
    source_provider: str,
    source_model: str,
    model_type: ModelType,
    target_model: str,
) -> dict[str, Any]:
    """Dispatch only a reviewed concrete family, never an arbitrary record."""
    arguments = {
        "source_provider": source_provider,
        "source_model": source_model,
        "target_model": target_model,
    }
    if isinstance(contract, OpenAIChatSourceContract):
        return openai_chat_source_marker(contract, **arguments, model_type=model_type)
    if isinstance(contract, AnthropicSourceContract):
        return anthropic_source_marker(contract, **arguments, model_type=model_type)
    raise ValueError("Unsupported source parameter adapter family")


def source_parameter_public_settings(
    contract: SourceParameterContract, *, source_credentials: dict[str, Any] | None
) -> dict[str, str] | None:
    """Record only reviewed non-secret protocol facts; never serialize keys.

    None means this adapter family has no public settings attestation. For
    OpenAI, an absent optional protocol value is recorded explicitly as its
    source runtime's default Chat choice, not as an invented Responses override.
    """
    if not isinstance(contract, OpenAIChatSourceContract):
        return None
    if source_credentials is None:
        raise ValueError("Actual source SYSTEM credential settings are unavailable")
    protocol = source_credentials.get("api_protocol")
    if protocol is None:
        return {"api_protocol": "default_chat"}
    if protocol == "chat":
        return {"api_protocol": "chat"}
    raise ValueError("Unreviewed source SYSTEM protocol settings")


def restore_source_parameter_contract(
    marker: object, *, mapping: ModelMapping, source_public_settings: object
) -> SourceParameterContract:
    """Restore freshly verified inventory by its exact registry adapter family."""
    arguments = {
        "source_provider": str(ModelProviderID(mapping.source.provider_id)),
        "source_model": mapping.source.model,
        "target_model": mapping.target.model,
    }
    if mapping.parameter_adapter.id == "openai_chat_source_v1":
        if (
            not isinstance(source_public_settings, dict)
            or set(source_public_settings) != {"api_protocol"}
            or source_public_settings["api_protocol"] not in ("default_chat", "chat")
        ):
            raise ValueError("Missing or invalid source SYSTEM protocol proof")
        protocol = None if source_public_settings["api_protocol"] == "default_chat" else "chat"
        contract: SourceParameterContract = restore_openai_chat_source_contract(
            marker, **arguments, model_type=mapping.source.model_type, source_api_protocol=protocol
        )
    elif mapping.parameter_adapter.id == "anthropic_source_v1" and source_public_settings is None:
        contract = restore_anthropic_source_contract(marker, **arguments, model_type=mapping.source.model_type)
    else:
        raise ValueError("Unsupported source parameter adapter family or settings")
    if (
        contract.rules_digest != mapping.parameter_adapter.rules_digest
        or contract.source_schema_digest != mapping.source_schema_digest
        or contract.adapter_id != mapping.parameter_adapter.id
        or contract.algorithm_revision != mapping.parameter_adapter.revision
    ):
        raise ValueError("Source parameter adapter mapping mismatch")
    return contract


def migration_policy_allows_empty_sources(eligibility_policy_version: str | None) -> bool:
    """Only the persisted legacy-free policy can migrate without hosted sources.

    None is the historical caller contract and remains strict, as do paid and
    unknown policies. This does not authorize missing schemas or mappings for
    any source that is present, and never grants permission to spend a quota.
    """
    return eligibility_policy_version == "free-legacy-v1"


def provider_has_prepared_ownership(provider: str, state: dict[str, Any]) -> bool:
    """Only a missing key is a new provider; malformed provenance is never upgraded."""
    ownership = state.get("source_ownership")
    return not isinstance(ownership, dict) or str(ModelProviderID(provider)) in ownership


def uses_published_tokener_balance(state: dict[str, Any] | None) -> bool:
    """Only a published route plus the persisted cohort removes old pool ACLs."""
    return bool(
        state
        and state.get("persisted_model_billing_source") == "tokener"
        and (
            state.get("phase") == "active"
            or state.get("phase") == "cancelled"
            and state.get("ever_activated") is True
            and state.get("claimed_at") is not None
        )
    )


def validate_prepared_provider_provenance(provider: str, state: dict[str, Any]) -> None:
    """Validate historical facts without treating their chosen pool as an ACL."""
    ownership = state.get("source_ownership")
    if not isinstance(ownership, dict):
        raise ValueError("Invalid source ownership")
    provider_id = str(ModelProviderID(provider))
    if provider_id not in ownership:
        return
    record = ownership[provider_id]
    if not isinstance(record, dict) or record.get("current_quota_type") not in {"paid", "trial", "free"}:
        raise ValueError("Invalid source ownership")
    quotas = record.get("quotas")
    if (
        not isinstance(quotas, dict)
        or record["current_quota_type"] not in quotas
        or any(
            name not in {"paid", "trial", "free"}
            or not isinstance(quota, dict)
            or not isinstance(quota.get("unmetered"), bool)
            for name, quota in quotas.items()
        )
    ):
        raise ValueError("Invalid source ownership")


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
    return len(schemas) == 1 and source_schema_matches_mapping(schemas[0], mapping)


def source_schema_matches_mapping(schema: AIModelEntity, mapping: ModelMapping) -> bool:
    return (
        (schema.model_type, schema.model) == (mapping.source.model_type, mapping.source.model)
        and model_schema_digest(schema) == mapping.source_schema_digest
        and mapping_has_required_operations(mapping)
        and (
            schema.model_type != ModelType.LLM
            or schema.model_properties.get(ModelPropertyKey.MODE) == mapping.source.mode
        )
    )


def managed_source_schemas(system: SystemConfiguration, provider: ProviderEntity) -> tuple[AIModelEntity, ...]:
    """Return catalog plus only evidence bound to the same source installation."""
    selected = next(
        (quota for quota in system.quota_configurations if quota.quota_type == system.current_quota_type), None
    )
    extra = (
        system._tokener_source_schemas
        if selected is not None
        and selected.quota_type in {ProviderQuotaType.PAID, ProviderQuotaType.TRIAL}
        and selected.quota_limit != -1
        and selected.quota_unit in {QuotaUnit.CREDITS, QuotaUnit.TIMES}
        and system._tokener_source_plugin_unique_identifier is not None
        and system._tokener_source_plugin_unique_identifier == getattr(provider, "plugin_unique_identifier", None)
        else ()
    )
    return (*provider.models, *extra)


@dataclass(frozen=True)
class HostedSourceSchemaCandidate:
    mapping: ModelMapping
    # None preserves original provider credentials, rather than inventing a deployment.
    base_model_name: str | None


def mapped_dynamic_source_candidates(
    *, provider: ProviderEntity, hosting: HostingProvider, raw_registry: str, revision: str
) -> tuple[HostedSourceSchemaCandidate, ...]:
    """Plan bounded source lookups; this policy never performs RPC or inference."""
    if (
        not hosting.enabled
        or hosting.quota_unit not in {QuotaUnit.CREDITS, QuotaUnit.TIMES}
        or ConfigurateMethod.CUSTOMIZABLE_MODEL not in provider.configurate_methods
    ):
        return ()
    try:
        registry = mappings_for_revision(raw_registry, revision)
    except ValueError:
        return ()
    installed = {(schema.model_type, schema.model) for schema in provider.models}
    candidates = []
    for (provider_id, kind, model), rule in registry.items():
        if (
            provider_id != str(ModelProviderID(provider.provider))
            or (kind, model) in installed
            or kind not in provider.supported_model_types
            or not mapping_has_required_operations(rule)
        ):
            continue
        bindings: set[str | None] = set()
        for pool in hosting.quotas:
            if pool.quota_type not in {ProviderQuotaType.PAID, ProviderQuotaType.TRIAL} or (
                isinstance(pool, TrialHostingQuota) and pool.quota_limit == -1
            ):
                continue
            if not pool.restrict_models:
                bindings.add(None)
            for restricted in pool.restrict_models:
                if restricted.model == model and (
                    restricted.model_type == kind
                    or restricted.model_type == ModelType.LLM
                    and restricted.base_model_name is None
                ):
                    bindings.add(restricted.base_model_name)
        if len(bindings) == 1:
            candidates.append(HostedSourceSchemaCandidate(rule, next(iter(bindings))))
    return tuple(candidates)


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


def published_original_quotas(
    provider: str, quotas: Sequence[QuotaConfiguration], state: dict[str, Any]
) -> tuple[list[QuotaConfiguration], ProviderQuotaType | None]:
    """Close old finite balances while preserving original independent owners."""
    validate_prepared_provider_provenance(provider, state)
    record = state["source_ownership"].get(str(ModelProviderID(provider)))
    owned_quotas = record["quotas"] if record is not None else {}
    result = []
    for original in quotas:
        quota = original.model_copy(deep=True)
        if quota.quota_type in {ProviderQuotaType.PAID, ProviderQuotaType.TRIAL}:
            unmetered = owned_quotas.get(quota.quota_type.value, {}).get("unmetered", quota.quota_limit == -1)
            quota.quota_limit = -1 if unmetered else 0
            quota.quota_used = 0
            quota.is_valid = bool(unmetered)
        result.append(quota)
    preserve = None
    if record is not None:
        selected = ProviderQuotaType(record["current_quota_type"])
        if selected == ProviderQuotaType.FREE or owned_quotas[selected.value]["unmetered"]:
            preserve = selected
    return result, preserve


def additional_hosted_availability(
    *,
    provider: str,
    hosting: HostingProvider,
    installed_models: Sequence[AIModelEntity],
    original_quotas: Sequence[QuotaConfiguration],
    raw_registry: str,
    revision: str,
    published_balance: bool = False,
    preserve_independent_pool: ProviderQuotaType | None = None,
) -> HostedCompatibilityAvailability | None:
    """Build trusted hosted availability using explicit, frozen contracts.

    The caller must verify Marketplace provenance and the installed signature.
    No old wallet or migration manifest is changed. Each finite pool exposes
    only the intersection of server hosting policy, installed source schemas,
    and exact mappings in the tenant's existing revision. Other revisions never
    authorize a model. Invalid or absent contracts make this provider unavailable
    without preventing an unrelated provider or an explicit BYOK from loading.
    Independent provider-free and originally unlimited quota semantics survive.
    Published balance mode serves both prepared and additional providers: finite
    PAID/TRIAL hosting lists are one model set, not legacy wallet entitlements.
    False retains the pre-publication per-pool behavior without expanding it.
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
                    or not published_balance
                    and pool.quota_type not in rule.pool_types
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
    if published_balance:
        union = {
            (restricted.model_type, restricted.model): restricted
            for quota in quotas
            if quota.quota_type in {ProviderQuotaType.PAID, ProviderQuotaType.TRIAL} and quota.quota_limit != -1
            for restricted in quota.restrict_models
        }
        for quota in quotas:
            if quota.quota_type in {ProviderQuotaType.PAID, ProviderQuotaType.TRIAL} and quota.quota_limit != -1:
                quota.restrict_models = [union[identity] for identity in sorted(union)]
        if preserve_independent_pool is not None and any(
            quota.quota_type == preserve_independent_pool
            and quota.is_valid
            and (quota.quota_type == ProviderQuotaType.FREE or quota.quota_limit == -1)
            for quota in quotas
        ):
            return HostedCompatibilityAvailability(quotas, preserve_independent_pool)
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


def source_catalog_digest(
    models: Sequence[AIModelEntity],
    original_methods: Sequence[ConfigurateMethod],
    supported_model_types: Sequence[ModelType],
) -> str:
    """Bind evidence to the complete original catalog, never the restricted view."""
    identities = {(schema.model_type, schema.model) for schema in models}
    if not models or len(identities) != len(models):
        raise ValueError("Source capability requires a nonempty unique catalog")
    if not original_methods or len(set(original_methods)) != len(original_methods):
        raise ValueError("Invalid original source configuration methods")
    if not supported_model_types or len(set(supported_model_types)) != len(supported_model_types):
        raise ValueError("Invalid supported source model types")
    if any(schema.model_type not in supported_model_types for schema in models):
        raise ValueError("Source catalog contains an unsupported type")
    payload = {
        "original_configurate_methods": sorted(method.value for method in original_methods),
        "supported_model_types": sorted(kind.value for kind in supported_model_types),
        "models": [
            schema.model_dump(mode="json")
            for schema in sorted(models, key=lambda schema: (schema.model_type.value, schema.model))
        ],
    }
    return (
        "sha256:"
        + hashlib.sha256(
            json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
        ).hexdigest()
    )


@dataclass(frozen=True)
class SourceCapabilityPartition:
    system: SystemConfiguration
    unavailable: dict[SourceIdentity, tuple[str, set[ProviderQuotaType]]]
    unavailable_reasons: dict[SourceIdentity, str] = field(default_factory=dict)


def _runtime_unavailable_sources(
    restricted: RestrictModel,
    system: SystemConfiguration,
    models: Sequence[AIModelEntity],
    supported_model_types: Sequence[ModelType],
    configured_models: frozenset[SourceIdentity],
    evidence: dict[SourceIdentity, UnavailableSourceEvidence],
) -> set[SourceIdentity]:
    """Require typed complete evidence for a runtime-only SYSTEM exclusion.

    A declared schema may legitimately be unavailable at the hosted endpoint.
    An undeclared legacy LLM placeholder is still ambiguous across supported
    types, so all possible types need evidence. Explicit deployment bindings
    and fine-tunes are never covered by this public-endpoint attestation.
    """
    if restricted.base_model_name is not None or restricted.model.startswith("ft:"):
        return set()
    candidates = _installed_restricted_schemas(restricted, models)
    if len(candidates) > 1:
        return set()
    kinds = (
        [candidates[0].model_type]
        if candidates
        else [restricted.model_type]
        if restricted.model_type != ModelType.LLM
        else supported_model_types
    )
    required = {(kind, restricted.model) for kind in kinds}
    if not required or not required <= evidence.keys():
        return set()
    runtime = [evidence[identity] for identity in required if evidence[identity].reason == "source_runtime_unavailable"]
    if not runtime or not all(item.matches_system_endpoint(system.credentials) for item in runtime):
        return set()
    # A BYOK model row cannot disprove an exact SYSTEM runtime restriction.
    # But a configured dynamic identity must not be hidden by schema-negative
    # evidence for that identity or an unrelated type.
    if any(
        model == restricted.model
        and ((kind, model) not in required or evidence[(kind, model)].reason != "source_runtime_unavailable")
        for kind, model in configured_models
    ):
        return set()
    return required


def partition_known_unavailable_sources(
    system: SystemConfiguration,
    models: Sequence[AIModelEntity],
    original_methods: Sequence[ConfigurateMethod],
    supported_model_types: Sequence[ModelType],
    configured_models: frozenset[SourceIdentity],
    evidence: SourceCapabilityDeclaration | None,
) -> SourceCapabilityPartition:
    """Exclude only attested impossible SYSTEM sources; never discovery errors.

    Unknown package/catalog evidence and dynamic overrides keep ordinary strict
    lookup. A legacy LLM placeholder requires negative evidence for *all*
    supported types; otherwise an existing dynamic non-LLM could be hidden.
    Runtime exclusions additionally require their reviewed public endpoint
    predicate. They may have a positive schema and never mutate BYOK settings.
    """
    unchanged = SourceCapabilityPartition(system, {})
    if evidence is None or ConfigurateMethod.PREDEFINED_MODEL not in original_methods:
        return unchanged
    digest = source_catalog_digest(models, original_methods, supported_model_types)
    if (
        digest != evidence.catalog_digest
        or set(original_methods) != set(evidence.original_configurate_methods)
        or set(supported_model_types) != set(evidence.supported_model_types)
    ):
        return unchanged
    negatives = {(item.model_type, item.model): item for item in evidence.unavailable}
    schema_negatives = {identity for identity, item in negatives.items() if item.reason == "source_schema_unsupported"}
    if schema_negatives & {(schema.model_type, schema.model) for schema in models}:
        raise ValueError("Negative capability contradicts a declared source model")
    unavailable: dict[SourceIdentity, tuple[str, set[ProviderQuotaType]]] = {}
    unavailable_reasons: dict[SourceIdentity, str] = {}
    quotas: list[QuotaConfiguration] = []
    for quota in system.quota_configurations:
        if (
            quota.quota_type not in {ProviderQuotaType.PAID, ProviderQuotaType.TRIAL}
            or quota.quota_limit == -1
            or quota.quota_unit not in {QuotaUnit.TIMES, QuotaUnit.CREDITS}
            or not quota.restrict_models
        ):
            quotas.append(quota)
            continue
        retained = []
        for restricted in quota.restrict_models:
            runtime_unavailable = _runtime_unavailable_sources(
                restricted, system, models, supported_model_types, configured_models, negatives
            )
            if runtime_unavailable:
                for identity in runtime_unavailable:
                    _, pools = unavailable.setdefault(identity, (negatives[identity].proof_id, set()))
                    pools.add(quota.quota_type)
                    unavailable_reasons[identity] = negatives[identity].reason
                continue
            if (
                restricted.base_model_name is not None
                or restricted.model.startswith("ft:")
                or any(model == restricted.model for _, model in configured_models)
                or any(schema.model == restricted.model for schema in models)
            ):
                retained.append(restricted)
                continue
            types = [restricted.model_type] if restricted.model_type != ModelType.LLM else supported_model_types
            required = {(kind, restricted.model) for kind in types}
            if not required or not required <= schema_negatives:
                retained.append(restricted)
                continue
            for identity in required:
                _, pools = unavailable.setdefault(identity, (negatives[identity].proof_id, set()))
                pools.add(quota.quota_type)
                unavailable_reasons[identity] = negatives[identity].reason
        if retained:
            quotas.append(quota.model_copy(update={"restrict_models": retained}))
        # All restrictions proved absent: omit this inventory-only quota; an
        # empty restriction list would incorrectly mean unrestricted access.
    return SourceCapabilityPartition(
        system.model_copy(update={"quota_configurations": quotas}), unavailable, unavailable_reasons
    )


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
