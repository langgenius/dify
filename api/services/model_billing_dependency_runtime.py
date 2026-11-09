"""Technical adapters for fresh read-only model selection evidence."""

from collections import Counter
from collections.abc import Callable, Sequence
from typing import Literal, cast

from configs import dify_config
from core.entities.provider_entities import ProviderQuotaType, QuotaConfiguration, QuotaUnit
from core.model_invocation_routing import (
    compatibility_quota_type,
    has_compatibility_route,
    migration_routing_state,
)
from core.plugin.entities.plugin import PluginInstallationSource
from core.plugin.impl.model import PluginModelClient
from enums import DeploymentEdition
from extensions import ext_hosting_provider
from models.provider_ids import ModelProviderID
from repositories.knowledge.dataset_repository import SQLAlchemyDatasetRepository
from repositories.model_billing_dependency_repository import ModelBillingDependencyRepository
from services.credit_pool_service import CreditPoolService
from services.knowledge.model_dependencies import DatasetModelDependencyRecord
from services.model_billing_dependency_inventory import (
    DatasetModelSelectors,
    DependencyInventoryPolicy,
    ModelDependencyDocument,
    WorkflowModelSelectors,
)
from services.model_billing_dependency_provenance import (
    ModelDependencyDefault,
    ModelDependencyProviderState,
    ModelDependencyQuota,
    ModelDependencySelectionSnapshot,
    StoredDependencyProvider,
)
from services.model_billing_mapping_service import (
    additional_hosted_availability,
    hosted_embedding_source_fact,
    hosted_gemini_source_fact,
    hosted_source_variant_fact,
    hosted_tongyi_source_fact,
    provider_has_prepared_ownership,
    published_original_quotas,
    retirement_policy_for_revision,
    source_mapping_revision,
    uses_published_tokener_balance,
    uses_stable_dependency_inventory,
)
from services.model_billing_migration_inventory import saved_dependency_inventory_policy


class RevisionModelDependencyRetirements:
    def identities(self, mapping_revision: str | None) -> frozenset[tuple[str, str, str]]:
        if mapping_revision is None:
            return frozenset()
        registry = source_mapping_revision(dify_config.TOKENER_LEGACY_MODEL_MAPPING_JSON, mapping_revision)
        policy = retirement_policy_for_revision(
            dify_config.TOKENER_LEGACY_RETIRED_MODELS_JSON, mapping_revision, dict(registry.declarations)
        )
        return frozenset((provider, kind.value, model) for provider, kind, model in policy.identities)


class RevisionModelDependencyInventoryPolicies:
    def for_revision(self, mapping_revision: str | None) -> DependencyInventoryPolicy:
        return saved_dependency_inventory_policy(
            dify_config.TOKENER_LEGACY_DEPENDENCY_INVENTORIES_JSON, mapping_revision
        )


class CompositeModelDependencyDocuments:
    def __init__(self, readers: Sequence[Callable[[str], Sequence[ModelDependencyDocument]]]) -> None:
        self._readers = tuple(readers)

    def collect(self, tenant_id: str) -> Sequence[ModelDependencyDocument]:
        return tuple(document for reader in self._readers for document in reader(tenant_id))


class KnowledgeModelDependencyDocuments:
    def __init__(self, *, datasets: SQLAlchemyDatasetRepository) -> None:
        self._datasets = datasets

    def collect(self, tenant_id: str) -> Sequence[ModelDependencyDocument]:
        documents: list[ModelDependencyDocument] = []
        for item in self._datasets.collect_model_dependency_records(tenant_id):
            if isinstance(item, DatasetModelDependencyRecord):
                documents.append(
                    ModelDependencyDocument(
                        item.tenant_id,
                        "dataset",
                        item.dataset_id,
                        "configuration",
                        DatasetModelSelectors(
                            item.indexing_technique,
                            item.embedding_provider,
                            item.embedding_model,
                            item.retrieval,
                            item.external,
                            item.summary,
                            item.has_qa_documents,
                        ),
                    )
                )
            else:
                documents.append(
                    ModelDependencyDocument(
                        item.tenant_id,
                        "workflow",
                        item.pipeline_id,
                        item.workflow_id,
                        WorkflowModelSelectors(item.graph, item.features),
                    )
                )
        return tuple(documents)


def _provider(value: str, *, plugin_id: str | None = None) -> str:
    return str(ModelProviderID(value if value.count("/") == 2 or plugin_id is None else plugin_id + "/" + value))


class SavedModelSelectionRuntimeQuery:
    def __init__(self, *, records: ModelBillingDependencyRepository) -> None:
        self._records = records

    def selection_snapshot(self, tenant_id: str) -> ModelDependencySelectionSnapshot:
        stored = self._records.stored_selection_snapshot(tenant_id)
        if stored.billing_source not in {None, "tokener"}:
            raise ValueError("unknown_model_billing_source")
        state = migration_routing_state(tenant_id)
        compatibility = has_compatibility_route(state)
        published = uses_published_tokener_balance(state)
        stable_inventory = uses_stable_dependency_inventory(
            dify_config.TOKENER_LEGACY_DEPENDENCY_INVENTORIES_JSON, state
        )
        cloud = dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD
        client = PluginModelClient()
        declarations = client.fetch_model_providers(tenant_id)
        bindings = client.fetch_model_provider_bindings(tenant_id)
        counts = Counter(_provider(item.provider, plugin_id=item.plugin_id) for item in bindings)
        fresh = {_provider(item.provider, plugin_id=item.plugin_id): item for item in bindings}
        declaration_counts = Counter(_provider(item.provider, plugin_id=item.plugin_id) for item in declarations)
        pools = {kind: (limit, used) for kind, limit, used in stored.pools}
        if cloud and not compatibility:
            # This is a balance-only read, outside every SQL read session.
            for kind in ("trial", "paid"):
                balance = CreditPoolService.get_pool(tenant_id, kind)
                if balance is not None:
                    pools[kind] = (balance.quota_limit, balance.quota_used)
        raw_records: dict[str, list[StoredDependencyProvider]] = {}
        raw_preferences: dict[str, list[str]] = {}
        for item in stored.providers:
            raw_records.setdefault(item.provider, []).append(item)
        for preference in stored.preferences:
            raw_preferences.setdefault(preference.provider, []).append(preference.preferred)
        providers: list[ModelDependencyProviderState] = []
        for declaration in declarations:
            name = _provider(declaration.provider, plugin_id=declaration.plugin_id)
            provider_id = ModelProviderID(name)
            # Exact canonical entries override a bare legacy alias, matching
            # ProviderManager. Never merge conflicting Provider quotas/prefs.
            records = raw_records.get(
                name, raw_records.get(provider_id.provider_name, []) if provider_id.is_langgenius() else []
            )
            preferences = raw_preferences.get(
                name, raw_preferences.get(provider_id.provider_name, []) if provider_id.is_langgenius() else []
            )
            custom = any(item.provider_type != "system" for item in records) or any(
                _provider(item) == name for item in stored.custom_model_providers
            )
            binding = fresh.get(name)
            trustworthy = bool(
                counts[name] == 1
                and declaration_counts[name] == 1
                and binding is not None
                and binding.runtime_type in {"local", "serverless"}
                and binding.source != PluginInstallationSource.Remote
                and binding.plugin_unique_identifier == declaration.plugin_unique_identifier
                and declaration.tenant_id == tenant_id
                and len(preferences) <= 1
            )
            hosting = ext_hosting_provider.hosting_configuration.provider_map.get(name)
            enabled = bool(
                trustworthy
                and binding
                and binding.verified
                # Management declarations may omit this optional enrichment;
                # the fresh exact-UID installation binding owns source/signature
                # authority. An explicit conflicting declaration is not ignored.
                and binding.source == PluginInstallationSource.Marketplace
                and declaration.installation_source in {None, PluginInstallationSource.Marketplace}
                and hosting
                and hosting.enabled
                and (stored.billing_source is None or compatibility)
            )
            quotas: list[QuotaConfiguration] = []
            current = None
            if enabled and hosting:
                by_pool = {item.quota_type: item for item in records if item.provider_type == "system"}
                for quota in hosting.quotas:
                    row = by_pool.get(quota.quota_type.value)
                    # Normal initialization creates missing paid/trial rows at
                    # zero. Model that fact without performing the write.
                    limit, used = (row.quota_limit, row.quota_used) if row else (0, 0)
                    if cloud and not compatibility and quota.quota_type.value in pools:
                        limit, used = pools[quota.quota_type.value]
                    if not isinstance(limit, int) or not isinstance(used, int):
                        trustworthy = False
                        continue
                    quotas.append(
                        QuotaConfiguration(
                            quota_type=quota.quota_type,
                            quota_unit=hosting.quota_unit or QuotaUnit.TOKENS,
                            quota_limit=limit,
                            quota_used=used,
                            is_valid=limit == -1 or limit > used,
                            restrict_models=quota.restrict_models,
                        )
                    )
                if compatibility and state is not None:
                    additional = not provider_has_prepared_ownership(name, state)
                    if published or additional:
                        preserve = None
                        if published:
                            quotas, preserve = published_original_quotas(name, quotas, state)
                        available = additional_hosted_availability(
                            provider=name,
                            hosting=hosting,
                            installed_models=declaration.declaration.models,
                            original_quotas=quotas,
                            raw_registry=dify_config.TOKENER_LEGACY_MODEL_MAPPING_JSON,
                            revision=state.get("model_mapping_version", ""),
                            published_balance=published,
                            preserve_independent_pool=preserve,
                            preserve_independent_units=stable_inventory,
                            source_uid=declaration.plugin_unique_identifier,
                            source_fact=hosted_source_variant_fact(
                                provider=name,
                                source_uid=declaration.plugin_unique_identifier,
                                models=declaration.declaration.models,
                                credentials=hosting.credentials,
                            ),
                            embedding_source_fact=hosted_embedding_source_fact(
                                provider=name,
                                source_uid=declaration.plugin_unique_identifier,
                                models=declaration.declaration.models,
                                credentials=hosting.credentials,
                            ),
                            gemini_source_fact=hosted_gemini_source_fact(
                                provider=name,
                                source_uid=declaration.plugin_unique_identifier,
                                models=declaration.declaration.models,
                                credentials=hosting.credentials,
                            ),
                            tongyi_source_fact=hosted_tongyi_source_fact(
                                provider=name,
                                source_uid=declaration.plugin_unique_identifier,
                                models=declaration.declaration.models,
                                credentials=hosting.credentials,
                            ),
                            allow_source_variants=stable_inventory,
                        )
                        if available is not None:
                            quotas, current = available.quotas, available.current_quota_type
                        else:
                            enabled = False
                    else:
                        current = compatibility_quota_type(name, quotas, state)
                elif quotas:
                    current = next(
                        (
                            kind
                            for kind in (ProviderQuotaType.PAID, ProviderQuotaType.FREE, ProviderQuotaType.TRIAL)
                            if any(item.quota_type == kind and item.is_valid for item in quotas)
                        ),
                        quotas[-1].quota_type,
                    )
            preferred = preferences[0] if preferences else None
            if preferred not in {None, "system", "custom"}:
                trustworthy = False
            providers.append(
                ModelDependencyProviderState(
                    name,
                    True,
                    enabled,
                    custom,
                    cast(Literal["system", "custom"] | None, preferred),
                    tuple(
                        ModelDependencyQuota(
                            cast(Literal["paid", "free", "trial"], item.quota_type.value),
                            item.quota_unit.value,
                            item.quota_limit,
                            item.quota_used,
                            tuple((model.model_type.value, model.model) for model in item.restrict_models),
                        )
                        for item in quotas
                    ),
                    current.value if current is not None else None,
                    cloud,
                    compatibility,
                    stored.billing_source == "tokener",
                    trustworthy,
                    len(preferences) <= 1 and preferred in {None, "system", "custom"},
                    binding.plugin_unique_identifier if binding is not None else None,
                    stable_inventory,
                )
            )
        defaults = tuple(
            ModelDependencyDefault(item.model_type, _provider(item.provider), item.model) for item in stored.defaults
        )
        return ModelDependencySelectionSnapshot(tuple(providers), defaults)
