import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import datetime
from typing import cast

import pytest
from sqlalchemy.orm import Session, sessionmaker

from core.entities.provider_entities import QuotaUnit
from core.hosting_configuration import FreeHostingQuota, HostingProvider, PaidHostingQuota, TrialHostingQuota
from core.model_invocation_routing import ModelRouteUnavailable, ModelRouteUnmapped, RoutedModelCredentials
from core.plugin.entities.plugin import PluginInstallationSource
from core.plugin.entities.plugin_daemon import (
    PluginInstallTask,
    PluginInstallTaskPluginStatus,
    PluginInstallTaskStatus,
    PluginModelProviderBinding,
    PluginModelProviderEntity,
)
from core.plugin.impl.model import PluginModelClient
from core.tools.entities.common_entities import I18nObject as PluginI18nObject
from graphon.model_runtime.entities.common_entities import I18nObject
from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelType
from graphon.model_runtime.entities.provider_entities import ConfigurateMethod, ProviderEntity
from repositories.model_billing_dependency_repository import ModelBillingDependencyRepository
from services import model_billing_migration_inventory_gateway as module
from services.model_billing_dependency_adapters import PluginAgentStrategySelectorQuery, TypedModelDependencyExtractor
from services.model_billing_dependency_inventory import (
    ClassicModelSelectors,
    DatasetModelSelectors,
    DefaultModelSelector,
    ModelBillingDependencyInventory,
    ModelDependencyDocument,
)
from services.model_billing_dependency_provenance import (
    ModelDependencyProviderState,
    ModelDependencyQuota,
    ModelDependencySelectionSnapshot,
    SavedModelDependencyProvenance,
    StableSavedModelMigrationIntent,
)
from services.model_billing_migration_inventory import (
    ManagedModelReadinessBinding,
    ModelBillingMigrationInventory,
    RequiredSavedCreditModel,
)
from services.model_billing_openai_provider042_adapter import _DAEMON_REVIEWED_CONTRACTS as GPT55_DAEMON_CONTRACTS
from services.model_billing_openai_provider042_adapter import _REVIEWED_CONTRACTS as GPT55_CONTRACTS
from tests.helpers.unit.model_billing_source_profiles import (
    DAEMON_REVISION,
    EMBEDDING_MODELS,
    EMBEDDING_REVISION,
    GPT55_DAEMON_REVISION,
    GPT55_REVISION,
    embedding_profiles,
    embedding_schemas,
    full_daemon_registry,
    full_embedding_registry,
    full_gpt55_daemon_registry,
    full_gpt55_registry,
    gpt55_daemon_schemas,
    gpt55_schemas,
)
from tests.unit_tests.services.test_model_billing_dependency_inventory import Documents
from tests.unit_tests.services.test_model_billing_dependency_runtime import TENANT as RAW_TENANT
from tests.unit_tests.services.test_model_billing_dependency_runtime import RuntimeFacts, runtime_facts
from tests.unit_tests.services.test_model_billing_mapping_service import mapping, schema
from tests.unit_tests.services.test_model_billing_migration_inventory import Historical
from tests.unit_tests.services.test_model_billing_openai_chat_adapter import RUNTIME_PROFILE
from tests.unit_tests.services.test_model_billing_source_variants import current_source_schemas

PROVIDER = "langgenius/openai/openai"
UID = "langgenius/openai:0.4.2@" + "a" * 64
NOW = datetime(2026, 11, 2)


@dataclass
class Selections:
    value: ModelDependencySelectionSnapshot

    def selection_snapshot(self, tenant_id: str) -> ModelDependencySelectionSnapshot:
        assert tenant_id == "tenant"
        return self.value


@dataclass
class Metadata:
    bindings: list[PluginModelProviderBinding]
    catalogs: list[PluginModelProviderEntity]
    dynamic: AIModelEntity | None = None
    dynamic_uid: str | None = None
    target: AIModelEntity | None = None

    def fetch_model_provider_bindings(self, tenant_id: str) -> Sequence[PluginModelProviderBinding]:
        assert tenant_id == "tenant"
        return self.bindings

    def fetch_model_providers(self, tenant_id: str) -> Sequence[PluginModelProviderEntity]:
        assert tenant_id == "tenant"
        return self.catalogs

    def get_model_schema(
        self,
        tenant_id: str,
        user_id: str | None,
        plugin_id: str,
        provider: str,
        model_type: str,
        model: str,
        credentials: dict[str, object],
        *,
        plugin_unique_identifier: str | None = None,
    ) -> AIModelEntity | None:
        del tenant_id, user_id, plugin_id, provider, model_type, model
        if isinstance(credentials, RoutedModelCredentials):
            assert not dict(credentials)
            return self.target
        # Source metadata only receives platform SYSTEM settings; no BYOK lookup.
        assert credentials.get("api_key") == "platform-test-boundary"
        self.dynamic_uid = plugin_unique_identifier
        return self.dynamic

    def _request_with_plugin_daemon_response(self, *args: object, **kwargs: object) -> module.RedirectCapabilities:
        del args, kwargs
        return module.RedirectCapabilities(
            protocols=["model-redirect/v1"], operations=["model/schema", "llm/invoke", "llm/num_tokens"]
        )


@dataclass
class Installations:
    tasks: tuple[PluginInstallTask, ...] = ()

    def fetch_plugin_installation_tasks(self, tenant_id: str, page: int, page_size: int) -> Sequence[PluginInstallTask]:
        assert tenant_id == "tenant"
        assert page == 1
        assert page_size == 100
        return self.tasks


def setup_gateway(
    monkeypatch: pytest.MonkeyPatch, factory: sessionmaker[Session]
) -> tuple[module.SavedDependencyMigrationEvidenceGateway, Metadata, Installations, Selections]:
    source = schema("saved-model")
    binding = PluginModelProviderBinding(
        provider=PROVIDER,
        installation_id="installed",
        plugin_id="langgenius/openai",
        plugin_unique_identifier=UID,
        runtime_type="serverless",
        source=PluginInstallationSource.Marketplace,
        version="0.4.2",
        verified=True,
    )
    catalog = PluginModelProviderEntity(
        id="catalog",
        created_at=NOW,
        updated_at=NOW,
        tenant_id="tenant",
        provider=PROVIDER,
        plugin_unique_identifier=UID,
        plugin_id="langgenius/openai",
        installation_source=PluginInstallationSource.Marketplace,
        declaration=ProviderEntity(
            provider=PROVIDER,
            label=I18nObject(en_US="OpenAI"),
            supported_model_types=[ModelType.LLM],
            configurate_methods=[ConfigurateMethod.PREDEFINED_MODEL],
            models=[source],
        ),
    )
    metadata, installations = Metadata([binding], [catalog]), Installations()
    state = ModelDependencyProviderState(
        PROVIDER,
        True,
        True,
        False,
        "system",
        (ModelDependencyQuota("paid", "credits", 100, 0),),
        "paid",
        True,
        source_plugin_unique_identifier=UID,
    )
    selections = Selections(ModelDependencySelectionSnapshot((state,), ()))
    monkeypatch.setattr(module, "PluginModelClient", lambda: metadata)
    monkeypatch.setattr(module, "PluginInstaller", lambda: installations)
    monkeypatch.setattr(
        module.dify_config, "TOKENER_LEGACY_MODEL_MAPPING_JSON", json.dumps([mapping(source, revision="new-v2")])
    )
    monkeypatch.setattr(module.dify_config, "TOKENER_LEGACY_SOURCE_CAPABILITIES_JSON", "[]")
    monkeypatch.setitem(
        module.ext_hosting_provider.hosting_configuration.provider_map,
        PROVIDER,
        HostingProvider(
            enabled=True,
            credentials={"api_key": "platform-test-boundary"},
            quota_unit="credits",
            quotas=[PaidHostingQuota()],
        ),
    )
    gateway = module.SavedDependencyMigrationEvidenceGateway(
        selections=selections, records=ModelBillingDependencyRepository(session_factory=factory)
    )
    return gateway, metadata, installations, selections


@pytest.mark.parametrize("selected", [False, True])
@pytest.mark.parametrize(
    "source_model",
    [
        "gemini-2.5-flash",
        "gemini-3.1-flash-lite",
        "gemini-3.1-pro-preview",
        "gemini-3.5-flash",
        "gemini-3.5-flash-lite",
        "gemini-3.7-flash",
        "gemini-3-flash-preview",
        "gemini-embedding-001",
        "gemini-embedding-2-preview",
    ],
)
def test_gemini_v6_nine_real_source_and_prospective_target_schema_boundaries(
    selected: bool,
    source_model: str,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    from tests.helpers.unit import model_billing_gemini_profiles as gemini

    gateway, metadata, _, selections = setup_gateway(monkeypatch, sqlite_session_factory)
    rows = gemini.profiles()
    by_name = {row["source_model"]: row for row in rows}
    row = by_name[source_model]
    kind = ModelType(row["model_type"])
    metadata.bindings[0].provider = gemini.SOURCE_PROVIDER
    metadata.bindings[0].plugin_id = "langgenius/gemini"
    metadata.bindings[0].plugin_unique_identifier = gemini.SOURCE_UID
    metadata.bindings[0].version = "0.9.12"
    catalog = metadata.catalogs[0]
    catalog.provider, catalog.plugin_id, catalog.plugin_unique_identifier = (
        gemini.SOURCE_PROVIDER,
        "langgenius/gemini",
        gemini.SOURCE_UID,
    )
    catalog.declaration.provider = gemini.SOURCE_PROVIDER
    catalog.declaration.models = [gemini.schema(item) for item in rows]
    catalog.declaration.supported_model_types = [ModelType.LLM, ModelType.TEXT_EMBEDDING]
    selections.value = replace(
        selections.value,
        providers=(
            replace(
                selections.value.providers[0],
                provider=gemini.SOURCE_PROVIDER,
                source_plugin_unique_identifier=gemini.SOURCE_UID,
            ),
        ),
    )
    hosting = HostingProvider(
        enabled=True,
        credentials={"google_api_key": "synthetic-original-source-only"},
        quota_unit="credits",
        quotas=[PaidHostingQuota()],
    )
    monkeypatch.setitem(module.ext_hosting_provider.hosting_configuration.provider_map, gemini.SOURCE_PROVIDER, hosting)
    monkeypatch.setattr(module.dify_config, "TOKENER_LEGACY_MODEL_MAPPING_JSON", gemini.registry())
    source_calls = []
    target_calls = []
    blocked = []

    def get_schema(
        _tenant: str,
        _user: str | None,
        _plugin: str,
        _provider: str,
        _kind: str,
        model: str,
        credentials: dict[str, object],
        *,
        plugin_unique_identifier: str | None = None,
    ) -> AIModelEntity | None:
        if isinstance(credentials, RoutedModelCredentials):
            assert dict(credentials) == {}, "never forward the original SYSTEM key"
            contract = credentials.plan.source_parameter_contract
            assert contract is not None
            assert contract.source_model == model
            target_calls.append(model)
            if model in blocked:
                return None
        else:
            assert credentials == {"google_api_key": "synthetic-original-source-only"}
            assert plugin_unique_identifier == gemini.SOURCE_UID
            source_calls.append(model)
        return gemini.schema(by_name[model], runtime=True)

    monkeypatch.setattr(metadata, "get_model_schema", get_schema)
    required = (
        (RequiredSavedCreditModel(gemini.SOURCE_PROVIDER, kind.value, source_model, ("paid",)),) if selected else ()
    )
    evidence = gateway.sources("tenant", gemini.REVISION, required, inventory_policy="saved_system_dependencies_v2")
    assert source_calls == ([source_model] if selected else [])
    assert len(evidence.models) == int(selected)
    assert len(evidence.prospective_variants) == 9
    if selected:
        actual = evidence.models[0]
        assert actual["source_runtime_schema_digest"] == row["source_runtime_schema_digest"]
        assert actual["source_plugin_uid"] == gemini.SOURCE_UID
        frozen_variant = actual["source_variant"]
        assert isinstance(frozen_variant, dict)
        assert frozen_variant["schema_version"] == 6
        assert "source_parameter_settings" not in actual
    expected = "sha256:" + "a" * 64
    monkeypatch.setattr(
        gateway._records,
        "managed_target_binding",
        lambda _: ManagedModelReadinessBinding("credential", gemini.TARGET_UID, expected),
    )
    monkeypatch.setattr(
        module,
        "migration_routing_state",
        lambda _: {
            "provisioned_binding": {
                "tenant_id": "tenant",
                "provider_name": "langgenius/tokener/tokener",
                "provider_credential_id": "credential",
                "credential_fingerprint": expected,
            }
        },
    )
    operations = [
        "model/schema",
        "llm/invoke",
        "llm/num_tokens",
        "text_embedding/invoke",
        "text_embedding/num_tokens",
        "multimodal_embedding/invoke",
    ]
    monkeypatch.setattr(
        metadata,
        "_request_with_plugin_daemon_response",
        lambda *_a, **_k: module.RedirectCapabilities(protocols=["model-redirect/v1"], operations=operations),
    )
    inventory = {
        "models": list(evidence.models),
        "prospective_variants": list(evidence.prospective_variants),
        "source_variant_registry_digest": evidence.source_variant_registry_digest,
    }
    assert gateway.validate_target("tenant", gemini.REVISION, inventory) == expected
    assert len(target_calls) == 9 + int(selected)
    for model in by_name:
        blocked[:] = [model]
        with pytest.raises(ModelRouteUnmapped):
            gateway.validate_target("tenant", gemini.REVISION, inventory)
    blocked.clear()
    operations.remove("multimodal_embedding/invoke")
    with pytest.raises(ModelRouteUnavailable):
        gateway.validate_target("tenant", gemini.REVISION, inventory)


@pytest.mark.parametrize("selected", [False, True])
@pytest.mark.parametrize(
    "source_model",
    [
        "qwen-flash",
        "qwen-max",
        "qwen-plus",
        "qwen-plus-latest",
        "qwen3-vl-plus",
        "qwen3.5-flash",
        "qwen3.5-plus",
        "qwen3.6-flash",
        "qwen3.6-plus",
        "qwen3.7-max",
        "qwen3.7-plus",
        "text-embedding-v3",
        "text-embedding-v4",
        "qwen3-rerank",
    ],
)
def test_tongyi_v7_fourteen_real_source_and_prospective_target_schema_boundaries(
    selected: bool,
    source_model: str,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    from tests.helpers.unit import model_billing_tongyi_profiles as tongyi

    gateway, metadata, _, selections = setup_gateway(monkeypatch, sqlite_session_factory)
    rows = tongyi.profiles()
    by_name = {row["source_model"]: row for row in rows}
    row = by_name[source_model]
    kind = ModelType(row["model_type"])
    metadata.bindings[0].provider = tongyi.SOURCE_PROVIDER
    metadata.bindings[0].plugin_id = "langgenius/tongyi"
    metadata.bindings[0].plugin_unique_identifier = tongyi.SOURCE_UID
    metadata.bindings[0].version = "0.2.26"
    catalog = metadata.catalogs[0]
    catalog.provider, catalog.plugin_id, catalog.plugin_unique_identifier = (
        tongyi.SOURCE_PROVIDER,
        "langgenius/tongyi",
        tongyi.SOURCE_UID,
    )
    catalog.declaration.provider = tongyi.SOURCE_PROVIDER
    catalog.declaration.models = [tongyi.schema(item) for item in rows]
    catalog.declaration.supported_model_types = [ModelType.LLM, ModelType.TEXT_EMBEDDING, ModelType.RERANK]
    selections.value = replace(
        selections.value,
        providers=(
            replace(
                selections.value.providers[0],
                provider=tongyi.SOURCE_PROVIDER,
                source_plugin_unique_identifier=tongyi.SOURCE_UID,
            ),
        ),
    )
    hosting = HostingProvider(
        enabled=True,
        credentials={"dashscope_api_key": "synthetic-original-source-only", "use_international_endpoint": "true"},
        quota_unit="credits",
        quotas=[PaidHostingQuota()],
    )
    monkeypatch.setitem(module.ext_hosting_provider.hosting_configuration.provider_map, tongyi.SOURCE_PROVIDER, hosting)
    monkeypatch.setattr(module.dify_config, "TOKENER_LEGACY_MODEL_MAPPING_JSON", tongyi.registry())
    source_calls = []
    target_calls = []
    blocked = []
    wrong_target = []

    def get_schema(
        _tenant: str,
        _user: str | None,
        _plugin: str,
        _provider: str,
        _kind: str,
        model: str,
        credentials: dict[str, object],
        *,
        plugin_unique_identifier: str | None = None,
    ) -> AIModelEntity | None:
        if isinstance(credentials, RoutedModelCredentials):
            assert dict(credentials) == {}, "never forward the original SYSTEM key"
            contract = credentials.plan.source_parameter_contract
            assert contract is not None
            assert contract.source_model == model
            target_calls.append(model)
            if model in blocked:
                return None
        else:
            assert credentials == {
                "dashscope_api_key": "synthetic-original-source-only",
                "use_international_endpoint": "true",
            }
            assert plugin_unique_identifier == tongyi.SOURCE_UID
            source_calls.append(model)
        result = tongyi.schema(by_name[model], runtime=True)
        if isinstance(credentials, RoutedModelCredentials) and wrong_target:
            return result.model_copy(update={"model": "unreviewed-target-model"})
        return result

    monkeypatch.setattr(metadata, "get_model_schema", get_schema)
    required = (
        (RequiredSavedCreditModel(tongyi.SOURCE_PROVIDER, kind.value, source_model, ("paid",)),) if selected else ()
    )
    evidence = gateway.sources("tenant", tongyi.REVISION, required, inventory_policy="saved_system_dependencies_v2")
    assert source_calls == ([source_model] if selected else [])
    assert len(evidence.models) == int(selected)
    assert len(evidence.prospective_variants) == 14
    if selected:
        actual = evidence.models[0]
        assert actual["source_runtime_schema_digest"] == row["source_runtime_schema_digest"]
        assert actual["source_plugin_uid"] == tongyi.SOURCE_UID
        frozen_variant = actual["source_variant"]
        assert isinstance(frozen_variant, dict)
        assert frozen_variant["schema_version"] == 7
        assert "source_parameter_settings" not in actual
    expected = "sha256:" + "a" * 64
    monkeypatch.setattr(
        gateway._records,
        "managed_target_binding",
        lambda _: ManagedModelReadinessBinding("credential", tongyi.TARGET_UID, expected),
    )
    monkeypatch.setattr(
        module,
        "migration_routing_state",
        lambda _: {
            "provisioned_binding": {
                "tenant_id": "tenant",
                "provider_name": "langgenius/tokener/tokener",
                "provider_credential_id": "credential",
                "credential_fingerprint": expected,
            }
        },
    )
    operations = [
        "model/schema",
        "llm/invoke",
        "llm/num_tokens",
        "text_embedding/invoke",
        "text_embedding/num_tokens",
        "rerank/invoke",
    ]
    monkeypatch.setattr(
        metadata,
        "_request_with_plugin_daemon_response",
        lambda *_a, **_k: module.RedirectCapabilities(protocols=["model-redirect/v1"], operations=operations),
    )
    inventory = {
        "models": list(evidence.models),
        "prospective_variants": list(evidence.prospective_variants),
        "source_variant_registry_digest": evidence.source_variant_registry_digest,
    }
    assert gateway.validate_target("tenant", tongyi.REVISION, inventory) == expected
    assert len(target_calls) == 14 + int(selected)
    for model in by_name:
        blocked[:] = [model]
        with pytest.raises(ModelRouteUnmapped):
            gateway.validate_target("tenant", tongyi.REVISION, inventory)
    blocked.clear()
    operations.remove("rerank/invoke")
    with pytest.raises(ModelRouteUnavailable):
        gateway.validate_target("tenant", tongyi.REVISION, inventory)
    operations.append("rerank/invoke")
    wrong_target.append(source_model)
    with pytest.raises(ModelRouteUnmapped):
        gateway.validate_target("tenant", tongyi.REVISION, inventory)


def raw_management_facade(
    monkeypatch: pytest.MonkeyPatch,
    factory: sessionmaker[Session],
    *,
    byok: bool = False,
) -> tuple[ModelBillingMigrationInventory, RuntimeFacts, str, list[str]]:
    """Real snapshot→saved selectors→source evidence; mock only external IO."""
    from services.model_billing_mapping_service import source_mapping_revision
    from tests.unit_tests.services.test_model_billing_openai_chat_adapter import RUNTIME_PROFILE, build_inputs
    from tests.unit_tests.services.test_model_billing_source_variants import REVISION, full_variant_record

    facts = runtime_facts(monkeypatch, preferred="custom" if byok else None, custom_available=byok)
    catalog = build_inputs(runtime=True)["source_schema"]
    source_runtime = AIModelEntity.model_validate(RUNTIME_PROFILE["source_schema"])
    embedding = schema("text-embedding-3-small", ModelType.TEXT_EMBEDDING)
    # The raw DTO was parsed from a dict that genuinely omitted the optional
    # source enrichment. Source catalog schemas are reviewed fixture objects.
    declaration = facts.declarations[0]
    assert "installation_source" not in declaration.model_fields_set
    assert declaration.installation_source is None
    declaration.declaration.models = [catalog, embedding]
    declaration.declaration.supported_model_types = [ModelType.LLM, ModelType.TEXT_EMBEDDING]
    source_uid = facts.bindings[0].plugin_unique_identifier
    assert declaration.plugin_unique_identifier == source_uid
    records = [full_variant_record(), mapping(embedding, revision=REVISION, target=embedding.model)]
    raw = json.dumps(records)
    monkeypatch.setattr(module.dify_config, "TOKENER_LEGACY_MODEL_MAPPING_JSON", raw)
    monkeypatch.setattr(module.dify_config, "TOKENER_LEGACY_SOURCE_CAPABILITIES_JSON", "[]")
    policy = json.dumps(
        [{"schema_version": 1, "mapping_revision": REVISION, "inventory_policy": "saved_system_dependencies_v2"}]
    )
    monkeypatch.setattr(module.dify_config, "TOKENER_LEGACY_DEPENDENCY_INVENTORIES_JSON", policy)
    hosting = facts.hosting[PROVIDER]
    hosting.credentials = {"api_key": "platform-test-boundary"}
    hosting.quotas[0].restrict_models = [
        module.RestrictModel(model=item.model, model_type=item.model_type) for item in (catalog, embedding)
    ]
    schema_calls: list[str] = []

    def original_schema(
        _self: PluginModelClient,
        tenant: str,
        user_id: str | None,
        plugin_id: str,
        provider: str,
        model_type: str,
        model: str,
        credentials: dict[str, object],
        *,
        plugin_unique_identifier: str | None = None,
    ) -> AIModelEntity:
        assert (tenant, user_id, plugin_id, provider, model_type, model) == (
            RAW_TENANT,
            None,
            "langgenius/openai",
            "openai",
            "llm",
            "gpt-4o-mini",
        )
        assert not isinstance(credentials, RoutedModelCredentials), "no ready target has been provisioned"
        assert credentials == {"api_key": "platform-test-boundary"}
        assert plugin_unique_identifier == source_uid
        schema_calls.append(model)
        return source_runtime

    monkeypatch.setattr(PluginModelClient, "get_model_schema", original_schema)
    monkeypatch.setattr(module.PluginInstaller, "fetch_plugin_installation_tasks", lambda *_: [])
    monkeypatch.setattr(
        PluginModelClient,
        "_request_with_plugin_daemon_response",
        lambda *_a, **_k: module.RedirectCapabilities(protocols=["model-redirect/v1"], operations=[]),
    )
    target_records = ModelBillingDependencyRepository(session_factory=factory)
    monkeypatch.setattr(target_records, "managed_target_binding", lambda _: None)
    monkeypatch.setattr(module, "migration_routing_state", lambda _: None)
    evidence = module.SavedDependencyMigrationEvidenceGateway(selections=facts.query, records=target_records)
    documents = Documents(
        (
            ModelDependencyDocument(
                RAW_TENANT,
                "classic_app",
                "app",
                "dormant-app-config",
                ClassicModelSelectors(
                    json.dumps({"provider": PROVIDER, "name": catalog.model, "mode": "chat"}),
                    None,
                    None,
                    None,
                    None,
                    None,
                ),
            ),
            ModelDependencyDocument(
                RAW_TENANT,
                "dataset",
                "knowledge-base",
                "saved-kb-config",
                DatasetModelSelectors("high_quality", PROVIDER, embedding.model, {}),
            ),
            ModelDependencyDocument(
                RAW_TENANT,
                "tenant_default",
                RAW_TENANT,
                "default-record",
                DefaultModelSelector(PROVIDER, "llm", catalog.model),
            ),
        )
    )
    dependencies = ModelBillingDependencyInventory(
        documents=documents,
        extractor=TypedModelDependencyExtractor(strategies=PluginAgentStrategySelectorQuery()),
        provenance=SavedModelDependencyProvenance(selections=facts.query),
        stable_provenance=StableSavedModelMigrationIntent(selections=facts.query),
    )
    facade = ModelBillingMigrationInventory(
        dependencies=dependencies, evidence=evidence, historical=Historical(), policy_json=policy
    )
    return facade, facts, source_mapping_revision(raw, REVISION).digest, schema_calls


def test_whole_v2_facade_accepts_raw_missing_source_for_app_kb_and_default_but_not_missing_target(
    monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: sessionmaker[Session]
) -> None:
    from tests.unit_tests.services.test_model_billing_source_variants import REVISION

    facade, facts, expected_registry, calls = raw_management_facade(monkeypatch, sqlite_session_factory)
    result = facade.inventory(RAW_TENANT, REVISION)
    assert result["inventory_policy"] == "saved_system_dependencies_v2"
    assert result["model_count"] == 2
    models = cast(list[dict[str, object]], result["models"])
    assert {(item["model_type"], item["model"]) for item in models} == {
        ("llm", "gpt-4o-mini"),
        ("text-embedding", "text-embedding-3-small"),
    }
    assert result["source_variant_registry_digest"] == expected_registry
    assert len(cast(list[object], result["prospective_variants"])) == 5
    assert set(cast(dict[str, object], result["source_ownership"])) == {PROVIDER}
    assert calls == ["gpt-4o-mini"]
    assert facts.declarations[0].installation_source is None
    assert "installation_source" not in facts.declarations[0].model_fields_set
    # Collecting source evidence is not target readiness, and must not create
    # an org/key/intent or treat missing target bindings as ready.
    assert "credential_fingerprint" not in result
    assert "daemon_protocol" not in result
    with pytest.raises(ModelRouteUnavailable):
        facade.readiness(RAW_TENANT, REVISION)


@pytest.mark.parametrize("drift", ["signature", "conflict", "uid", "remote"])
def test_whole_v2_facade_rechecks_fresh_source_authority_after_valid_snapshot(
    monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: sessionmaker[Session], drift: str
) -> None:
    from tests.unit_tests.services.test_model_billing_source_variants import REVISION

    facade, facts, _, schema_calls = raw_management_facade(monkeypatch, sqlite_session_factory)
    original_bindings = facts.bindings[0]
    original_catalog = facts.declarations[0]
    binding_reads = 0
    catalog_reads = 0

    def bindings(_self: PluginModelClient, tenant: str) -> list[PluginModelProviderBinding]:
        nonlocal binding_reads
        assert tenant == RAW_TENANT
        binding_reads += 1
        value = original_bindings.model_copy(deep=True)
        # Both normal snapshot reads remain trusted. Drift happens at the
        # evidence boundary, after collect has already identified SYSTEM deps.
        if binding_reads > 2:
            if drift == "signature":
                value.verified = False
            elif drift == "uid":
                value.plugin_unique_identifier = value.plugin_unique_identifier.replace("0.4.2", "1.1.0")
            elif drift == "remote":
                value.source = PluginInstallationSource.Remote
        return [value]

    def catalogs(_self: PluginModelClient, tenant: str) -> list[PluginModelProviderEntity]:
        nonlocal catalog_reads
        assert tenant == RAW_TENANT
        catalog_reads += 1
        value = original_catalog.model_copy(deep=True)
        if catalog_reads > 2 and drift == "conflict":
            value.installation_source = PluginInstallationSource.Github
        return [value]

    monkeypatch.setattr(PluginModelClient, "fetch_model_provider_bindings", bindings)
    monkeypatch.setattr(PluginModelClient, "fetch_model_providers", catalogs)
    with pytest.raises(ModelRouteUnavailable):
        facade.inventory(RAW_TENANT, REVISION)
    assert binding_reads >= 4
    assert catalog_reads == 3
    assert schema_calls == []


def test_whole_v2_facade_does_not_admit_actual_custom_dependencies_as_system(
    monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: sessionmaker[Session]
) -> None:
    from tests.unit_tests.services.test_model_billing_source_variants import REVISION

    facade, _, _, calls = raw_management_facade(monkeypatch, sqlite_session_factory, byok=True)
    result = facade.inventory(RAW_TENANT, REVISION)
    assert result["models"] == []
    assert result["model_count"] == 0
    assert result["source_ownership"] == {}
    assert all(
        item["owner"] == item["migration_intent"] == "custom"
        for item in cast(list[dict[str, object]], result["actual_runtime_ownership"])
    )
    assert calls == []
    with pytest.raises(ModelRouteUnavailable):
        facade.readiness(RAW_TENANT, REVISION)


@pytest.mark.parametrize(
    ("selected", "all_sources", "current_selector"),
    [
        (False, False, None),
        (True, False, None),
        (False, True, None),
        (True, True, None),
        (True, True, "absent"),
        (True, True, "chat"),
        (True, True, "responses"),
    ],
)
@pytest.mark.parametrize("official_variants", [False, True])
def test_variant_readiness_separates_saved_exact_set_from_prospective_target_only_evidence(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
    selected: bool,
    all_sources: bool,
    current_selector: str | None,
    official_variants: bool,
) -> None:
    from tests.unit_tests.services.test_model_billing_openai_chat_adapter import RUNTIME_PROFILE, build_inputs
    from tests.unit_tests.services.test_model_billing_source_variants import (
        OFFICIAL_ROOT_REVISION,
        REVISION,
        current_source_schemas,
        full_official_registry,
        full_variant_record,
        variant_record,
    )

    revision = OFFICIAL_ROOT_REVISION if official_variants else REVISION
    all_sources = all_sources or official_variants
    gateway, metadata, _, selections = setup_gateway(monkeypatch, sqlite_session_factory)
    inputs = build_inputs(runtime=True)
    uid = inputs["source_plugin_unique_identifier"]
    catalog = inputs["source_schema"]
    runtime042 = AIModelEntity.model_validate(RUNTIME_PROFILE["source_schema"])
    catalog110, runtime110 = current_source_schemas()
    if current_selector is not None:
        from services.model_billing_openai_provider110_adapter import _REVIEWED_CONTRACTS

        uid = _REVIEWED_CONTRACTS[0].source_plugin_unique_identifier
        catalog = catalog110
        metadata.bindings[0].version = "1.1.0"
        hosting = module.ext_hosting_provider.hosting_configuration.provider_map[PROVIDER]
        assert hosting.credentials is not None
        if current_selector != "absent":
            hosting.credentials["api_protocol"] = current_selector
    metadata.bindings[0].plugin_unique_identifier = uid
    metadata.catalogs[0].plugin_unique_identifier = uid
    metadata.catalogs[0].declaration.models = [catalog]
    metadata.dynamic = runtime110 if current_selector is not None else runtime042
    metadata.target = metadata.dynamic.model_copy(deep=True)
    initial_target = metadata.target
    selections.value = replace(
        selections.value, providers=(replace(selections.value.providers[0], source_plugin_unique_identifier=uid),)
    )
    monkeypatch.setattr(
        module.dify_config,
        "TOKENER_LEGACY_MODEL_MAPPING_JSON",
        json.dumps(
            full_official_registry()
            if official_variants
            else [full_variant_record() if all_sources else variant_record()]
        ),
    )
    seen_target_profiles: list[str] = []
    blocked_profile: list[str] = []
    if all_sources:
        original_lookup = metadata.get_model_schema

        def source_or_target(
            tenant_id: str,
            user_id: str | None,
            plugin_id: str,
            provider: str,
            model_type: str,
            model: str,
            credentials: dict[str, object],
            *,
            plugin_unique_identifier: str | None = None,
        ) -> AIModelEntity | None:
            if isinstance(credentials, RoutedModelCredentials):
                contract = credentials.plan.source_parameter_contract
                assert contract is not None
                seen_target_profiles.append(contract.profile_id)
                if contract.profile_id in blocked_profile:
                    return None
                if metadata.target is not initial_target:
                    return metadata.target
                return runtime110 if "openai-110-" in contract.profile_id else runtime042
            return original_lookup(
                tenant_id,
                user_id,
                plugin_id,
                provider,
                model_type,
                model,
                credentials,
                plugin_unique_identifier=plugin_unique_identifier,
            )

        monkeypatch.setattr(metadata, "get_model_schema", source_or_target)
    required = (RequiredSavedCreditModel(PROVIDER, "llm", "gpt-4o-mini", ("paid",)),) if selected else ()
    evidence = gateway.sources("tenant", revision, required, inventory_policy="saved_system_dependencies_v2")
    assert len(evidence.models) == int(selected)
    assert len(evidence.prospective_variants) == (10 if official_variants else 5 if all_sources else 2)
    assert all(item["evidence"] == "reviewed_target_profile_only" for item in evidence.prospective_variants)
    assert metadata.dynamic_uid == (uid if selected else None)
    if selected:
        assert evidence.models[0]["source_plugin_uid"] == uid
        assert evidence.models[0]["source_runtime_schema_digest"] == module.model_schema_digest(metadata.dynamic)
        selection = evidence.models[0]["source_variant"]
        assert isinstance(selection, dict)
        assert selection["source_settings"]["source_base_is_set"] is False
        if current_selector is not None:
            selection = evidence.models[0]["source_variant"]
            assert isinstance(selection, dict)
            assert selection["variant_id"] == "openai110-" + current_selector
    expected = "sha256:" + "a" * 64
    monkeypatch.setattr(
        gateway._records,
        "managed_target_binding",
        lambda _tenant: ManagedModelReadinessBinding("credential", "langgenius/tokener:9.9.9@" + "c" * 64, expected),
    )
    monkeypatch.setattr(
        module,
        "migration_routing_state",
        lambda _tenant: {
            "provisioned_binding": {
                "tenant_id": "tenant",
                "provider_name": "langgenius/tokener/tokener",
                "provider_credential_id": "credential",
                "credential_fingerprint": expected,
            }
        },
    )
    inventory: dict[str, object] = {
        "models": list(evidence.models),
        "prospective_variants": list(evidence.prospective_variants),
        "source_variant_registry_digest": evidence.source_variant_registry_digest,
    }
    assert gateway.validate_target("tenant", revision, inventory) == expected
    if official_variants:
        from services.model_billing_openai_chat_adapter import _OFFICIAL_ROOT_REVIEWED_CONTRACT
        from services.model_billing_openai_provider110_adapter import _OFFICIAL_ROOT_REVIEWED_CONTRACTS

        expected_official = {
            _OFFICIAL_ROOT_REVIEWED_CONTRACT.profile_id,
            *(item.profile_id for item in _OFFICIAL_ROOT_REVIEWED_CONTRACTS),
        }
        assert expected_official <= set(seen_target_profiles)
        assert len(seen_target_profiles) == 10 + int(selected)
        # A single unsupported official profile blocks preparation even when
        # the selected installed source and its RPC evidence remain False.
        for profile_id in expected_official:
            blocked_profile[:] = [profile_id]
            with pytest.raises(ModelRouteUnmapped):
                gateway.validate_target("tenant", revision, inventory)
        blocked_profile.clear()
    if selected:
        for changed_source in (
            {**evidence.models[0], "source_plugin_uid": "untrusted"},
            {**evidence.models[0], "source_parameter_contract": {"schema_version": True}},
            {**evidence.models[0], "source_parameter_settings": {"api_protocol": "default_chat"}},
        ):
            with pytest.raises(ModelRouteUnmapped):
                gateway.validate_target("tenant", revision, {**inventory, "models": [changed_source]})
    altered_sets: tuple[Sequence[Mapping[str, object]], ...] = (
        (),
        (*evidence.prospective_variants, evidence.prospective_variants[0]),
    )
    for altered in altered_sets:
        with pytest.raises(ModelRouteUnmapped):
            gateway.validate_target("tenant", revision, {**inventory, "prospective_variants": altered})
    with pytest.raises(ModelRouteUnmapped):
        gateway.validate_target(
            "tenant", revision, {**inventory, "source_variant_registry_digest": "sha256:" + "f" * 64}
        )
    metadata.target = catalog  # Catalog is not the source runtime/schema handshake.
    with pytest.raises(ModelRouteUnmapped):
        gateway.validate_target("tenant", revision, inventory)


def test_variant_sources_require_explicit_stable_saved_policy(
    monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: sessionmaker[Session]
) -> None:
    from tests.unit_tests.services.test_model_billing_source_variants import REVISION, variant_record

    gateway, _, _, _ = setup_gateway(monkeypatch, sqlite_session_factory)
    monkeypatch.setattr(module.dify_config, "TOKENER_LEGACY_MODEL_MAPPING_JSON", json.dumps([variant_record()]))
    with pytest.raises(ModelRouteUnmapped):
        gateway.sources("tenant", REVISION, ())


@pytest.mark.parametrize("credentials", [None, "malformed", [], True])
def test_variant_sources_do_not_turn_missing_or_malformed_original_settings_into_absent_fact(
    monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: sessionmaker[Session], credentials: object
) -> None:
    from tests.unit_tests.services.test_model_billing_openai_chat_adapter import build_inputs
    from tests.unit_tests.services.test_model_billing_source_variants import REVISION, variant_record

    gateway, metadata, _, selections = setup_gateway(monkeypatch, sqlite_session_factory)
    inputs = build_inputs(runtime=True)
    uid = inputs["source_plugin_unique_identifier"]
    metadata.bindings[0].plugin_unique_identifier = uid
    metadata.catalogs[0].plugin_unique_identifier = uid
    metadata.catalogs[0].declaration.models = [inputs["source_schema"]]
    selections.value = replace(
        selections.value, providers=(replace(selections.value.providers[0], source_plugin_unique_identifier=uid),)
    )
    monkeypatch.setattr(module.dify_config, "TOKENER_LEGACY_MODEL_MAPPING_JSON", json.dumps([variant_record()]))
    hosting = module.ext_hosting_provider.hosting_configuration.provider_map[PROVIDER]
    monkeypatch.setitem(
        module.ext_hosting_provider.hosting_configuration.provider_map,
        PROVIDER,
        hosting.model_copy(update={"credentials": credentials}),
    )
    with pytest.raises(ModelRouteUnmapped):
        gateway.sources(
            "tenant",
            REVISION,
            (RequiredSavedCreditModel(PROVIDER, "llm", "gpt-4o-mini", ("paid",)),),
            inventory_policy="saved_system_dependencies_v2",
        )
    assert metadata.dynamic_uid is None


def test_only_saved_required_model_is_checked_even_if_other_catalog_models_have_no_mapping(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    gateway, metadata, _, _ = setup_gateway(monkeypatch, sqlite_session_factory)
    metadata.catalogs[0].declaration.models.append(schema("unused-not-mapped"))
    result = gateway.sources("tenant", "new-v2", (RequiredSavedCreditModel(PROVIDER, "llm", "saved-model", ("paid",)),))
    assert [item["model"] for item in result.models] == ["saved-model"]
    assert metadata.dynamic_uid is None


def test_configured_dynamic_model_requires_positive_exact_uid_schema_not_whitelist_guess(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    gateway, metadata, _, _ = setup_gateway(monkeypatch, sqlite_session_factory)
    metadata.catalogs[0].declaration.models = []
    with pytest.raises(ModelRouteUnmapped):
        gateway.sources("tenant", "new-v2", (RequiredSavedCreditModel(PROVIDER, "llm", "saved-model", ("paid",)),))
    metadata.dynamic = schema("saved-model")
    assert gateway.sources(
        "tenant", "new-v2", (RequiredSavedCreditModel(PROVIDER, "llm", "saved-model", ("paid",)),)
    ).models
    assert metadata.dynamic_uid == UID


@pytest.mark.parametrize("failure", ["duplicate", "remote", "changed", "unverified"])
def test_source_binding_proof_cannot_be_satisfied_by_cached_or_mutable_metadata(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
    failure: str,
) -> None:
    gateway, metadata, _, _ = setup_gateway(monkeypatch, sqlite_session_factory)
    if failure == "duplicate":
        metadata.bindings.append(metadata.bindings[0])
    elif failure == "remote":
        metadata.bindings[0].source = PluginInstallationSource.Remote
    elif failure == "changed":
        metadata.bindings[0].plugin_unique_identifier = UID[:-1] + "b"
    else:
        metadata.bindings[0].verified = False
    with pytest.raises(ModelRouteUnavailable):
        gateway.sources("tenant", "new-v2", (RequiredSavedCreditModel(PROVIDER, "llm", "saved-model", ("paid",)),))


def test_fresh_byok_switch_between_inventory_and_source_evidence_does_not_pass_as_credits(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    gateway, _, _, selections = setup_gateway(monkeypatch, sqlite_session_factory)
    selections.value = replace(
        selections.value, providers=(replace(selections.value.providers[0], preferred="custom", custom_available=True),)
    )
    with pytest.raises(ModelRouteUnavailable):
        gateway.sources("tenant", "new-v2", (RequiredSavedCreditModel(PROVIDER, "llm", "saved-model", ("paid",)),))


@pytest.mark.parametrize("status", ["pending", "running"])
def test_pending_source_or_managed_target_install_blocks_before_schema_export(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
    status: str,
) -> None:
    gateway, _, installations, _ = setup_gateway(monkeypatch, sqlite_session_factory)
    installations.tasks = (
        PluginInstallTask(
            id="task",
            created_at=NOW,
            updated_at=NOW,
            status=PluginInstallTaskStatus(status),
            total_plugins=1,
            completed_plugins=0,
            plugins=[
                PluginInstallTaskPluginStatus(
                    plugin_id="langgenius/openai",
                    plugin_unique_identifier=UID,
                    status=PluginInstallTaskStatus(status),
                    message="",
                    icon="",
                    labels=PluginI18nObject(en_US="OpenAI"),
                )
            ],
        ),
    )
    with pytest.raises(ModelRouteUnavailable):
        gateway.sources("tenant", "new-v2", (RequiredSavedCreditModel(PROVIDER, "llm", "saved-model", ("paid",)),))


@pytest.mark.parametrize("index", range(16))
def test_private_source_profile_requires_full_source_schema_handshake_not_native_fallback(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
    index: int,
) -> None:
    from tests.unit_tests.services.test_model_billing_anthropic_adapter import binding, model_mapping, source_schema

    gateway, metadata, _, _ = setup_gateway(monkeypatch, sqlite_session_factory)
    rule, source = model_mapping(index), source_schema(index)
    expected = "sha256:" + "b" * 64
    monkeypatch.setattr(
        module.dify_config, "TOKENER_LEGACY_MODEL_MAPPING_JSON", json.dumps([rule.model_dump(mode="json")])
    )
    monkeypatch.setattr(
        gateway._records,
        "managed_target_binding",
        lambda _tenant: ManagedModelReadinessBinding("credential", "langgenius/tokener:9.9.9@" + "c" * 64, expected),
    )
    monkeypatch.setattr(
        module,
        "migration_routing_state",
        lambda _tenant: {
            "provisioned_binding": {
                "tenant_id": "tenant",
                "provider_name": "langgenius/tokener/tokener",
                "provider_credential_id": "credential",
                "credential_fingerprint": expected,
            }
        },
    )
    item = {
        "provider": rule.source.provider_id,
        "model_type": "llm",
        "model": source.model,
        "source_parameter_contract": binding(index)["marker"],
    }
    metadata.target = source.model_copy(update={"model": rule.target.model})
    assert gateway.validate_target("tenant", rule.mapping_revision, {"models": [item]}) == expected
    metadata.target = schema(rule.target.model)  # Native mode can match; full source contract does not.
    with pytest.raises(ModelRouteUnmapped):
        gateway.validate_target("tenant", rule.mapping_revision, {"models": [item]})


def stable_facade(
    gateway: module.SavedDependencyMigrationEvidenceGateway,
    selections: Selections,
) -> tuple[ModelBillingMigrationInventory, Documents]:
    document = ModelDependencyDocument(
        "tenant",
        "classic_app",
        "app",
        "saved-version",
        ClassicModelSelectors(
            json.dumps({"provider": PROVIDER, "name": "saved-model", "mode": "chat"}), None, None, None, None, None
        ),
    )
    documents = Documents((document,))
    dependencies = ModelBillingDependencyInventory(
        documents=documents,
        extractor=TypedModelDependencyExtractor(strategies=PluginAgentStrategySelectorQuery()),
        provenance=SavedModelDependencyProvenance(selections=selections),
        stable_provenance=StableSavedModelMigrationIntent(selections=selections),
    )
    facade = ModelBillingMigrationInventory(
        dependencies=dependencies,
        evidence=gateway,
        historical=Historical(),
        policy_json=json.dumps(
            [{"schema_version": 1, "mapping_revision": "new-v2", "inventory_policy": "saved_system_dependencies_v2"}]
        ),
    )
    return facade, documents


def test_v2_preparation_hash_survives_real_owner_pool_flips_and_unrelated_provider_consumption(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    gateway, _, _, selections = setup_gateway(monkeypatch, sqlite_session_factory)
    module.ext_hosting_provider.hosting_configuration.provider_map[PROVIDER].quotas.append(TrialHostingQuota())
    base = replace(
        selections.value.providers[0],
        custom_available=True,
        quotas=(ModelDependencyQuota("paid", "credits", 100, 2), ModelDependencyQuota("trial", "credits", 20, 0)),
    )
    unrelated = replace(base, provider="langgenius/anthropic/anthropic", source_plugin_unique_identifier="unrelated")
    selections.value = ModelDependencySelectionSnapshot((base, unrelated), ())
    facade, documents = stable_facade(gateway, selections)
    first = facade.inventory("tenant", "new-v2")
    for current, paid_used, trial_used, actual_owner in (
        ("paid", 17, 0, "shared_credit_pool"),
        ("trial", 100, 3, "shared_credit_pool"),
        ("trial", 100, 20, "custom"),
    ):
        changed = replace(
            base,
            current_quota_type=current,
            quotas=(replace(base.quotas[0], used=paid_used), replace(base.quotas[1], used=trial_used)),
        )
        unrelated = replace(
            unrelated,
            current_quota_type="trial",
            quotas=(replace(base.quotas[0], used=100), replace(base.quotas[1], used=19)),
        )
        selections.value = ModelDependencySelectionSnapshot((changed, unrelated), ())
        result = facade.inventory("tenant", "new-v2")
        assert result["inventory_hash"] == first["inventory_hash"]
        assert result["source_ownership"] == first["source_ownership"]
        assert set(cast(dict[str, object], result["source_ownership"])) == {PROVIDER}
        assert cast(list[dict[str, object]], result["actual_runtime_ownership"])[0]["owner"] == actual_owner
    selections.value = ModelDependencySelectionSnapshot((replace(base, preferred="custom"), unrelated), ())
    changed_preference = facade.inventory("tenant", "new-v2")
    assert changed_preference["inventory_hash"] != first["inventory_hash"]
    assert changed_preference["model_count"] == 0
    # An explicit selector configuration edit is not a normal balance change.
    selections.value = ModelDependencySelectionSnapshot((base, unrelated), ())
    old_document = documents.documents[0]
    documents.documents = (
        replace(
            old_document,
            payload=ClassicModelSelectors(
                json.dumps(
                    {
                        "provider": PROVIDER,
                        "name": "saved-model",
                        "mode": "chat",
                        "completion_params": {"temperature": 0.5},
                    }
                ),
                None,
                None,
                None,
                None,
                None,
            ),
        ),
    )
    assert facade.inventory("tenant", "new-v2")["inventory_hash"] != first["inventory_hash"]


def test_v2_free_fallback_model_is_validated_before_exhaustion_and_ownership_hash_stays_stable(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    gateway, _, _, selections = setup_gateway(monkeypatch, sqlite_session_factory)
    module.ext_hosting_provider.hosting_configuration.provider_map[PROVIDER].quotas = [
        FreeHostingQuota(),
        TrialHostingQuota(),
    ]
    free = ModelDependencyQuota("free", "credits", 10, 1)
    trial = ModelDependencyQuota("trial", "credits", 20, 0)
    source = replace(selections.value.providers[0], quotas=(free, trial), current_quota_type="free")
    selections.value = ModelDependencySelectionSnapshot((source,), ())
    facade, _ = stable_facade(gateway, selections)
    first = facade.inventory("tenant", "new-v2")
    assert first["model_count"] == 1  # Managed fallback is checked even while the actual owner is independent FREE.
    assert cast(list[dict[str, object]], first["actual_runtime_ownership"])[0]["owner"] == "provider_free"
    selections.value = ModelDependencySelectionSnapshot(
        (replace(source, current_quota_type="trial", quotas=(replace(free, used=10), trial)),), ()
    )
    second = facade.inventory("tenant", "new-v2")
    assert cast(list[dict[str, object]], second["actual_runtime_ownership"])[0]["owner"] == "shared_credit_pool"
    assert second["inventory_hash"] == first["inventory_hash"]


def test_v2_referenced_finite_tokens_owner_is_captured_without_inventing_a_tokener_model_dependency(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    gateway, metadata, _, selections = setup_gateway(monkeypatch, sqlite_session_factory)
    hosting = module.ext_hosting_provider.hosting_configuration.provider_map[PROVIDER]
    hosting.quota_unit = QuotaUnit.TOKENS
    hosting.quotas = [PaidHostingQuota(), TrialHostingQuota()]
    source = replace(
        selections.value.providers[0],
        quotas=(ModelDependencyQuota("paid", "tokens", 100, 2), ModelDependencyQuota("trial", "tokens", 20, 0)),
        current_quota_type="paid",
    )
    selections.value = ModelDependencySelectionSnapshot((source,), ())
    facade, documents = stable_facade(gateway, selections)
    first = facade.inventory("tenant", "new-v2")
    assert first["model_count"] == 0
    assert first["models"] == []
    assert metadata.dynamic_uid is None
    ownership = cast(dict[str, object], first["source_ownership"])
    assert ownership[PROVIDER] == {
        "schema_version": 2,
        "shared_pool_types": [],
        "quotas": {"paid": {"unit": "tokens", "unmetered": False}, "trial": {"unit": "tokens", "unmetered": False}},
    }
    selections.value = ModelDependencySelectionSnapshot(
        (
            replace(
                source,
                current_quota_type="trial",
                quotas=(replace(source.quotas[0], used=100), replace(source.quotas[1], used=11)),
            ),
        ),
        (),
    )
    assert facade.inventory("tenant", "new-v2")["inventory_hash"] == first["inventory_hash"]
    documents.documents = ()  # No saved reference means no invented dependency/ownership from the global catalog.
    empty = facade.inventory("tenant", "new-v2")
    assert empty["model_count"] == 0
    assert empty["source_ownership"] == {}


def test_v2_missing_custom_configuration_keeps_required_system_model_across_processing_and_publication(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    gateway, _, _, selections = setup_gateway(monkeypatch, sqlite_session_factory)
    source = replace(selections.value.providers[0], preferred="custom", custom_available=False)
    selections.value = ModelDependencySelectionSnapshot((source,), ())
    facade, _ = stable_facade(gateway, selections)
    original = facade.inventory("tenant", "new-v2")
    assert original["model_count"] == 1
    for native_cohort in (False, True):
        processing = replace(
            source,
            compatibility_route=True,
            native_tokener=native_cohort,
            managed_system_fallback=True,
            quotas=tuple(replace(quota, limit=0, used=0) for quota in source.quotas),
        )
        selections.value = ModelDependencySelectionSnapshot((processing,), ())
        current = facade.inventory("tenant", "new-v2")
        assert current["inventory_hash"] == original["inventory_hash"]
        assert cast(list[dict[str, object]], current["actual_runtime_ownership"])[0]["owner"] == "shared_credit_pool"


@pytest.mark.parametrize("daemon_profile", [False, True])
@pytest.mark.parametrize("selector", ["absent", "chat", "responses"])
@pytest.mark.parametrize("selected", [False, True])
def test_gpt55_actual_source_rpc_and_all_sixteen_prospective_handshakes_cannot_substitute_each_other(
    selector: str,
    selected: bool,
    daemon_profile: bool,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    revision = GPT55_DAEMON_REVISION if daemon_profile else GPT55_REVISION
    gateway, metadata, _, selections = setup_gateway(monkeypatch, sqlite_session_factory)
    catalog, runtime = gpt55_daemon_schemas() if daemon_profile else gpt55_schemas()
    uid = GPT55_CONTRACTS[0].source_plugin_unique_identifier
    metadata.bindings[0].plugin_unique_identifier = uid
    metadata.catalogs[0].plugin_unique_identifier = uid
    metadata.catalogs[0].declaration.models = [catalog]
    metadata.dynamic = runtime
    metadata.target = runtime
    selections.value = replace(
        selections.value, providers=(replace(selections.value.providers[0], source_plugin_unique_identifier=uid),)
    )
    hosting = module.ext_hosting_provider.hosting_configuration.provider_map[PROVIDER]
    assert hosting.credentials is not None
    if selector != "absent":
        hosting.credentials["api_protocol"] = selector
    monkeypatch.setattr(
        module.dify_config,
        "TOKENER_LEGACY_MODEL_MAPPING_JSON",
        json.dumps(full_gpt55_daemon_registry() if daemon_profile else full_gpt55_registry()),
    )
    required = (RequiredSavedCreditModel(PROVIDER, "llm", "gpt-5.5", ("paid",)),) if selected else ()
    evidence = gateway.sources("tenant", revision, required, inventory_policy="saved_system_dependencies_v2")
    assert len(evidence.models) == int(selected)
    assert len(evidence.prospective_variants) == 16
    assert all(item["evidence"] == "reviewed_target_profile_only" for item in evidence.prospective_variants)
    assert metadata.dynamic_uid == (uid if selected else None)
    if selected:
        actual = evidence.models[0]
        assert actual["model"] == "gpt-5.5"
        assert actual["source_plugin_uid"] == uid
        binding = actual["source_variant"]
        assert isinstance(binding, dict)
        assert binding["variant_id"] == "openai042-gpt55-" + selector
        assert actual["source_runtime_schema_digest"] == module.model_schema_digest(runtime)

    expected = "sha256:" + "a" * 64
    monkeypatch.setattr(
        gateway._records,
        "managed_target_binding",
        lambda _: ManagedModelReadinessBinding("credential", "langgenius/tokener:9.9.9@" + "c" * 64, expected),
    )
    monkeypatch.setattr(
        module,
        "migration_routing_state",
        lambda _: {
            "provisioned_binding": {
                "tenant_id": "tenant",
                "provider_name": "langgenius/tokener/tokener",
                "provider_credential_id": "credential",
                "credential_fingerprint": expected,
            }
        },
    )
    inventory: dict[str, object] = {
        "models": list(evidence.models),
        "prospective_variants": list(evidence.prospective_variants),
        "source_variant_registry_digest": evidence.source_variant_registry_digest,
    }
    seen: list[str] = []
    blocked: list[str] = []
    runtime042 = AIModelEntity.model_validate(RUNTIME_PROFILE["source_schema"])
    _, runtime110 = current_source_schemas()

    def target_schema(
        _tenant: str,
        _user: str | None,
        _plugin: str,
        _provider: str,
        _model_type: str,
        _model: str,
        credentials: dict[str, object],
        *,
        plugin_unique_identifier: str | None = None,
    ) -> AIModelEntity | None:
        del plugin_unique_identifier
        assert isinstance(credentials, RoutedModelCredentials)
        assert dict(credentials) == {}
        contract = credentials.plan.source_parameter_contract
        assert contract is not None
        seen.append(contract.profile_id)
        if contract.profile_id in blocked:
            return None
        if contract.source_model == "gpt-5.5":
            return runtime
        return runtime110 if "openai-110-" in contract.profile_id else runtime042

    monkeypatch.setattr(metadata, "get_model_schema", target_schema)
    assert gateway.validate_target("tenant", revision, inventory) == expected
    assert len(seen) == 16 + int(selected)
    expected_gpt55 = {
        contract.profile_id for contract in (GPT55_DAEMON_CONTRACTS if daemon_profile else GPT55_CONTRACTS)
    }
    assert expected_gpt55 <= set(seen)
    for profile in expected_gpt55:
        blocked[:] = [profile]
        with pytest.raises(ModelRouteUnmapped):
            gateway.validate_target("tenant", revision, inventory)
    blocked.clear()
    with pytest.raises(ModelRouteUnmapped):
        gateway.validate_target("tenant", revision, {**inventory, "prospective_variants": []})
    with pytest.raises(ModelRouteUnmapped):
        gateway.validate_target(
            "tenant", revision, {**inventory, "source_variant_registry_digest": "sha256:" + "f" * 64}
        )
    if selected:
        with pytest.raises(ModelRouteUnmapped):
            gateway.validate_target(
                "tenant",
                revision,
                {**inventory, "models": [{**evidence.models[0], "source_plugin_uid": "untrusted"}]},
            )


@pytest.mark.parametrize("daemon_profile", [False, True])
@pytest.mark.parametrize("model", EMBEDDING_MODELS)
@pytest.mark.parametrize("version", ["042", "110"])
@pytest.mark.parametrize("selected", [False, True])
def test_actual_embedding_source_is_not_invented_from_twelve_prospective_variants(
    model: str,
    version: str,
    selected: bool,
    daemon_profile: bool,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    revision = DAEMON_REVISION if daemon_profile else EMBEDDING_REVISION
    gateway, metadata, _, selections = setup_gateway(monkeypatch, sqlite_session_factory)
    profile = next(p for p in embedding_profiles() if (p["source_model"], p["source_version"]) == (model, version))
    uid = profile["source_plugin_uid"]
    catalog, runtime = embedding_schemas(model, version)
    metadata.bindings[0].plugin_unique_identifier = uid
    metadata.bindings[0].version = "0.4.2" if version == "042" else "1.1.0"
    metadata.catalogs[0].plugin_unique_identifier = uid
    metadata.catalogs[0].declaration.models = [catalog]
    metadata.catalogs[0].declaration.supported_model_types = [ModelType.TEXT_EMBEDDING]
    metadata.dynamic = runtime
    metadata.target = runtime
    selections.value = replace(
        selections.value, providers=(replace(selections.value.providers[0], source_plugin_unique_identifier=uid),)
    )
    hosting = module.ext_hosting_provider.hosting_configuration.provider_map[PROVIDER]
    assert hosting.credentials is not None
    hosting.credentials.update({"api_protocol": {"ignored": True}, "enable_request_metadata": "enabled"})
    monkeypatch.setattr(
        module.dify_config,
        "TOKENER_LEGACY_MODEL_MAPPING_JSON",
        json.dumps(full_daemon_registry() if daemon_profile else full_embedding_registry()),
    )
    required = (RequiredSavedCreditModel(PROVIDER, "text-embedding", model, ("paid",)),) if selected else ()
    evidence = gateway.sources("tenant", revision, required, inventory_policy="saved_system_dependencies_v2")
    assert len(evidence.models) == int(selected)
    assert len(evidence.prospective_variants) == 28
    assert sum(item["model_type"] == "text-embedding" for item in evidence.prospective_variants) == 12
    assert all(item["evidence"] == "reviewed_target_profile_only" for item in evidence.prospective_variants)
    assert metadata.dynamic_uid == (uid if selected else None)
    if selected:
        actual = evidence.models[0]
        assert actual["model"] == model
        assert actual["source_plugin_uid"] == uid
        assert actual["source_runtime_schema_digest"] == profile["source_runtime_schema_digest"]
        assert actual["embedding_dimensions"] == "fixed_by_model_fixture"
        assert "source_parameter_settings" not in actual
        binding = actual["source_variant"]
        assert isinstance(binding, dict)
        assert binding["schema_version"] == 3
        assert binding["source_settings"] == {"source_endpoint_class": "unset", "request_metadata_behavior": "not_used"}
    expected = "sha256:" + "a" * 64
    monkeypatch.setattr(
        gateway._records,
        "managed_target_binding",
        lambda _: ManagedModelReadinessBinding(
            "credential",
            ("langgenius/tokener:0.4.3-dev13@" if daemon_profile else "langgenius/tokener:0.4.3-dev12@") + "c" * 64,
            expected,
        ),
    )
    monkeypatch.setattr(
        module,
        "migration_routing_state",
        lambda _: {
            "provisioned_binding": {
                "tenant_id": "tenant",
                "provider_name": "langgenius/tokener/tokener",
                "provider_credential_id": "credential",
                "credential_fingerprint": expected,
            }
        },
    )
    monkeypatch.setattr(
        metadata,
        "_request_with_plugin_daemon_response",
        lambda *_args, **_kwargs: module.RedirectCapabilities(
            protocols=["model-redirect/v1"],
            operations=[
                "model/schema",
                "llm/invoke",
                "llm/num_tokens",
                "text_embedding/invoke",
                "text_embedding/num_tokens",
            ],
        ),
    )
    inventory: dict[str, object] = {
        "models": list(evidence.models),
        "prospective_variants": list(evidence.prospective_variants),
        "source_variant_registry_digest": evidence.source_variant_registry_digest,
    }
    runtime042 = AIModelEntity.model_validate(RUNTIME_PROFILE["source_schema"])
    _, runtime110 = current_source_schemas()
    _, runtime55 = gpt55_daemon_schemas() if daemon_profile else gpt55_schemas()
    seen: list[str] = []
    blocked: list[str] = []

    def target_schema(
        _tenant: str,
        _user: str | None,
        _plugin: str,
        _provider: str,
        _kind: str,
        _model: str,
        credentials: dict[str, object],
        *,
        plugin_unique_identifier: str | None = None,
    ) -> AIModelEntity | None:
        del plugin_unique_identifier
        assert isinstance(credentials, RoutedModelCredentials)
        assert dict(credentials) == {}
        contract = credentials.plan.source_parameter_contract
        assert contract is not None
        seen.append(contract.profile_id)
        if contract.profile_id in blocked:
            return None
        if contract.adapter_id == "openai_embedding_source_v1":
            return embedding_schemas(contract.source_model, "110" if "-110-" in contract.profile_id else "042")[1]
        if contract.source_model == "gpt-5.5":
            return runtime55
        return runtime110 if "openai-110-" in contract.profile_id else runtime042

    monkeypatch.setattr(metadata, "get_model_schema", target_schema)
    assert gateway.validate_target("tenant", revision, inventory) == expected
    assert len(seen) == 28 + int(selected)
    expected_profiles = {p["profile_id"] for p in embedding_profiles()}
    assert expected_profiles <= set(seen)
    for profile_id in expected_profiles:
        blocked[:] = [profile_id]
        with pytest.raises(ModelRouteUnmapped):
            gateway.validate_target("tenant", revision, inventory)
    blocked.clear()
    with pytest.raises(ModelRouteUnmapped):
        gateway.validate_target("tenant", revision, {**inventory, "prospective_variants": []})
    if selected:
        for key, value in (
            ("source_plugin_uid", "unreviewed"),
            ("source_runtime_schema_digest", "sha256:" + "f" * 64),
            ("source_parameter_settings", {"api_protocol": "default_chat"}),
            ("embedding_dimensions", "guessed-vector-width"),
        ):
            with pytest.raises(ModelRouteUnmapped):
                gateway.validate_target(
                    "tenant", revision, {**inventory, "models": [{**evidence.models[0], key: value}]}
                )


def test_actual_gpt55_daemon_schema_does_not_pass_the_old_sdk_only_readiness_pin(
    monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: sessionmaker[Session]
) -> None:
    gateway, metadata, _, selections = setup_gateway(monkeypatch, sqlite_session_factory)
    catalog, actual_runtime = gpt55_daemon_schemas()
    uid = GPT55_CONTRACTS[0].source_plugin_unique_identifier
    metadata.bindings[0].plugin_unique_identifier = uid
    metadata.catalogs[0].plugin_unique_identifier = uid
    metadata.catalogs[0].declaration.models = [catalog]
    metadata.dynamic = actual_runtime
    selections.value = replace(
        selections.value, providers=(replace(selections.value.providers[0], source_plugin_unique_identifier=uid),)
    )
    monkeypatch.setattr(module.dify_config, "TOKENER_LEGACY_MODEL_MAPPING_JSON", json.dumps(full_gpt55_registry()))
    required = (RequiredSavedCreditModel(PROVIDER, "llm", "gpt-5.5", ("paid",)),)
    with pytest.raises(ModelRouteUnmapped):
        gateway.sources("tenant", GPT55_REVISION, required, inventory_policy="saved_system_dependencies_v2")
    assert metadata.dynamic_uid == uid


def test_new_revision_collects_both_saved_original042_mini_and_gpt55_runtime_boundaries(
    monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: sessionmaker[Session]
) -> None:
    from tests.unit_tests.services.test_model_billing_openai_chat_adapter import build_inputs

    gateway, metadata, _, selections = setup_gateway(monkeypatch, sqlite_session_factory)
    mini_catalog = build_inputs(runtime=True)["source_schema"]
    mini_runtime = AIModelEntity.model_validate(RUNTIME_PROFILE["source_schema"])
    gpt55_catalog, gpt55_runtime = gpt55_daemon_schemas()
    uid = GPT55_DAEMON_CONTRACTS[0].source_plugin_unique_identifier
    metadata.bindings[0].plugin_unique_identifier = uid
    metadata.catalogs[0].plugin_unique_identifier = uid
    metadata.catalogs[0].declaration.models = [mini_catalog, gpt55_catalog]
    selections.value = replace(
        selections.value, providers=(replace(selections.value.providers[0], source_plugin_unique_identifier=uid),)
    )
    monkeypatch.setattr(module.dify_config, "TOKENER_LEGACY_MODEL_MAPPING_JSON", json.dumps(full_daemon_registry()))
    seen: list[str] = []

    def original_schema(
        _tenant: str,
        _user: str | None,
        _plugin: str,
        _provider: str,
        kind: str,
        model: str,
        credentials: dict[str, object],
        *,
        plugin_unique_identifier: str | None = None,
    ) -> AIModelEntity:
        assert plugin_unique_identifier == uid
        assert kind == "llm"
        assert credentials == {"api_key": "platform-test-boundary"}
        seen.append(model)
        return {"gpt-4o-mini": mini_runtime, "gpt-5.5": gpt55_runtime}[model]

    monkeypatch.setattr(metadata, "get_model_schema", original_schema)
    required = tuple(
        RequiredSavedCreditModel(PROVIDER, "llm", model, ("paid",)) for model in ("gpt-4o-mini", "gpt-5.5")
    )
    evidence = gateway.sources("tenant", DAEMON_REVISION, required, inventory_policy="saved_system_dependencies_v2")
    assert seen == ["gpt-4o-mini", "gpt-5.5"]
    assert len(evidence.models) == 2
    assert len(evidence.prospective_variants) == 28
    for item in evidence.models:
        assert item["source_plugin_uid"] == uid
        marker = item["source_parameter_contract"]
        assert isinstance(marker, dict)
        profile_id = marker["profile_id"]
        assert isinstance(profile_id, str)
        assert ("-daemon-runtime-v1:" in profile_id) == (item["model"] == "gpt-5.5")
    assert module.ext_hosting_provider.hosting_configuration.provider_map[PROVIDER].credentials == {
        "api_key": "platform-test-boundary"
    }


@pytest.mark.parametrize(("version", "model"), [("042", "gpt-5-2025-08-07"), ("110", "gpt-6-sol")])
def test_credit_llm_family_checks_selected_source_and_every_prospective_target(
    version: str, model: str, monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: sessionmaker[Session]
) -> None:
    from tests.unit_tests.services.test_model_billing_source_variants import (
        _CREDIT_LLM_PROFILES,
        _CREDIT_LLM_REVISION,
        _credit_llm_catalog,
        _credit_llm_records,
    )

    index = next(
        i
        for i, p in enumerate(_CREDIT_LLM_PROFILES)
        if p["source_version"] == version
        and p["source_model"] == model
        and p["source_endpoint_class"] == "unset"
        and p["protocol"] == ("chat" if version == "042" else "responses")
    )
    profile = _CREDIT_LLM_PROFILES[index]
    gateway, metadata, _, selections = setup_gateway(monkeypatch, sqlite_session_factory)
    catalog = _credit_llm_catalog(index)
    runtime = AIModelEntity.model_validate(profile["source_daemon_schema"])
    uid = profile["source_plugin_uid"]
    metadata.bindings[0].plugin_unique_identifier = uid
    metadata.bindings[0].version = "0.4.2" if version == "042" else "1.1.0"
    metadata.catalogs[0].plugin_unique_identifier = uid
    metadata.catalogs[0].declaration.models = [catalog]
    metadata.dynamic = runtime
    selections.value = replace(
        selections.value, providers=(replace(selections.value.providers[0], source_plugin_unique_identifier=uid),)
    )
    monkeypatch.setattr(module.dify_config, "TOKENER_LEGACY_MODEL_MAPPING_JSON", json.dumps(_credit_llm_records()))
    evidence = gateway.sources(
        "tenant",
        _CREDIT_LLM_REVISION,
        (RequiredSavedCreditModel(PROVIDER, "llm", model, ("paid",)),),
        inventory_policy="saved_system_dependencies_v2",
    )
    assert len(evidence.models) == 1
    assert len(evidence.prospective_variants) == 192
    assert metadata.dynamic_uid == uid
    assert evidence.models[0]["source_runtime_schema_digest"] == module.model_schema_digest(runtime)
    expected = "sha256:" + "a" * 64
    monkeypatch.setattr(
        gateway._records,
        "managed_target_binding",
        lambda _: ManagedModelReadinessBinding("credential", "langgenius/tokener:9.9.9@" + "c" * 64, expected),
    )
    monkeypatch.setattr(
        module,
        "migration_routing_state",
        lambda _: {
            "provisioned_binding": {
                "tenant_id": "tenant",
                "provider_name": "langgenius/tokener/tokener",
                "provider_credential_id": "credential",
                "credential_fingerprint": expected,
            }
        },
    )
    profiles = {p["profile_id"]: p for p in _CREDIT_LLM_PROFILES}
    seen: list[str] = []
    invalid: list[str] = []

    def target_schema(
        _tenant: str,
        _user: str | None,
        _plugin: str,
        _provider: str,
        _kind: str,
        _model: str,
        credentials: dict[str, object],
        **_kwargs: object,
    ) -> AIModelEntity:
        assert isinstance(credentials, RoutedModelCredentials)
        assert dict(credentials) == {}
        contract = credentials.plan.source_parameter_contract
        assert contract is not None
        seen.append(contract.profile_id)
        schema = AIModelEntity.model_validate(profiles[contract.profile_id]["source_daemon_schema"])
        if invalid and contract.profile_id == invalid[0]:
            return schema.model_copy(update={"model_type": ModelType.TEXT_EMBEDDING})
        return schema.model_copy(update={"model": contract.target_model})

    monkeypatch.setattr(metadata, "get_model_schema", target_schema)
    inventory = {
        "models": list(evidence.models),
        "prospective_variants": list(evidence.prospective_variants),
        "source_variant_registry_digest": evidence.source_variant_registry_digest,
    }
    assert gateway.validate_target("tenant", _CREDIT_LLM_REVISION, inventory) == expected
    assert len(seen) == 193
    assert set(seen) == set(profiles)
    invalid[:] = [profile["profile_id"]]
    with pytest.raises(ModelRouteUnmapped):
        gateway.validate_target("tenant", _CREDIT_LLM_REVISION, inventory)
    with pytest.raises(ModelRouteUnmapped):
        gateway.validate_target("tenant", _CREDIT_LLM_REVISION, {**inventory, "prospective_variants": []})
