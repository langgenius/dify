"""Metadata-only evidence for the saved-dependency migration policy.

No model invocation, quota reservation or Partner mutation occurs here. Source
credentials are platform SYSTEM settings only, never tenant BYOK credentials.
Every schema RPC is pinned to the freshly attested immutable source package.
"""

import hmac
from collections import Counter
from collections.abc import Mapping, Sequence
from typing import cast
from uuid import uuid4

from packaging.version import Version
from pydantic import BaseModel

from configs import dify_config
from core.entities.provider_entities import (
    ProviderQuotaType,
    QuotaConfiguration,
    QuotaUnit,
    RestrictModel,
    SystemConfiguration,
)
from core.model_invocation_routing import (
    FrozenModelInvocation,
    ModelRouteUnavailable,
    ModelRouteUnmapped,
    RoutedModelCredentials,
    _pinned_credential_fingerprint,
    embedding_dimensions_contract,
    migration_routing_state,
)
from core.plugin.entities.plugin import PluginInstallationSource
from core.plugin.entities.plugin_daemon import PluginInstallTaskStatus
from core.plugin.impl.model import PluginModelClient
from core.plugin.impl.plugin import PluginInstaller
from extensions import ext_hosting_provider
from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelPropertyKey, ModelType
from models.provider_ids import ModelProviderID
from repositories.model_billing_dependency_repository import ModelBillingDependencyRepository
from services.entities.model_billing_embedding_mapping import SelectedEmbeddingSourceVariant
from services.entities.model_billing_gemini_mapping import SelectedGeminiSourceVariant
from services.entities.model_billing_gemini_v8_mapping import SelectedGeminiV8SourceVariant
from services.entities.model_billing_mapping import SourceParameterContract
from services.entities.model_billing_tongyi_mapping import SelectedTongyiSourceVariant
from services.model_billing_dependency_inventory import DependencyInventoryPolicy, SavedModelReference
from services.model_billing_dependency_provenance import (
    ModelDependencySelectionQuery,
    SavedModelDependencyProvenance,
    StableSavedModelMigrationIntent,
    stable_source_ownership,
)
from services.model_billing_mapping_service import (
    SELECTED_SOURCE_VARIANT_TYPES,
    SelectedAudioSourceVariant,
    SelectedXAISourceVariant,
    build_source_adapter_contract,
    hosted_audio_source_fact,
    hosted_embedding_source_fact,
    hosted_gemini_source_fact,
    hosted_source_variant_fact,
    hosted_tongyi_source_fact,
    hosted_xai_source_fact,
    mapping_has_required_operations,
    model_schema_digest,
    partition_known_unavailable_sources,
    resolve_source_capability_policy,
    resolve_source_mapping,
    restore_source_parameter_contract,
    restore_variant_source_contract,
    source_mapping_revision,
    source_parameter_marker,
    source_parameter_public_settings,
)
from services.model_billing_migration_inventory import RequiredSavedCreditModel, SavedDependencySourceEvidence
from services.model_billing_source_variants import SelectedModelMapping, selection_payload


class RedirectCapabilities(BaseModel):
    protocols: list[str]
    operations: list[str]


class HistoricalMigrationInventoryGateway:
    def inventory(self, tenant_id: str, revision: str, eligibility: str | None) -> dict[str, object]:
        from core.model_invocation_routing import migration_inventory

        if eligibility is None:
            return migration_inventory(tenant_id, revision)
        return migration_inventory(tenant_id, revision, eligibility_policy_version=eligibility)

    def readiness(self, tenant_id: str, revision: str, eligibility: str | None) -> dict[str, object]:
        from core.model_invocation_routing import validate_migration_readiness

        if eligibility is None:
            return validate_migration_readiness(tenant_id, revision)
        return validate_migration_readiness(tenant_id, revision, eligibility_policy_version=eligibility)


class SavedDependencyMigrationEvidenceGateway:
    def __init__(self, *, selections: ModelDependencySelectionQuery, records: ModelBillingDependencyRepository) -> None:
        self._selections, self._records = selections, records

    def sources(
        self,
        tenant_id: str,
        revision: str,
        models: Sequence[RequiredSavedCreditModel],
        *,
        inventory_policy: DependencyInventoryPolicy = "saved_system_dependencies_v1",
        source_ownership_providers: tuple[str, ...] = (),
    ) -> SavedDependencySourceEvidence:
        try:
            return self._sources(
                tenant_id,
                revision,
                models,
                inventory_policy=inventory_policy,
                source_ownership_providers=source_ownership_providers,
            )
        except (ModelRouteUnavailable, ModelRouteUnmapped):
            raise
        except Exception:
            raise ModelRouteUnavailable from None

    def _sources(
        self,
        tenant_id: str,
        revision: str,
        models: Sequence[RequiredSavedCreditModel],
        *,
        inventory_policy: DependencyInventoryPolicy = "saved_system_dependencies_v1",
        source_ownership_providers: tuple[str, ...] = (),
    ) -> SavedDependencySourceEvidence:
        registry = source_mapping_revision(dify_config.TOKENER_LEGACY_MODEL_MAPPING_JSON, revision)
        if registry.has_variants and inventory_policy != "saved_system_dependencies_v2":
            raise ModelRouteUnmapped
        policy = resolve_source_capability_policy(dify_config.TOKENER_LEGACY_SOURCE_CAPABILITIES_JSON, revision)
        snapshot = self._selections.selection_snapshot(tenant_id)
        references = tuple(
            SavedModelReference(
                "tenant_default", tenant_id, revision, str(index), "fixed", item.provider, item.model_type, item.model
            )
            for index, item in enumerate(models)
        )
        owners = (
            StableSavedModelMigrationIntent.resolve_snapshot(snapshot, references)
            if inventory_policy == "saved_system_dependencies_v2"
            else SavedModelDependencyProvenance.resolve_snapshot(snapshot, references)
        )
        if any(
            (
                (
                    owner.migration_intent != "shared_credit_pool"
                    or set(owner.migration_pool_types) != set(required.pool_types)
                )
                if inventory_policy == "saved_system_dependencies_v2"
                else (owner.owner != "shared_credit_pool" or set(owner.pool_types) != set(required.pool_types))
            )
            for owner, required in zip(owners, models, strict=True)
        ):
            raise ModelRouteUnavailable
        provider_states = {item.provider: item for item in snapshot.providers}
        client = PluginModelClient()
        _assert_no_pending_model_installs(tenant_id, client)
        bindings = client.fetch_model_provider_bindings(tenant_id)
        declarations = client.fetch_model_providers(tenant_id)
        counts = Counter(_name(item.plugin_id, item.provider) for item in bindings)
        fresh = {_name(item.plugin_id, item.provider): item for item in bindings}
        ownership: dict[str, object] = {
            item.provider: {
                "current_quota_type": item.current_quota_type,
                "quotas": {quota.pool_type: {"unmetered": quota.limit == -1} for quota in item.quotas},
            }
            for item in snapshot.providers
            if item.system_enabled and item.current_quota_type is not None
        }
        if inventory_policy == "saved_system_dependencies_v2":
            referenced = set(source_ownership_providers) | {item.provider for item in models}
            for provider in referenced:
                source = provider_states.get(provider)
                binding = fresh.get(provider)
                catalogs = [
                    item
                    for item in declarations
                    if item.tenant_id == tenant_id and _name(item.plugin_id, item.provider) == provider
                ]
                if (
                    source is None
                    or not source.system_enabled
                    or not source.trustworthy
                    or binding is None
                    or counts[provider] != 1
                    or not binding.verified
                    or binding.source != PluginInstallationSource.Marketplace
                    or binding.runtime_type not in {"local", "serverless"}
                    or len(catalogs) != 1
                    # Raw management catalogs may omit optional installation
                    # enrichment; the verified fresh binding owns its source.
                    or catalogs[0].installation_source not in {None, PluginInstallationSource.Marketplace}
                    or binding.plugin_unique_identifier != catalogs[0].plugin_unique_identifier
                    or source.source_plugin_unique_identifier != binding.plugin_unique_identifier
                ):
                    raise ModelRouteUnavailable
            ownership = {
                item.provider: stable_source_ownership(item)
                for item in snapshot.providers
                if item.provider in referenced
            }
        result: list[Mapping[str, object]] = []
        unavailable: list[Mapping[str, object]] = []
        for required in models:
            provider, kind, model = required.provider, ModelType(required.model_type), required.model
            binding = fresh.get(provider)
            catalogs = [
                item
                for item in declarations
                if item.tenant_id == tenant_id and _name(item.plugin_id, item.provider) == provider
            ]
            source_state = provider_states.get(provider)
            if (
                binding is None
                or counts[provider] != 1
                or len(catalogs) != 1
                or not binding.verified
                or binding.source != PluginInstallationSource.Marketplace
                or binding.runtime_type not in {"local", "serverless"}
                or catalogs[0].installation_source not in {None, PluginInstallationSource.Marketplace}
                or binding.plugin_unique_identifier != catalogs[0].plugin_unique_identifier
                or source_state is None
                or source_state.source_plugin_unique_identifier != binding.plugin_unique_identifier
            ):
                raise ModelRouteUnavailable
            catalog, provider_id = catalogs[0].declaration, ModelProviderID(provider)
            hosting = ext_hosting_provider.hosting_configuration.provider_map.get(provider)
            if hosting is None or not hosting.enabled:
                raise ModelRouteUnavailable
            actual_system_settings = hosting.credentials if isinstance(hosting.credentials, dict) else None
            credentials = (
                dict(actual_system_settings or {}) if registry.has_variants else dict(hosting.credentials or {})
            )
            restricted = [
                item
                for pool in hosting.quotas
                for item in pool.restrict_models
                if pool.quota_type.value in required.pool_types and item.model_type == kind and item.model == model
            ]
            base_models = {item.base_model_name for item in restricted if item.base_model_name is not None}
            if len(base_models) > 1:
                raise ModelRouteUnmapped
            if base_models:
                credentials["base_model_name"] = next(iter(base_models))
            proof = policy.for_package(provider, binding.plugin_unique_identifier)
            if proof is not None and proof.allows_runtime(binding.runtime_type):
                system = SystemConfiguration(
                    enabled=True,
                    credentials=credentials,
                    quota_configurations=[
                        QuotaConfiguration(
                            quota_type=ProviderQuotaType(pool),
                            quota_unit=hosting.quota_unit or QuotaUnit.TOKENS,
                            quota_limit=0,
                            quota_used=0,
                            is_valid=False,
                            restrict_models=[
                                RestrictModel(
                                    model=model, model_type=kind, base_model_name=next(iter(base_models), None)
                                )
                            ],
                        )
                        for pool in required.pool_types
                    ],
                )
                partition = partition_known_unavailable_sources(
                    system,
                    catalog.models,
                    catalog.configurate_methods,
                    catalog.supported_model_types,
                    frozenset({(kind, model)}),
                    proof,
                )
                if (kind, model) in partition.unavailable:
                    proof_id, pools = partition.unavailable[(kind, model)]
                    unavailable.append(
                        {
                            "provider": provider,
                            "model_type": kind.value,
                            "model": model,
                            "source_plugin_uid": binding.plugin_unique_identifier,
                            "pool_types": sorted(pool.value for pool in pools),
                            "proof_id": proof_id,
                            "reason": partition.unavailable_reasons[(kind, model)],
                        }
                    )
                    credentials.clear()
                    continue
            schemas = [item for item in catalog.models if item.model_type == kind and item.model == model]
            if len(schemas) > 1:
                raise ModelRouteUnmapped
            schema = (
                schemas[0]
                if schemas
                else client.get_model_schema(
                    tenant_id,
                    None,
                    provider_id.plugin_id,
                    provider_id.provider_name,
                    kind.value,
                    model,
                    credentials,
                    plugin_unique_identifier=binding.plugin_unique_identifier,
                )
            )
            try:
                mapping = resolve_source_mapping(
                    registry,
                    (provider, kind, model),
                    source_uid=binding.plugin_unique_identifier,
                    fact=hosted_source_variant_fact(
                        provider=provider,
                        source_uid=binding.plugin_unique_identifier,
                        models=[schema] if schema is not None else [],
                        credentials=credentials if actual_system_settings is not None else None,
                    ),
                    embedding_fact=hosted_embedding_source_fact(
                        provider=provider,
                        source_uid=binding.plugin_unique_identifier,
                        models=[schema] if schema is not None else [],
                        credentials=credentials if actual_system_settings is not None else None,
                    ),
                    audio_fact=hosted_audio_source_fact(
                        provider=provider,
                        source_uid=binding.plugin_unique_identifier,
                        models=[schema] if schema is not None else [],
                        credentials=credentials if actual_system_settings is not None else None,
                    ),
                    xai_fact=hosted_xai_source_fact(
                        provider=provider,
                        source_uid=binding.plugin_unique_identifier,
                        models=[schema] if schema is not None else [],
                        credentials=credentials if actual_system_settings is not None else None,
                    ),
                    gemini_fact=hosted_gemini_source_fact(
                        provider=provider,
                        source_uid=binding.plugin_unique_identifier,
                        models=[schema] if schema is not None else [],
                        credentials=credentials if actual_system_settings is not None else None,
                    ),
                    tongyi_fact=hosted_tongyi_source_fact(
                        provider=provider,
                        source_uid=binding.plugin_unique_identifier,
                        models=[schema] if schema is not None else [],
                        credentials=credentials if actual_system_settings is not None else None,
                    ),
                    schema=schema,
                )
            except ValueError:
                raise ModelRouteUnmapped from None
            if (
                schema is None
                or not set(required.pool_types) <= set(mapping.pool_types)
                or not mapping_has_required_operations(mapping)
                or model_schema_digest(schema) != mapping.source_schema_digest
                or kind == ModelType.LLM
                and schema.model_properties.get(ModelPropertyKey.MODE) != mapping.source.mode
            ):
                raise ModelRouteUnmapped
            item: dict[str, object] = {
                "provider": provider,
                "model_type": kind.value,
                "model": model,
                "mapping_revision": revision,
                "source_plugin_uid": binding.plugin_unique_identifier,
                "source_schema_digest": mapping.source_schema_digest,
                "target_model": mapping.target.model,
                "source_mode": mapping.source.mode,
            }
            if isinstance(mapping, SELECTED_SOURCE_VARIANT_TYPES):
                item["source_variant"] = selection_payload(mapping).model_dump(mode="json")
            if kind == ModelType.TEXT_EMBEDDING:
                item["embedding_dimensions"] = embedding_dimensions_contract(schema)
            if mapping.parameter_adapter.id != "identity_v1":
                contract = build_source_adapter_contract(
                    mapping,
                    source_provider=provider,
                    source_schema=schema,
                    source_plugin_unique_identifier=binding.plugin_unique_identifier,
                    source_credentials=credentials,
                )
                if contract is None:
                    raise ModelRouteUnmapped
                item["source_adapter_rules_digest"] = contract.rules_digest
                if isinstance(contract, SourceParameterContract):
                    if contract.source_runtime_schema_digest is not None:
                        runtime = client.get_model_schema(
                            tenant_id,
                            None,
                            provider_id.plugin_id,
                            provider_id.provider_name,
                            kind.value,
                            model,
                            credentials,
                            plugin_unique_identifier=binding.plugin_unique_identifier,
                        )
                        if runtime is None or model_schema_digest(runtime) != contract.source_runtime_schema_digest:
                            raise ModelRouteUnmapped
                        item["source_runtime_schema_digest"] = contract.source_runtime_schema_digest
                    item["source_parameter_contract"] = source_parameter_marker(
                        contract,
                        source_provider=provider,
                        source_model=model,
                        model_type=kind,
                        target_model=mapping.target.model,
                    )
                    settings = (
                        None
                        if isinstance(mapping, SELECTED_SOURCE_VARIANT_TYPES)
                        else source_parameter_public_settings(contract, source_credentials=credentials)
                    )
                    if settings is not None:
                        item["source_parameter_settings"] = settings
            credentials.clear()
            result.append(item)
        prospective = tuple(
            {
                "provider": str(ModelProviderID(item.source.provider_id)),
                "model_type": item.source.model_type.value,
                "model": item.source.model,
                "source_variant": selection_payload(item).model_dump(mode="json"),
                "evidence": "reviewed_target_profile_only",
            }
            for item in registry.selected_prospective()
        )
        return SavedDependencySourceEvidence(
            tuple(result),
            ownership,
            tuple(unavailable),
            policy.digest,
            registry.digest if registry.has_variants else None,
            prospective,
        )

    def validate_target(self, tenant_id: str, revision: str, inventory: Mapping[str, object]) -> str:
        try:
            return self._validate_target(tenant_id, revision, inventory)
        except (ModelRouteUnavailable, ModelRouteUnmapped):
            raise
        except Exception:
            raise ModelRouteUnavailable from None

    def _validate_target(self, tenant_id: str, revision: str, inventory: Mapping[str, object]) -> str:
        client = PluginModelClient()
        _assert_no_pending_model_installs(tenant_id, client)
        capabilities = client._request_with_plugin_daemon_response(
            "GET", f"plugin/{tenant_id}/dispatch/redirect/v1/capabilities", RedirectCapabilities
        )
        if "model-redirect/v1" not in capabilities.protocols:
            raise ModelRouteUnavailable
        state = migration_routing_state(tenant_id)
        binding = self._records.managed_target_binding(tenant_id)
        if state is None or binding is None:
            raise ModelRouteUnavailable
        expected = _pinned_credential_fingerprint(state, tenant_id, binding.credential_id, allow_provisioned=True)
        if not hmac.compare_digest(expected, binding.credential_fingerprint):
            raise ModelRouteUnavailable
        registry = source_mapping_revision(dify_config.TOKENER_LEGACY_MODEL_MAPPING_JSON, revision)
        if registry.has_variants and inventory.get("source_variant_registry_digest") != registry.digest:
            raise ModelRouteUnmapped
        actual_version = binding.plugin_unique_identifier.split(":", 1)[-1].split("@", 1)[0]
        operations = set(capabilities.operations)
        sources = cast(Sequence[Mapping[str, object]], inventory["models"])
        prospective = cast(Sequence[Mapping[str, object]], inventory.get("prospective_variants", ()))
        if registry.has_variants:
            expected_variants = {
                (
                    str(ModelProviderID(item.source.provider_id)),
                    item.source.model_type.value,
                    item.source.model,
                    selection_payload(item).model_dump_json(),
                )
                for item in registry.selected_prospective()
            }
            # Compare typed canonical declarations, not selected-source counts.
            observed: set[tuple[str, str, str, str]] = set()
            for item in prospective:
                selected = registry.restore_selection(
                    (str(item["provider"]), ModelType(item["model_type"]), str(item["model"])),
                    item.get("source_variant"),
                )
                if (
                    not isinstance(selected, SELECTED_SOURCE_VARIANT_TYPES)
                    or item.get("evidence") != "reviewed_target_profile_only"
                ):
                    raise ModelRouteUnmapped
                observed.add(
                    (
                        str(item["provider"]),
                        str(item["model_type"]),
                        str(item["model"]),
                        selection_payload(selected).model_dump_json(),
                    )
                )
            if observed != expected_variants or len(observed) != len(prospective):
                raise ModelRouteUnmapped
        elif prospective:
            raise ModelRouteUnmapped
        # Collection provenance is authority here, never a label copied into a
        # source row. An actual installed source cannot opt out of its UID,
        # marker and runtime proof by claiming to be prospective target-only.
        for source, prospective_only in (
            *((item, False) for item in sources),
            *((item, True) for item in prospective),
        ):
            if not prospective_only and source.get("evidence") == "reviewed_target_profile_only":
                raise ModelRouteUnmapped
            provider, model = str(source["provider"]), str(source["model"])
            kind = ModelType(source["model_type"])
            mapping = registry.restore_selection((provider, kind, model), source.get("source_variant"))
            if not set(mapping.operations) <= operations or Version(actual_version) < Version(
                mapping.target.minimum_plugin_version
            ):
                raise ModelRouteUnavailable
            contract = None
            if isinstance(mapping, SELECTED_SOURCE_VARIANT_TYPES):
                contract = restore_variant_source_contract(mapping)
                if not prospective_only:
                    marker = source.get("source_parameter_contract")
                    if (
                        source.get("source_plugin_uid") != mapping.variant.source_plugin_uid
                        or source.get("source_schema_digest") != mapping.source_schema_digest
                        or source.get("source_parameter_settings") is not None
                        or not isinstance(marker, dict)
                        or type(marker.get("schema_version")) is not int
                        or marker
                        != source_parameter_marker(
                            contract,
                            source_provider=provider,
                            source_model=model,
                            model_type=kind,
                            target_model=mapping.target.model,
                        )
                    ):
                        raise ModelRouteUnmapped
            elif mapping.parameter_adapter.id not in {"identity_v1", "tts_source_voice_v1"}:
                contract = restore_source_parameter_contract(
                    source.get("source_parameter_contract"),
                    mapping=mapping,
                    source_public_settings=source.get("source_parameter_settings"),
                )
            plan = FrozenModelInvocation(
                tenant_id=tenant_id,
                route_id=str(uuid4()),
                logical_provider=provider,
                logical_model=model,
                model_type=kind,
                route_epoch=0,
                mapping_revision=revision,
                credential_id=binding.credential_id,
                expected_credential_fingerprint=expected,
                plugin_unique_identifier=binding.plugin_unique_identifier,
                target_model=mapping.target.model,
                operations=tuple(mapping.operations),
                source_parameter_contract=contract,
            )
            provider_id = ModelProviderID(provider)
            schema = client.get_model_schema(
                tenant_id,
                None,
                provider_id.plugin_id,
                provider_id.provider_name,
                kind.value,
                model,
                RoutedModelCredentials(plan),
            )
            if schema is None or schema.model_type != kind:
                raise ModelRouteUnmapped
            _assert_target_source_identity(mapping, schema)
            if mapping.parameter_adapter.id == "openai_credit_llm_source_v2" and schema.model not in {
                mapping.source.model,
                mapping.target.model,
            }:
                # V2 has only two reviewed dated042 aliases. Even there, a
                # returned unknown physical model is not equivalent metadata.
                raise ModelRouteUnmapped
            if contract is not None:
                if (
                    contract.source_runtime_schema_digest is not None
                    and not prospective_only
                    and source.get("source_runtime_schema_digest") != contract.source_runtime_schema_digest
                ):
                    raise ModelRouteUnmapped
                required_digest = contract.source_runtime_schema_digest or contract.source_schema_digest
                if model_schema_digest(schema.model_copy(update={"model": model})) != required_digest:
                    raise ModelRouteUnmapped
            if kind == ModelType.LLM and schema.model_properties.get(ModelPropertyKey.MODE) != mapping.source.mode:
                raise ModelRouteUnmapped
            # A prospective V3 row has no installed-source dimension fact.
            # Its exact versioned runtime schema was checked above; selected
            # source rows still retain the original dimension-contract check.
            # Neither path maps or infers a vector width from a model name.
            _assert_target_embedding_dimensions(
                mapping=mapping,
                kind=kind,
                prospective_only=prospective_only,
                source=source,
                schema=schema,
            )
        return expected


def _assert_target_source_identity(mapping: SelectedModelMapping, schema: AIModelEntity) -> None:
    """Closed families have no alias exception; never normalize a wrong target."""
    if (
        isinstance(
            mapping,
            (
                SelectedAudioSourceVariant,
                SelectedXAISourceVariant,
                SelectedGeminiSourceVariant,
                SelectedGeminiV8SourceVariant,
                SelectedTongyiSourceVariant,
            ),
        )
        and schema.model != mapping.target.model
    ):
        raise ModelRouteUnmapped


def _assert_target_embedding_dimensions(
    *,
    mapping: SelectedModelMapping,
    kind: ModelType,
    prospective_only: bool,
    source: Mapping[str, object],
    schema: AIModelEntity,
) -> None:
    """Only prospective closed declarations omit the installed-source dimension fact."""
    if (
        kind == ModelType.TEXT_EMBEDDING
        and not (
            isinstance(
                mapping,
                (
                    SelectedEmbeddingSourceVariant,
                    SelectedGeminiSourceVariant,
                    SelectedGeminiV8SourceVariant,
                    SelectedTongyiSourceVariant,
                ),
            )
            and prospective_only
        )
        and source["embedding_dimensions"] != embedding_dimensions_contract(schema)
    ):
        raise ModelRouteUnmapped


def _name(plugin_id: str, provider: str) -> str:
    return str(ModelProviderID(provider if provider.count("/") == 2 else plugin_id + "/" + provider))


def _assert_no_pending_model_installs(tenant_id: str, client: PluginModelClient) -> None:
    """Drain already admitted asynchronous source/target mutations before pinning.

    The cohort upgrade gate prevents *new* incompatible model jobs. This check
    does not claim cross-database atomicity: rollout must first update all Core
    mutation callers, then drain preexisting jobs before preparing the cohort.
    """
    installer = PluginInstaller()
    installed = {item.plugin_id for item in client.fetch_model_provider_bindings(tenant_id)}
    installed.add("langgenius/tokener")
    pending = {PluginInstallTaskStatus.Pending, PluginInstallTaskStatus.Running}
    for page in range(1, 101):
        tasks = installer.fetch_plugin_installation_tasks(tenant_id, page, 100)
        for task in tasks:
            if task.status not in pending:
                continue
            if not task.plugins:
                raise ModelRouteUnavailable
            for plugin in task.plugins:
                if plugin.status not in pending:
                    continue
                if plugin.plugin_id in installed:
                    raise ModelRouteUnavailable
                manifest = installer.fetch_plugin_manifest(tenant_id, plugin.plugin_unique_identifier)
                if manifest.model is not None or manifest.plugins.models:
                    raise ModelRouteUnavailable
        if len(tasks) < 100:
            return
    raise ModelRouteUnavailable
