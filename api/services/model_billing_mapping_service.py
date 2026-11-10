"""Resolve migration mappings and source schemas without changing hosted policy.

The registry is an append-only collection of immutable revisions. Callers must
select their migration's exact revision; neither list order nor a newer revision
can change the target of an already prepared or active migration.
"""

import hashlib
import json
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal, cast

from packaging.version import InvalidVersion, Version

from core.entities.provider_entities import (
    HostedAudioSourceFact,
    HostedEmbeddingSourceFact,
    HostedGeminiSourceFact,
    HostedSourceVariantFact,
    HostedTongyiSourceFact,
    HostedXAISourceFact,
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
from services.entities.model_billing_audio_mapping import AudioSourceSettings, SourceAudioVariantMapping
from services.entities.model_billing_audio_mapping import SelectedAudioSourceVariant as SelectedAudioSourceVariant  # noqa: PLC0414
from services.entities.model_billing_embedding_mapping import EmbeddingSourceSettings, SourceEmbeddingVariantMapping
from services.entities.model_billing_embedding_mapping import (
    SelectedEmbeddingSourceVariant as SelectedEmbeddingSourceVariant,  # noqa: PLC0414
)
from services.entities.model_billing_gemini_mapping import (
    GEMINI_SOURCE_UID,
    GeminiSourceSettings,
    SourceGeminiVariantMapping,
    gemini_source_operations,
)
from services.entities.model_billing_gemini_mapping import SelectedGeminiSourceVariant as SelectedGeminiSourceVariant  # noqa: PLC0414
from services.entities.model_billing_gemini_v8_mapping import GEMINI_0913_SOURCE_UID, SourceGeminiV8VariantMapping
from services.entities.model_billing_gemini_v8_mapping import (
    SelectedGeminiV8SourceVariant as SelectedGeminiV8SourceVariant,  # noqa: PLC0414
)
from services.entities.model_billing_mapping import ModelMapping, SourceVariantSettings
from services.entities.model_billing_mapping import SelectedSourceVariant as SelectedSourceVariant  # noqa: PLC0414
from services.entities.model_billing_mapping import SourceParameterContract as SourceParameterContract  # noqa: PLC0414
from services.entities.model_billing_mapping import model_schema_digest as model_schema_digest  # noqa: PLC0414
from services.entities.model_billing_migration import StableMigrationSourceProviderOwnership
from services.entities.model_billing_tongyi_mapping import (
    TONGYI_SOURCE_UID,
    SourceTongyiVariantMapping,
    TongyiSourceSettings,
    tongyi_source_operations,
)
from services.entities.model_billing_tongyi_mapping import SelectedTongyiSourceVariant as SelectedTongyiSourceVariant  # noqa: PLC0414
from services.entities.model_billing_xai_mapping import SelectedXAISourceVariant as SelectedXAISourceVariant  # noqa: PLC0414
from services.entities.model_billing_xai_mapping import SourceXAIVariantMapping, XAISourceSettings
from services.model_billing_anthropic_adapter import AnthropicSourceContract as AnthropicSourceContract  # noqa: PLC0414
from services.model_billing_anthropic_adapter import anthropic_source_marker as anthropic_source_marker  # noqa: PLC0414
from services.model_billing_anthropic_adapter import build_anthropic_source_contract
from services.model_billing_anthropic_adapter import (
    restore_anthropic_source_contract as restore_anthropic_source_contract,  # noqa: PLC0414
)
from services.model_billing_gemini_credit_source_adapter import (
    GeminiCreditSourceContract,
    build_gemini_credit_source_contract,
    gemini_credit_source_marker,
    restore_gemini_credit_source_contract,
)
from services.model_billing_gemini_credit_source_v2_adapter import GeminiCreditSourceV2Contract
from services.model_billing_gemini_credit_source_v2_adapter import (
    build_gemini_credit_source_contract as build_gemini_credit_v2_source_contract,
)
from services.model_billing_gemini_credit_source_v2_adapter import (
    gemini_credit_source_marker as gemini_credit_v2_source_marker,
)
from services.model_billing_gemini_credit_source_v2_adapter import (
    restore_gemini_credit_source_contract as restore_gemini_credit_v2_source_contract,
)
from services.model_billing_migration_inventory import saved_dependency_inventory_policy
from services.model_billing_openai_audio_adapter import (
    OPENAI_AUDIO_SOURCE_UIDS,
    OpenAIAudioSourceContract,
    SourceAudioSettings,
    build_openai_audio_source_contract,
    openai_audio_source_marker,
    restore_openai_audio_source_contract,
)
from services.model_billing_openai_chat_adapter import (
    OpenAIChatSourceContract,
    build_openai_chat_source_contract,
    openai_chat_source_marker,
    restore_openai_chat_source_contract,
)
from services.model_billing_openai_credit_llm_adapter import (
    OpenAICreditLLMSourceContract,
    build_openai_credit_llm_source_contract,
    openai_credit_llm_source_marker,
    restore_openai_credit_llm_source_contract,
)
from services.model_billing_openai_credit_llm_v2_adapter import (
    OpenAICreditLLMSourceV2Contract,
)
from services.model_billing_openai_credit_llm_v2_adapter import (
    build_openai_credit_llm_source_contract as build_openai_credit_llm_v2_source_contract,
)
from services.model_billing_openai_credit_llm_v2_adapter import (
    openai_credit_llm_source_marker as openai_credit_llm_v2_source_marker,
)
from services.model_billing_openai_credit_llm_v2_adapter import (
    restore_openai_credit_llm_source_contract as restore_openai_credit_llm_v2_source_contract,
)
from services.model_billing_openai_embedding_adapter import (
    OPENAI_EMBEDDING_SOURCE_UIDS,
    OpenAIEmbeddingSourceContract,
    OpenAIEmbeddingSourceSettings,
    build_openai_embedding_source_contract,
    openai_embedding_source_marker,
    restore_openai_embedding_source_contract,
)
from services.model_billing_openai_provider042_adapter import (
    OpenAI042SourceSettings,
    OpenAIProvider042SourceContract,
    build_openai_provider042_source_contract,
    openai_provider042_source_marker,
    restore_openai_provider042_source_contract,
)
from services.model_billing_openai_provider110_adapter import (
    OpenAI110SourceSettings,
    OpenAIProvider110SourceContract,
    build_openai_provider110_source_contract,
    openai_provider110_source_marker,
    restore_openai_provider110_source_contract,
)
from services.model_billing_retirement_policy import ModelRetirementPolicy, resolve_retirement_policy
from services.model_billing_source_capability_policy import SourceCapabilityDeclaration, UnavailableSourceEvidence
from services.model_billing_source_capability_policy import (
    resolve_source_capability_policy as resolve_source_capability_policy,  # noqa: PLC0414
)
from services.model_billing_source_variants import SELECTED_SOURCE_VARIANT_TYPES as SELECTED_SOURCE_VARIANT_TYPES  # noqa: PLC0414
from services.model_billing_source_variants import (
    AudioSourceVariantContext,
    EmbeddingSourceVariantContext,
    GeminiSourceVariantContext,
    GeminiV8SourceVariantContext,
    MappingDeclaration,
    ModelMappingRevision,
    SelectedModelMapping,
    SelectedSourceVariantMapping,
    SourceContext,
    SourceVariantContext,
    TongyiSourceVariantContext,
    XAISourceVariantContext,
    source_endpoint_class,
)
from services.model_billing_source_variants import source_mapping_revision as parse_source_mapping_revision
from services.model_billing_tongyi_credit_source_adapter import (
    TongyiCreditSourceContract,
    build_tongyi_credit_source_contract,
    restore_tongyi_credit_source_contract,
    tongyi_credit_source_marker,
)
from services.model_billing_tts_adapter import TTSVoiceContract as TTSVoiceContract  # noqa: PLC0414
from services.model_billing_tts_adapter import build_tts_voice_contract as build_tts_voice_contract  # noqa: PLC0414
from services.model_billing_tts_adapter import normalize_tts_voice as normalize_tts_voice  # noqa: PLC0414
from services.model_billing_xai_credit_source_adapter import (
    XAI_CREDIT_SOURCE_UID,
    XAICreditSourceContract,
    XAICreditSourceSettings,
    build_xai_credit_source_contract,
    restore_xai_credit_source_contract,
    xai_credit_source_marker,
)

type SourceIdentity = tuple[ModelType, str]
type MappingIdentity = tuple[str, ModelType, str]
type SchemaLookup = Callable[[ModelType, str, dict[str, Any]], AIModelEntity | None]


def _xai_factory_settings(settings: XAISourceSettings) -> XAICreditSourceSettings:
    """One closed boundary from V5 financial-safe facts to the frozen policy.

    Registry/current/selection/cache inventories carry the explicit not_used
    string. Only the exact pure source factory consumes its original None; this
    never relaxes the shared canonical hash's prohibition on null/float values.
    """
    if type(settings) is not XAISourceSettings or settings.protocol_selector != "not_used":
        raise ValueError("Invalid xAI source selector behavior")
    return XAICreditSourceSettings(
        source_base_is_set=settings.source_base_is_set,
        request_metadata_enabled=settings.request_metadata_enabled,
        protocol_selector=None,
    )


def build_source_adapter_contract(
    mapping: SelectedModelMapping,
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
    if isinstance(mapping, SelectedTongyiSourceVariant):
        tongyi_contract = build_tongyi_credit_source_contract(
            **arguments,
            source_schema=source_schema,
            expected_source_runtime_schema_digest=mapping.variant.source_runtime_schema_digest,
            target_model=mapping.target.model,
            source_settings=mapping.variant.source_settings,
        )
        if tongyi_contract != restore_variant_source_contract(mapping):
            raise ValueError("Tongyi source variant evidence changed")
        return tongyi_contract
    if isinstance(mapping, SelectedGeminiV8SourceVariant):
        build_gemini_v8 = (
            build_gemini_credit_v2_source_contract
            if mapping.variant.source_plugin_uid == GEMINI_0913_SOURCE_UID
            else build_gemini_credit_source_contract
        )
        gemini_v8_contract = build_gemini_v8(
            **arguments,
            source_schema=source_schema,
            expected_source_runtime_schema_digest=mapping.variant.source_runtime_schema_digest,
            target_model=mapping.target.model,
            source_settings=mapping.variant.source_settings,
        )
        if gemini_v8_contract != restore_variant_source_contract(mapping):
            raise ValueError("V8 Gemini source variant evidence changed")
        return gemini_v8_contract
    if isinstance(mapping, SelectedGeminiSourceVariant):
        gemini_contract = build_gemini_credit_source_contract(
            **arguments,
            source_schema=source_schema,
            expected_source_runtime_schema_digest=mapping.variant.source_runtime_schema_digest,
            target_model=mapping.target.model,
            source_settings=mapping.variant.source_settings,
        )
        if gemini_contract != restore_variant_source_contract(mapping):
            raise ValueError("Gemini source variant evidence changed")
        return gemini_contract
    if isinstance(mapping, SelectedAudioSourceVariant):
        audio_contract = build_openai_audio_source_contract(
            **arguments,
            source_schema=source_schema,
            expected_source_runtime_schema_digest=mapping.variant.source_runtime_schema_digest,
            target_model=mapping.target.model,
            source_settings=SourceAudioSettings(**mapping.variant.source_settings.model_dump()),
        )
        if audio_contract != restore_variant_source_contract(mapping):
            raise ValueError("Audio source variant evidence changed")
        return audio_contract
    if isinstance(mapping, SelectedXAISourceVariant):
        xai_contract = build_xai_credit_source_contract(
            **arguments,
            source_schema=source_schema,
            expected_source_runtime_schema_digest=mapping.variant.source_runtime_schema_digest,
            target_model=mapping.target.model,
            source_settings=_xai_factory_settings(mapping.variant.source_settings),
            source_endpoint_class=mapping.variant.source_endpoint_class,
        )
        if xai_contract != restore_variant_source_contract(mapping):
            raise ValueError("xAI source variant evidence changed")
        return xai_contract
    if isinstance(mapping, SelectedEmbeddingSourceVariant):
        embedding_contract = build_openai_embedding_source_contract(
            **arguments,
            source_schema=source_schema,
            target_model=mapping.target.model,
            source_settings=OpenAIEmbeddingSourceSettings(
                source_endpoint_class=mapping.variant.source_settings.source_endpoint_class,
                request_metadata_behavior=mapping.variant.source_settings.request_metadata_behavior,
            ),
        )
        if embedding_contract != restore_variant_source_contract(mapping):
            raise ValueError("Embedding source variant evidence changed")
        return embedding_contract
    if isinstance(mapping, SelectedSourceVariant):
        settings = mapping.variant.source_settings
        contract: SourceParameterContract
        if mapping.parameter_adapter.id == "openai_credit_llm_source_v2":
            contract = build_openai_credit_llm_v2_source_contract(
                **arguments,
                source_schema=source_schema,
                expected_source_runtime_schema_digest=mapping.variant.source_runtime_schema_digest,
                target_model=mapping.target.model,
                source_settings=settings,
                source_endpoint_class="official_root" if settings.source_base_is_set else "unset",
            )
        elif mapping.parameter_adapter.id == "openai_credit_llm_source_v1":
            contract = build_openai_credit_llm_source_contract(
                **arguments,
                source_schema=source_schema,
                expected_source_runtime_schema_digest=mapping.variant.source_runtime_schema_digest,
                target_model=mapping.target.model,
                source_settings=settings,
                source_endpoint_class="official_root" if settings.source_base_is_set else "unset",
            )
        elif mapping.parameter_adapter.id == "openai_provider042_source_v1":
            contract = build_openai_provider042_source_contract(
                **arguments,
                source_schema=source_schema,
                target_model=mapping.target.model,
                source_settings=OpenAI042SourceSettings(
                    protocol_selector=settings.protocol_selector,
                    source_base_is_set=settings.source_base_is_set,
                    request_metadata_enabled=settings.request_metadata_enabled,
                ),
            )
        elif mapping.parameter_adapter.id == "openai_provider110_source_v1":
            contract = build_openai_provider110_source_contract(
                **arguments,
                source_schema=source_schema,
                target_model=mapping.target.model,
                source_settings=OpenAI110SourceSettings(
                    protocol_selector=settings.protocol_selector,
                    source_base_is_set=settings.source_base_is_set,
                    request_metadata_enabled=settings.request_metadata_enabled,
                ),
            )
        else:
            contract = build_openai_chat_source_contract(
                **arguments,
                source_schema=source_schema,
                target_model=mapping.target.model,
                source_api_protocol=None if settings.protocol_selector == "absent" else settings.protocol_selector,
                source_endpoint_class="official_root" if settings.source_base_is_set else "unset",
            )
        if contract != restore_variant_source_contract(mapping):
            raise ValueError("Source variant evidence changed")
        return contract
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
    if isinstance(contract, TongyiCreditSourceContract):
        return tongyi_credit_source_marker(contract, **arguments, model_type=model_type)
    if isinstance(contract, GeminiCreditSourceV2Contract):
        return gemini_credit_v2_source_marker(contract, **arguments, model_type=model_type)
    if isinstance(contract, GeminiCreditSourceContract):
        return gemini_credit_source_marker(contract, **arguments, model_type=model_type)
    if isinstance(contract, OpenAIAudioSourceContract):
        return openai_audio_source_marker(contract, **arguments, model_type=model_type)
    if isinstance(contract, XAICreditSourceContract):
        return xai_credit_source_marker(contract, **arguments, model_type=model_type)
    if isinstance(contract, OpenAIChatSourceContract):
        return openai_chat_source_marker(contract, **arguments, model_type=model_type)
    if isinstance(contract, OpenAICreditLLMSourceContract):
        return openai_credit_llm_source_marker(contract, **arguments, model_type=model_type)
    if isinstance(contract, OpenAICreditLLMSourceV2Contract):
        return openai_credit_llm_v2_source_marker(contract, **arguments, model_type=model_type)
    if isinstance(contract, OpenAIProvider042SourceContract):
        return openai_provider042_source_marker(contract, **arguments, model_type=model_type)
    if isinstance(contract, OpenAIEmbeddingSourceContract):
        return openai_embedding_source_marker(contract, **arguments, model_type=model_type)
    if isinstance(contract, OpenAIProvider110SourceContract):
        return openai_provider110_source_marker(contract, **arguments, model_type=model_type)
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


def uses_stable_dependency_inventory(raw_policy: str, state: dict[str, Any] | None) -> bool:
    """Exact revision dispatch for v2-only preservation; no runtime/root lookup."""
    revision = state.get("model_mapping_version") if state else None
    return (
        isinstance(revision, str)
        and saved_dependency_inventory_policy(raw_policy, revision) == "saved_system_dependencies_v2"
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
    if isinstance(record, dict) and "schema_version" in record:
        try:
            StableMigrationSourceProviderOwnership.model_validate(record)
        except ValueError:
            raise ValueError("Invalid stable source ownership") from None
        return
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
    *, system: SystemConfiguration, installed_models: Sequence[AIModelEntity], mapping: SelectedModelMapping
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


def source_schema_matches_mapping(schema: AIModelEntity, mapping: SelectedModelMapping) -> bool:
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
    mapping: SelectedModelMapping
    # None preserves original provider credentials, rather than inventing a deployment.
    base_model_name: str | None


def mapped_dynamic_source_candidates(
    *,
    provider: ProviderEntity,
    hosting: HostingProvider,
    raw_registry: str,
    revision: str,
    source_fact: HostedSourceVariantFact | None = None,
    embedding_source_fact: HostedEmbeddingSourceFact | None = None,
    audio_source_fact: HostedAudioSourceFact | None = None,
    xai_source_fact: HostedXAISourceFact | None = None,
    gemini_source_fact: HostedGeminiSourceFact | None = None,
    tongyi_source_fact: HostedTongyiSourceFact | None = None,
    allow_source_variants: bool = False,
) -> tuple[HostedSourceSchemaCandidate, ...]:
    """Plan bounded source lookups; this policy never performs RPC or inference."""
    if (
        not hosting.enabled
        or hosting.quota_unit not in {QuotaUnit.CREDITS, QuotaUnit.TIMES}
        or ConfigurateMethod.CUSTOMIZABLE_MODEL not in provider.configurate_methods
    ):
        return ()
    try:
        registry = source_mapping_revision(raw_registry, revision)
        if registry.has_variants and not allow_source_variants:
            return ()
    except ValueError:
        return ()
    installed = {(schema.model_type, schema.model) for schema in provider.models}
    candidates = []
    for provider_id, kind, model in registry.declarations:
        try:
            rule = resolve_source_mapping(
                registry,
                (provider_id, kind, model),
                source_uid=getattr(provider, "plugin_unique_identifier", ""),
                fact=source_fact,
                embedding_fact=embedding_source_fact,
                audio_fact=audio_source_fact,
                xai_fact=xai_source_fact,
                gemini_fact=gemini_source_fact,
                tongyi_fact=tongyi_source_fact,
            )
        except ValueError:
            continue
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


def mapping_has_required_operations(mapping: SelectedModelMapping) -> bool:
    if isinstance(mapping, SelectedTongyiSourceVariant):
        return set(mapping.operations) == tongyi_source_operations(mapping.source.model)
    if isinstance(mapping, (SelectedGeminiSourceVariant, SelectedGeminiV8SourceVariant)):
        return set(mapping.operations) == gemini_source_operations(mapping.source.model)
    required = {"model/schema", f"{mapping.source.model_type.value}/invoke"}
    if mapping.source.model_type == ModelType.LLM:
        required.add("llm/num_tokens")
    elif mapping.source.model_type == ModelType.TEXT_EMBEDDING:
        # ModelType uses hyphens, while daemon operations use underscores.
        required = {"model/schema", "text_embedding/invoke", "text_embedding/num_tokens"}
    elif isinstance(mapping, SelectedAudioSourceVariant) and mapping.source.model_type is ModelType.TTS:
        required.add("tts/model/voices")
    return required <= set(mapping.operations)


def mapping_supports_installed_plugin(mapping: SelectedModelMapping, plugin_unique_identifier: str) -> bool:
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
    if isinstance(record, dict) and record.get("schema_version") == 2:
        result = stable_owned_quotas(provider, quotas, state)
        return result, first_valid_independent_quota(result)
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


def first_valid_independent_quota(quotas: Sequence[QuotaConfiguration]) -> ProviderQuotaType | None:
    """FREE, unlimited and non-credit-unit owners keep original settlement."""
    return next(
        (
            kind
            for kind in (ProviderQuotaType.PAID, ProviderQuotaType.FREE, ProviderQuotaType.TRIAL)
            if any(
                quota.quota_type == kind
                and quota.is_valid
                and (
                    kind == ProviderQuotaType.FREE
                    or quota.quota_limit == -1
                    or quota.quota_unit not in {QuotaUnit.CREDITS, QuotaUnit.TIMES}
                )
                for quota in quotas
            )
        ),
        None,
    )


def stable_owned_quotas(
    provider: str, quotas: Sequence[QuotaConfiguration], state: dict[str, Any]
) -> list[QuotaConfiguration]:
    """Apply explicit v2 structural provenance without freezing consumption.

    Shared finite metadata is closed only by the existing compatibility caller.
    Independent FREE/non-credit live limit/usage and original unlimited authority
    remain on their original backend, not rewritten into a managed paid owner.
    """
    validate_prepared_provider_provenance(provider, state)
    raw = state["source_ownership"].get(str(ModelProviderID(provider)))
    if not isinstance(raw, dict) or raw.get("schema_version") != 2:
        raise ValueError("Stable source ownership required")
    record = StableMigrationSourceProviderOwnership.model_validate(raw)
    present = {quota.quota_type.value for quota in quotas}
    if any(structure.unmetered and kind not in present for kind, structure in record.quotas.items()):
        raise ValueError("Original unlimited source quota is missing")
    result: list[QuotaConfiguration] = []
    for original in quotas:
        structure = record.quotas.get(cast(Literal["paid", "trial", "free"], original.quota_type.value))
        if structure is None or structure.unit != original.quota_unit.value:
            raise ValueError("Source quota structure changed")
        quota = original.model_copy(deep=True)
        if quota.quota_type != ProviderQuotaType.FREE and quota.quota_unit in {QuotaUnit.CREDITS, QuotaUnit.TIMES}:
            quota.quota_limit = -1 if structure.unmetered else 0
            quota.quota_used = 0
            quota.is_valid = structure.unmetered
        elif (quota.quota_limit == -1) != structure.unmetered:
            raise ValueError("Independent quota structure changed")
        else:
            quota.is_valid = quota.quota_limit == -1 or quota.quota_limit > quota.quota_used
        result.append(quota)
    return result


def stable_compatibility_quota_type(
    provider: str, quotas: list[QuotaConfiguration], state: dict[str, Any]
) -> ProviderQuotaType:
    """Versioned selection adapter; old Core consumes no new DTO dependency."""
    quotas[:] = stable_owned_quotas(provider, quotas, state)
    record = StableMigrationSourceProviderOwnership.model_validate(
        state["source_ownership"][str(ModelProviderID(provider))]
    )
    independent = first_valid_independent_quota(quotas)
    if independent is not None:
        return independent
    for pool in record.shared_pool_types:
        selected = ProviderQuotaType(pool)
        if any(quota.quota_type == selected and quota.quota_limit != -1 for quota in quotas):
            return selected
    independent_quotas = [
        quota
        for quota in quotas
        if quota.quota_type == ProviderQuotaType.FREE
        or quota.quota_limit == -1
        or quota.quota_unit not in {QuotaUnit.CREDITS, QuotaUnit.TIMES}
    ]
    if not record.shared_pool_types and independent_quotas:
        # Exhaustion stays with the original source quota, never a new charge.
        return next(
            kind
            for kind in (ProviderQuotaType.PAID, ProviderQuotaType.FREE, ProviderQuotaType.TRIAL)
            if any(quota.quota_type == kind for quota in independent_quotas)
        )
    raise ValueError("Missing stable shared source pool")


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
    preserve_independent_units: bool = False,
    source_uid: str = "",
    source_fact: HostedSourceVariantFact | None = None,
    embedding_source_fact: HostedEmbeddingSourceFact | None = None,
    audio_source_fact: HostedAudioSourceFact | None = None,
    xai_source_fact: HostedXAISourceFact | None = None,
    gemini_source_fact: HostedGeminiSourceFact | None = None,
    tongyi_source_fact: HostedTongyiSourceFact | None = None,
    allow_source_variants: bool = False,
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
        if quota.quota_type == ProviderQuotaType.FREE
        or quota.quota_limit == -1
        or preserve_independent_units
        and quota.quota_unit not in {QuotaUnit.CREDITS, QuotaUnit.TIMES}
    ]
    try:
        registry = source_mapping_revision(raw_registry, revision)
        if registry.has_variants and not allow_source_variants:
            registry = None
    except ValueError:
        registry = None
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
                try:
                    rule = (
                        resolve_source_mapping(
                            registry,
                            (provider_id, schema.model_type, schema.model),
                            source_uid=source_uid,
                            fact=source_fact,
                            embedding_fact=embedding_source_fact,
                            audio_fact=audio_source_fact,
                            xai_fact=xai_source_fact,
                            gemini_fact=gemini_source_fact,
                            tongyi_fact=tongyi_source_fact,
                            schema=schema,
                        )
                        if registry is not None
                        else None
                    )
                except ValueError:
                    # SYSTEM is constructed before choosing CUSTOM. A bad
                    # managed variant may close only its shared availability,
                    # never an unrelated independent/BYOK configuration.
                    rule = None
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
            if quota.quota_type in {ProviderQuotaType.PAID, ProviderQuotaType.TRIAL}
            and quota.quota_limit != -1
            and (not preserve_independent_units or quota.quota_unit in {QuotaUnit.CREDITS, QuotaUnit.TIMES})
            for restricted in quota.restrict_models
        }
        for quota in quotas:
            if (
                quota.quota_type in {ProviderQuotaType.PAID, ProviderQuotaType.TRIAL}
                and quota.quota_limit != -1
                and (not preserve_independent_units or quota.quota_unit in {QuotaUnit.CREDITS, QuotaUnit.TIMES})
            ):
                quota.restrict_models = [union[identity] for identity in sorted(union)]
        if preserve_independent_pool is not None and any(
            quota.quota_type == preserve_independent_pool
            and quota.is_valid
            and (
                quota.quota_type == ProviderQuotaType.FREE
                or quota.quota_limit == -1
                or preserve_independent_units
                and quota.quota_unit not in {QuotaUnit.CREDITS, QuotaUnit.TIMES}
            )
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
        if any(
            quota.quota_type == pool_type
            and quota.quota_limit != -1
            and (not preserve_independent_units or quota.quota_unit in {QuotaUnit.CREDITS, QuotaUnit.TIMES})
            for quota in quotas
        ):
            return HostedCompatibilityAvailability(quotas, pool_type)
    if preserve_independent_units and quotas and not has_finite_hosted_credit_pool(hosting):
        # Exhaustion without any managed fallback remains an ordinary original
        # quota state. It must not manufacture a Tokener settlement owner.
        selected = next(
            kind
            for kind in (ProviderQuotaType.PAID, ProviderQuotaType.FREE, ProviderQuotaType.TRIAL)
            if any(quota.quota_type == kind for quota in quotas)
        )
        return HostedCompatibilityAvailability(quotas, selected)
    return None


def source_mapping_revision(raw_registry: str, revision: str) -> ModelMappingRevision:
    """Keep provider alias/framework adaptation outside the pure registry."""
    return parse_source_mapping_revision(
        raw_registry, revision, normalize_provider=lambda value: str(ModelProviderID(value))
    )


def mappings_for_revision(raw_registry: str, revision: str) -> dict[MappingIdentity, ModelMapping]:
    """Validate every revision, then select exactly one; no implicit latest."""
    registry = source_mapping_revision(raw_registry, revision)
    if registry.has_variants:
        raise ValueError("Source variants require explicit saved dependency policy")
    return {key: item for key, item in registry.declarations.items() if isinstance(item, ModelMapping)}


def hosted_embedding_source_fact(
    *, provider: str, source_uid: str, models: Sequence[AIModelEntity], credentials: object
) -> HostedEmbeddingSourceFact | None:
    """Capture only actual SYSTEM embedding facts, without LLM flag inference.

    api_protocol and enable_request_metadata are intentionally never read:
    exact042/110 embedding methods ignore both, proved through the real source
    SDK's schema/request/result boundary. This function never edits the original
    dictionary, invents a raw False flag or retains credential/URL values.
    """
    if (
        str(ModelProviderID(provider)) != "langgenius/openai/openai"
        or type(source_uid) is not str
        or source_uid not in OPENAI_EMBEDDING_SOURCE_UIDS
        or not isinstance(credentials, dict)
    ):
        return None
    return HostedEmbeddingSourceFact(
        provider=str(ModelProviderID(provider)),
        plugin_unique_identifier=source_uid,
        catalog_schema_digests=tuple(
            (item.model_type, item.model, model_schema_digest(item))
            for item in models
            if item.model_type == ModelType.TEXT_EMBEDDING
        ),
        source_endpoint_class=source_endpoint_class(source_uid, credentials.get("openai_api_base")),
        request_metadata_behavior="not_used",
    )


def hosted_audio_source_fact(
    *, provider: str, source_uid: str, models: Sequence[AIModelEntity], credentials: object
) -> HostedAudioSourceFact | None:
    """Exact042/110 audio ignores both raw flags, including their absent state.

    This is positive source implementation behavior from an actual SYSTEM dict,
    not a false raw flag or a source URL/key retained for the managed request.
    """
    if (
        str(ModelProviderID(provider)) != "langgenius/openai/openai"
        or source_uid not in OPENAI_AUDIO_SOURCE_UIDS.values()
        or not isinstance(credentials, dict)
    ):
        return None
    return HostedAudioSourceFact(
        provider=str(ModelProviderID(provider)),
        plugin_unique_identifier=source_uid,
        catalog_schema_digests=tuple(
            (item.model_type, item.model, model_schema_digest(item))
            for item in models
            if item.model_type in {ModelType.TTS, ModelType.SPEECH2TEXT}
        ),
        source_endpoint_class=source_endpoint_class(source_uid, credentials.get("openai_api_base")),
        api_protocol_behavior="not_used",
        request_metadata_behavior="not_used",
    )


def hosted_xai_source_fact(
    *, provider: str, source_uid: str, models: Sequence[AIModelEntity], credentials: object
) -> HostedXAISourceFact | None:
    """Only exact x027 SYSTEM credentials can attest its finite source settings.

    The source has no protocol/metadata credential fields. Do not manufacture
    an OpenAI raw flag or propagate unknown credential configuration here.
    Its official endpoint must be the actual exact /v1 literal, not truthiness.
    """
    if (
        str(ModelProviderID(provider)) != "langgenius/x/x"
        or source_uid != XAI_CREDIT_SOURCE_UID
        or not isinstance(credentials, dict)
        or set(credentials) - {"api_key", "endpoint_url", "model"}
    ):
        return None
    base = credentials.get("endpoint_url")
    endpoint: Literal["unset", "official_root", "unreviewed"] = "unreviewed"
    if base is None or type(base) is str and base == "":
        endpoint = "unset"
    elif type(base) is str and base == "https://api.x.ai/v1":
        endpoint = "official_root"
    return HostedXAISourceFact(
        provider=str(ModelProviderID(provider)),
        plugin_unique_identifier=source_uid,
        catalog_schema_digests=tuple(
            (item.model_type, item.model, model_schema_digest(item))
            for item in models
            if item.model_type is ModelType.LLM
        ),
        source_endpoint_class=endpoint,
        source_base_is_set=bool(base),
        request_metadata_enabled=False,
        protocol_selector="not_used",
    )


def audio_source_variant_context(
    fact: HostedAudioSourceFact | None, *, provider: str, source_uid: str, schema: AIModelEntity | None = None
) -> AudioSourceVariantContext | None:
    if (
        type(fact) is not HostedAudioSourceFact
        or fact.provider != str(ModelProviderID(provider))
        or fact.plugin_unique_identifier != source_uid
        or fact.source_endpoint_class not in {"unset", "official_root"}
        or fact.api_protocol_behavior != "not_used"
        or fact.request_metadata_behavior != "not_used"
    ):
        return None
    if schema is not None and [
        digest
        for kind, model, digest in fact.catalog_schema_digests
        if (kind, model) == (schema.model_type, schema.model)
    ] != [model_schema_digest(schema)]:
        return None
    return AudioSourceVariantContext(
        source_uid,
        AudioSourceSettings(
            source_endpoint_class=fact.source_endpoint_class,
            api_protocol_behavior=fact.api_protocol_behavior,
            request_metadata_behavior=fact.request_metadata_behavior,
        ),
    )


def xai_source_variant_context(
    fact: HostedXAISourceFact | None, *, provider: str, source_uid: str, schema: AIModelEntity | None = None
) -> XAISourceVariantContext | None:
    if (
        type(fact) is not HostedXAISourceFact
        or fact.provider != str(ModelProviderID(provider))
        or fact.plugin_unique_identifier != source_uid
        or fact.source_endpoint_class != "official_root"
        or fact.source_base_is_set is not True
        or fact.request_metadata_enabled is not False
        or fact.protocol_selector != "not_used"
    ):
        return None
    if schema is not None and [
        digest
        for kind, model, digest in fact.catalog_schema_digests
        if (kind, model) == (schema.model_type, schema.model)
    ] != [model_schema_digest(schema)]:
        return None
    return XAISourceVariantContext(
        source_uid,
        XAISourceSettings(source_base_is_set=True, request_metadata_enabled=False, protocol_selector="not_used"),
        "official_root",
    )


def hosted_tongyi_source_fact(
    *, provider: str, source_uid: str, models: Sequence[AIModelEntity], credentials: object
) -> HostedTongyiSourceFact | None:
    """Classify the actual SYSTEM dictionary before its shared key is cleared.

    Source0226 compares only the exact string ``true`` and gives custom
    normalized api_host precedence. No URL/key/dictionary is retained. LLM
    metadata absent/None or exact disabled is reviewed; other model types do
    not consume that field. None cannot become a fabricated default dict.
    """
    if (
        str(ModelProviderID(provider)) != "langgenius/tongyi/tongyi"
        or source_uid != TONGYI_SOURCE_UID
        or type(credentials) is not dict
    ):
        return None
    selector = credentials.get("use_international_endpoint")
    host = credentials.get("api_host")
    metadata = credentials.get("enable_request_metadata")
    return HostedTongyiSourceFact(
        provider=str(ModelProviderID(provider)),
        plugin_unique_identifier=source_uid,
        catalog_schema_digests=tuple((item.model_type, item.model, model_schema_digest(item)) for item in models),
        endpoint_selector="string_true"
        if type(selector) is str and selector == "true"
        else "string_false"
        if type(selector) is str and selector == "false"
        else "unreviewed",
        api_host_policy="actual_absent_or_blank"
        if host is None or type(host) is str and not host.strip()
        else "unreviewed",
        llm_metadata_policy="actual_system_disabled"
        if metadata is None or type(metadata) is str and metadata == "disabled"
        else "unreviewed",
    )


def tongyi_source_variant_context(
    fact: HostedTongyiSourceFact | None,
    *,
    provider: str,
    source_uid: str,
    model_type: ModelType,
    schema: AIModelEntity | None = None,
) -> TongyiSourceVariantContext | None:
    if (
        type(fact) is not HostedTongyiSourceFact
        or fact.provider != str(ModelProviderID(provider))
        or fact.plugin_unique_identifier != source_uid
        or source_uid != TONGYI_SOURCE_UID
        or fact.endpoint_selector != "string_true"
        or fact.api_host_policy != "actual_absent_or_blank"
        or model_type not in {ModelType.LLM, ModelType.TEXT_EMBEDDING, ModelType.RERANK}
    ):
        return None
    if schema is not None and [
        digest
        for kind, model, digest in fact.catalog_schema_digests
        if (kind, model) == (schema.model_type, schema.model)
    ] != [model_schema_digest(schema)]:
        return None
    if model_type is ModelType.LLM and fact.llm_metadata_policy != "actual_system_disabled":
        return None
    return TongyiSourceVariantContext(
        source_uid,
        TongyiSourceSettings(
            source_endpoint_policy="reviewed_shared_international_string_true",
            api_host_policy="actual_absent_or_blank",
            request_metadata_policy="actual_system_disabled" if model_type is ModelType.LLM else "not_used",
        ),
    )


def hosted_gemini_source_fact(
    *, provider: str, source_uid: str, models: Sequence[AIModelEntity], credentials: object
) -> HostedGeminiSourceFact | None:
    """Capture actual SYSTEM dictionary classifications, before substitution.

    Source0912/0913 LLMs use only the reviewed None/exact Google-root base,
    None/disabled metadata and None/empty file prefix. Embeddings do not consume
    these three fields. Nothing retains a key, raw URL or credential dictionary.
    """
    if (
        str(ModelProviderID(provider)) != "langgenius/gemini/google"
        or source_uid not in {GEMINI_SOURCE_UID, GEMINI_0913_SOURCE_UID}
        or type(credentials) is not dict
    ):
        return None
    base = credentials.get("google_base_url")
    metadata = credentials.get("enable_request_metadata")
    prefix = credentials.get("file_url")
    return HostedGeminiSourceFact(
        provider=str(ModelProviderID(provider)),
        plugin_unique_identifier=source_uid,
        catalog_schema_digests=tuple((item.model_type, item.model, model_schema_digest(item)) for item in models),
        llm_source_base_policy=(
            "unset_or_exact_google_root"
            if base is None or type(base) is str and base == "https://generativelanguage.googleapis.com"
            else "unreviewed"
        ),
        llm_request_metadata_policy=(
            "system_false_only"
            if metadata is None or type(metadata) is str and metadata == "disabled"
            else "unreviewed"
        ),
        llm_file_url_policy=(
            "actual_system_absent_or_empty_only"
            if prefix is None or type(prefix) is str and prefix == ""
            else "unreviewed"
        ),
    )


def gemini_source_variant_context(
    fact: HostedGeminiSourceFact | None,
    *,
    provider: str,
    source_uid: str,
    model_type: ModelType,
    schema: AIModelEntity | None = None,
) -> GeminiSourceVariantContext | None:
    if (
        type(fact) is not HostedGeminiSourceFact
        or fact.provider != str(ModelProviderID(provider))
        or fact.plugin_unique_identifier != source_uid
        or source_uid != GEMINI_SOURCE_UID
        or model_type not in {ModelType.LLM, ModelType.TEXT_EMBEDDING}
    ):
        return None
    if schema is not None and [
        digest
        for kind, model, digest in fact.catalog_schema_digests
        if (kind, model) == (schema.model_type, schema.model)
    ] != [model_schema_digest(schema)]:
        return None
    if model_type is ModelType.LLM:
        if (fact.llm_source_base_policy, fact.llm_request_metadata_policy, fact.llm_file_url_policy) != (
            "unset_or_exact_google_root",
            "system_false_only",
            "actual_system_absent_or_empty_only",
        ):
            return None
        settings = GeminiSourceSettings(
            source_base_policy="unset_or_exact_google_root",
            request_metadata_policy="system_false_only",
            file_url_policy="actual_system_absent_or_empty_only",
        )
    else:
        settings = GeminiSourceSettings(
            source_base_policy="not_used", request_metadata_policy="not_used", file_url_policy="not_used"
        )
    return GeminiSourceVariantContext(source_uid, settings)


def gemini_v8_source_variant_context(
    fact: HostedGeminiSourceFact | None,
    *,
    provider: str,
    source_uid: str,
    model_type: ModelType,
    schema: AIModelEntity | None = None,
) -> GeminiV8SourceVariantContext | None:
    if (
        type(fact) is not HostedGeminiSourceFact
        or fact.provider != str(ModelProviderID(provider))
        or fact.plugin_unique_identifier != source_uid
        or source_uid not in {GEMINI_SOURCE_UID, GEMINI_0913_SOURCE_UID}
        or model_type not in {ModelType.LLM, ModelType.TEXT_EMBEDDING}
    ):
        return None
    if schema is not None and [
        digest
        for kind, model, digest in fact.catalog_schema_digests
        if (kind, model) == (schema.model_type, schema.model)
    ] != [model_schema_digest(schema)]:
        return None
    if model_type is ModelType.LLM:
        if (fact.llm_source_base_policy, fact.llm_request_metadata_policy, fact.llm_file_url_policy) != (
            "unset_or_exact_google_root",
            "system_false_only",
            "actual_system_absent_or_empty_only",
        ):
            return None
        settings = GeminiSourceSettings(
            source_base_policy="unset_or_exact_google_root",
            request_metadata_policy="system_false_only",
            file_url_policy="actual_system_absent_or_empty_only",
        )
    else:
        settings = GeminiSourceSettings(
            source_base_policy="not_used", request_metadata_policy="not_used", file_url_policy="not_used"
        )
    return GeminiV8SourceVariantContext(source_uid, settings)


def hosted_source_variant_fact(
    *, provider: str, source_uid: str, models: Sequence[AIModelEntity], credentials: object
) -> HostedSourceVariantFact | None:
    """Capture derived public facts only from an actual SYSTEM dictionary."""
    if str(ModelProviderID(provider)) != "langgenius/openai/openai" or not isinstance(credentials, dict):
        return None
    protocol = credentials.get("api_protocol")
    if protocol is not None and protocol not in ("chat", "responses"):
        return None
    metadata = credentials.get("enable_request_metadata")
    if metadata is not None and (type(metadata) is not str or metadata not in {"disabled", "enabled"}):
        return None
    return HostedSourceVariantFact(
        provider=str(ModelProviderID(provider)),
        plugin_unique_identifier=source_uid,
        catalog_schema_digests=tuple((item.model_type, item.model, model_schema_digest(item)) for item in models),
        selector="absent" if protocol is None else protocol,
        source_base_is_set=bool(credentials.get("openai_api_base")),
        request_metadata_enabled=metadata == "enabled",
        source_endpoint_class=source_endpoint_class(source_uid, credentials.get("openai_api_base")),
    )


def source_variant_context(
    fact: HostedSourceVariantFact | None, *, provider: str, source_uid: str, schema: AIModelEntity | None = None
) -> SourceVariantContext | None:
    if fact is None or fact.provider != str(ModelProviderID(provider)) or fact.plugin_unique_identifier != source_uid:
        return None
    if fact.source_endpoint_class != ("official_root" if fact.source_base_is_set else "unset"):
        return None
    if schema is not None and [
        digest
        for kind, model, digest in fact.catalog_schema_digests
        if (kind, model) == (schema.model_type, schema.model)
    ] != [model_schema_digest(schema)]:
        return None
    return SourceVariantContext(
        source_uid,
        SourceVariantSettings(
            protocol_selector=fact.selector,
            source_base_is_set=fact.source_base_is_set,
            request_metadata_enabled=fact.request_metadata_enabled,
        ),
    )


def embedding_source_variant_context(
    fact: HostedEmbeddingSourceFact | None, *, provider: str, source_uid: str, schema: AIModelEntity | None = None
) -> EmbeddingSourceVariantContext | None:
    if (
        fact is None
        or fact.provider != str(ModelProviderID(provider))
        or fact.plugin_unique_identifier != source_uid
        or fact.source_endpoint_class not in {"unset", "official_root"}
        or fact.request_metadata_behavior != "not_used"
    ):
        return None
    if schema is not None and [
        digest
        for kind, model, digest in fact.catalog_schema_digests
        if (kind, model) == (schema.model_type, schema.model)
    ] != [model_schema_digest(schema)]:
        return None
    return EmbeddingSourceVariantContext(
        source_uid,
        EmbeddingSourceSettings(
            source_endpoint_class=fact.source_endpoint_class,
            request_metadata_behavior=fact.request_metadata_behavior,
        ),
    )


def restore_variant_source_contract(
    mapping: SelectedSourceVariantMapping,
) -> SourceParameterContract:
    variant = mapping.variant
    marker = {
        "schema_version": 1,
        "profile_id": variant.source_profile_id,
        "source_plugin_uid": variant.source_plugin_uid,
        "source_model": mapping.source.model,
        "source_schema_digest": variant.source_schema_digest,
        "rules_digest": variant.parameter_adapter.rules_digest,
    }
    arguments = {
        "source_provider": str(ModelProviderID(mapping.source.provider_id)),
        "source_model": mapping.source.model,
        "model_type": mapping.source.model_type,
        "target_model": mapping.target.model,
    }
    if isinstance(mapping, SelectedTongyiSourceVariant):
        return restore_tongyi_credit_source_contract(
            marker,
            **arguments,
            source_settings=mapping.variant.source_settings,
            expected_source_runtime_schema_digest=variant.source_runtime_schema_digest,
        )
    if isinstance(mapping, SelectedGeminiV8SourceVariant):
        restore_gemini_v8 = (
            restore_gemini_credit_v2_source_contract
            if mapping.variant.source_plugin_uid == GEMINI_0913_SOURCE_UID
            else restore_gemini_credit_source_contract
        )
        return restore_gemini_v8(
            marker,
            **arguments,
            source_settings=mapping.variant.source_settings,
            expected_source_runtime_schema_digest=variant.source_runtime_schema_digest,
        )
    if isinstance(mapping, SelectedGeminiSourceVariant):
        return restore_gemini_credit_source_contract(
            marker,
            **arguments,
            source_settings=mapping.variant.source_settings,
            expected_source_runtime_schema_digest=variant.source_runtime_schema_digest,
        )
    if isinstance(mapping, SelectedAudioSourceVariant):
        return restore_openai_audio_source_contract(
            marker,
            **arguments,
            source_settings=SourceAudioSettings(**mapping.variant.source_settings.model_dump()),
            expected_source_runtime_schema_digest=variant.source_runtime_schema_digest,
        )
    if isinstance(mapping, SelectedXAISourceVariant):
        return restore_xai_credit_source_contract(
            marker,
            **arguments,
            source_settings=_xai_factory_settings(mapping.variant.source_settings),
            source_endpoint_class=mapping.variant.source_endpoint_class,
            expected_source_runtime_schema_digest=variant.source_runtime_schema_digest,
        )
    if isinstance(mapping, SelectedEmbeddingSourceVariant):
        contract = restore_openai_embedding_source_contract(
            marker,
            **arguments,
            source_settings=OpenAIEmbeddingSourceSettings(
                source_endpoint_class=mapping.variant.source_settings.source_endpoint_class,
                request_metadata_behavior=mapping.variant.source_settings.request_metadata_behavior,
            ),
        )
        if (
            contract.source_runtime_schema_digest != mapping.variant.source_runtime_schema_digest
            or contract.adapter_id != mapping.parameter_adapter.id
            or contract.algorithm_revision != mapping.parameter_adapter.revision
            or contract.target_model != mapping.target.model
        ):
            raise ValueError("Embedding source variant profile mismatch")
        return contract
    settings = mapping.variant.source_settings
    contract: SourceParameterContract
    if variant.parameter_adapter.id == "openai_credit_llm_source_v2":
        contract = restore_openai_credit_llm_v2_source_contract(
            marker,
            **arguments,
            source_settings=settings,
            source_endpoint_class="official_root" if settings.source_base_is_set else "unset",
            expected_source_runtime_schema_digest=variant.source_runtime_schema_digest,
        )
    elif variant.parameter_adapter.id == "openai_credit_llm_source_v1":
        contract = restore_openai_credit_llm_source_contract(
            marker,
            **arguments,
            source_settings=settings,
            source_endpoint_class="official_root" if settings.source_base_is_set else "unset",
            expected_source_runtime_schema_digest=variant.source_runtime_schema_digest,
        )
    elif variant.parameter_adapter.id == "openai_provider042_source_v1":
        contract = restore_openai_provider042_source_contract(
            marker,
            **arguments,
            source_settings=OpenAI042SourceSettings(
                protocol_selector=settings.protocol_selector,
                source_base_is_set=settings.source_base_is_set,
                request_metadata_enabled=settings.request_metadata_enabled,
            ),
        )
    elif (
        settings.request_metadata_enabled
        or settings.source_base_is_set
        and variant.parameter_adapter.revision
        != ("3" if variant.parameter_adapter.id == "openai_chat_source_v1" else "2")
    ):
        # Old V2 profiles remain False/False. Only append-only official-root
        # profiles may restore True prospectively; actual selected sources
        # separately require a positive request-local endpoint classification.
        raise ValueError("Unreviewed V2 source public settings")
    elif variant.parameter_adapter.id == "openai_chat_source_v1":
        if settings.protocol_selector not in {"absent", "chat"}:
            raise ValueError("Unreviewed source protocol")
        contract = restore_openai_chat_source_contract(
            marker,
            **arguments,
            source_api_protocol=None if settings.protocol_selector == "absent" else "chat",
            source_endpoint_class="official_root" if settings.source_base_is_set else "unset",
        )
    else:
        contract = restore_openai_provider110_source_contract(
            marker,
            **arguments,
            source_settings=OpenAI110SourceSettings(
                protocol_selector=settings.protocol_selector,
                source_base_is_set=settings.source_base_is_set,
                request_metadata_enabled=settings.request_metadata_enabled,
            ),
        )
    if (
        contract.source_runtime_schema_digest != variant.source_runtime_schema_digest
        or contract.adapter_id != variant.parameter_adapter.id
        or contract.algorithm_revision != variant.parameter_adapter.revision
        or contract.target_model != mapping.target.model
    ):
        raise ValueError("Source variant profile mismatch")
    return contract


def validate_frozen_mapping_evidence(
    mapping: SelectedModelMapping,
    *,
    provider: str,
    model: str,
    model_type: ModelType,
    target_model: str,
    operations: tuple[str, ...],
    source_contract: SourceParameterContract | None,
    tts_contract: TTSVoiceContract | None,
) -> None:
    """V2 revision admission, including legacy-shaped logical siblings.

    Reuse each adapter owner's immutable evidence validator; no schema RPC or
    original vendor credential is needed on this pre-reservation boundary.
    Historical pure-V1 admission deliberately never calls this new guard.
    """
    if (
        str(ModelProviderID(mapping.source.provider_id)) != provider
        or (mapping.source.model_type, mapping.source.model) != (model_type, model)
        or (mapping.target.model_type, mapping.target.model) != (model_type, target_model)
        or tuple(mapping.operations) != operations
    ):
        raise ValueError("Frozen mapping identity or target changed")
    adapter = mapping.parameter_adapter
    if adapter.id == "identity_v1":
        if source_contract is not None or tts_contract is not None:
            raise ValueError("Unexpected source adapter evidence")
        return
    if adapter.id == "tts_source_voice_v1":
        if source_contract is not None or tts_contract is None:
            raise ValueError("Missing TTS source evidence")
        normalize_tts_voice(tts_contract, tts_contract.default_voice)
        if (
            tts_contract.source_provider != provider
            or tts_contract.source_model != model
            or tts_contract.source_schema_digest != mapping.source_schema_digest
            or (tts_contract.adapter_id, tts_contract.algorithm_revision, tts_contract.rules_digest)
            != (adapter.id, adapter.revision, adapter.rules_digest)
        ):
            raise ValueError("TTS source mapping changed")
        return
    if source_contract is None or tts_contract is not None:
        raise ValueError("Missing source parameter evidence")
    source_parameter_marker(
        source_contract, source_provider=provider, source_model=model, model_type=model_type, target_model=target_model
    )
    if (
        source_contract.source_schema_digest != mapping.source_schema_digest
        or (source_contract.adapter_id, source_contract.algorithm_revision, source_contract.rules_digest)
        != (adapter.id, adapter.revision, adapter.rules_digest)
        or isinstance(mapping, SELECTED_SOURCE_VARIANT_TYPES)
        and source_contract != restore_variant_source_contract(mapping)
    ):
        raise ValueError("Source parameter mapping changed")


def resolve_source_mapping(
    registry: ModelMappingRevision,
    identity: MappingIdentity,
    *,
    source_uid: str,
    fact: HostedSourceVariantFact | None,
    embedding_fact: HostedEmbeddingSourceFact | None = None,
    audio_fact: HostedAudioSourceFact | None = None,
    xai_fact: HostedXAISourceFact | None = None,
    gemini_fact: HostedGeminiSourceFact | None = None,
    tongyi_fact: HostedTongyiSourceFact | None = None,
    schema: AIModelEntity | None = None,
) -> SelectedModelMapping:
    declaration = registry.declarations.get(identity)
    context: SourceContext | None
    if isinstance(declaration, SourceTongyiVariantMapping):
        context = tongyi_source_variant_context(
            tongyi_fact, provider=identity[0], source_uid=source_uid, model_type=identity[1], schema=schema
        )
    elif isinstance(declaration, SourceGeminiV8VariantMapping):
        context = gemini_v8_source_variant_context(
            gemini_fact, provider=identity[0], source_uid=source_uid, model_type=identity[1], schema=schema
        )
    elif isinstance(declaration, SourceGeminiVariantMapping):
        context = gemini_source_variant_context(
            gemini_fact, provider=identity[0], source_uid=source_uid, model_type=identity[1], schema=schema
        )
    elif isinstance(declaration, SourceAudioVariantMapping):
        context = audio_source_variant_context(audio_fact, provider=identity[0], source_uid=source_uid, schema=schema)
    elif isinstance(declaration, SourceXAIVariantMapping):
        context = xai_source_variant_context(xai_fact, provider=identity[0], source_uid=source_uid, schema=schema)
    elif isinstance(declaration, SourceEmbeddingVariantMapping):
        context = embedding_source_variant_context(
            embedding_fact, provider=identity[0], source_uid=source_uid, schema=schema
        )
    else:
        context = source_variant_context(fact, provider=identity[0], source_uid=source_uid, schema=schema)
    selected = registry.resolve(identity, context=context, schema=schema)
    if isinstance(selected, SELECTED_SOURCE_VARIANT_TYPES):
        restore_variant_source_contract(selected)
    return selected


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
    raw_policy: str,
    revision: str,
    mappings: dict[MappingIdentity, ModelMapping] | dict[MappingIdentity, MappingDeclaration],
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
