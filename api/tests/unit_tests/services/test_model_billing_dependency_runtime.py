"""Fresh daemon binding authority for read-only saved SYSTEM dependencies."""

from dataclasses import dataclass
from typing import Literal
from unittest.mock import Mock

import pytest
from pydantic import ValidationError

from core.entities.provider_entities import QuotaUnit, RestrictModel
from core.hosting_configuration import HostingProvider, TrialHostingQuota
from core.plugin.entities.plugin import PluginInstallationSource
from core.plugin.entities.plugin_daemon import PluginModelProviderBinding, PluginModelProviderEntity
from core.plugin.impl.model import PluginModelClient
from enums import DeploymentEdition
from graphon.model_runtime.entities.model_entities import ModelType
from repositories.model_billing_dependency_repository import ModelBillingDependencyRepository
from services.model_billing_dependency_inventory import SavedModelReference
from services.model_billing_dependency_provenance import (
    ModelDependencyDefault,
    SavedModelDependencyProvenance,
    StableSavedModelMigrationIntent,
    StoredDependencyPreference,
    StoredDependencyProvider,
    StoredModelDependencySelections,
)
from services.model_billing_dependency_runtime import SavedModelSelectionRuntimeQuery

TENANT = "tenant-for-read-only-selection"
PROVIDER = "langgenius/openai/openai"
SOURCE_UID = "langgenius/openai:0.4.2@21195ee1321849e0a7d4b3f6b2fd8c2be23ea6c7182e1b444ecc4c1711b52468"
REFERENCE = SavedModelReference("classic_app", "app", "saved", "model", "fixed", PROVIDER, "llm", "gpt-4o-mini")


def raw_declaration() -> dict[str, object]:
    # Actual management RPC shape: installation_source is genuinely omitted.
    return {
        "id": "declaration-id",
        "created_at": "2026-11-02T10:00:00Z",
        "updated_at": "2026-11-02T10:00:00Z",
        "provider": "openai",
        "tenant_id": TENANT,
        "plugin_unique_identifier": SOURCE_UID,
        "plugin_id": "langgenius/openai",
        "declaration": {
            "provider": "openai",
            "label": {"en_US": "OpenAI"},
            "supported_model_types": ["llm"],
            "configurate_methods": ["predefined-model"],
            "models": [
                {
                    "model": "gpt-4o-mini",
                    "label": {"en_US": "gpt-4o-mini"},
                    "model_type": "llm",
                    "model_properties": {"mode": "chat"},
                    "fetch_from": "predefined-model",
                    "parameter_rules": [],
                }
            ],
        },
    }


def raw_binding() -> dict[str, object]:
    return {
        "provider": "openai",
        "installation_id": "signed-installed-id",
        "plugin_id": "langgenius/openai",
        "plugin_unique_identifier": SOURCE_UID,
        "runtime_type": "local",
        "source": "marketplace",
        "version": "0.4.2",
        "verified": True,
    }


@dataclass
class RuntimeFacts:
    query: SavedModelSelectionRuntimeQuery
    declarations: list[PluginModelProviderEntity]
    bindings: list[PluginModelProviderBinding]
    hosting: dict[str, HostingProvider]
    calls: list[tuple[str, str]]


def runtime_facts(
    monkeypatch: pytest.MonkeyPatch,
    *,
    preferred: Literal["system", "custom"] | None = None,
    custom_available: bool = False,
    stored_alias: bool = False,
) -> RuntimeFacts:
    from configs import dify_config
    from extensions import ext_hosting_provider
    from services.credit_pool_service import CreditPoolService

    monkeypatch.setattr(dify_config, "DEPLOYMENT_EDITION", DeploymentEdition.CLOUD)
    monkeypatch.setattr("services.model_billing_dependency_runtime.migration_routing_state", lambda _: None)
    monkeypatch.setattr(CreditPoolService, "get_pool", lambda *_: None)
    provider = "openai" if stored_alias else PROVIDER
    stored = StoredModelDependencySelections(
        providers=(
            StoredDependencyProvider(provider, "system", "trial", 20, 0),
            *((StoredDependencyProvider(provider, "custom", None, None, None),) if custom_available else ()),
        ),
        preferences=(StoredDependencyPreference(provider, preferred),) if preferred else (),
        custom_model_providers=(),
        defaults=(ModelDependencyDefault("llm", provider, "gpt-4o-mini"),),
        pools=(("trial", 20, 0),),
        billing_source=None,
    )
    records = ModelBillingDependencyRepository(session_factory=Mock())
    monkeypatch.setattr(
        records, "stored_selection_snapshot", lambda tenant: stored if tenant == TENANT else pytest.fail("wrong tenant")
    )
    raw = raw_declaration()
    assert "installation_source" not in raw
    declarations = [PluginModelProviderEntity.model_validate(raw)]
    bindings = [PluginModelProviderBinding.model_validate(raw_binding())]
    calls: list[tuple[str, str]] = []

    def fetch_declarations(_self: PluginModelClient, tenant: str) -> list[PluginModelProviderEntity]:
        calls.append(("declarations", tenant))
        return declarations

    def fetch_bindings(_self: PluginModelClient, tenant: str) -> list[PluginModelProviderBinding]:
        calls.append(("bindings", tenant))
        return bindings

    monkeypatch.setattr(PluginModelClient, "fetch_model_providers", fetch_declarations)
    monkeypatch.setattr(PluginModelClient, "fetch_model_provider_bindings", fetch_bindings)
    monkeypatch.setattr(
        PluginModelClient, "get_model_schema", lambda *_a, **_k: pytest.fail("selection must not call model schema")
    )
    hosting = {
        PROVIDER: HostingProvider(
            enabled=True,
            quota_unit=QuotaUnit.CREDITS,
            quotas=[
                TrialHostingQuota(
                    quota_limit=20, restrict_models=[RestrictModel(model="gpt-4o-mini", model_type=ModelType.LLM)]
                )
            ],
        )
    }
    monkeypatch.setattr(ext_hosting_provider.hosting_configuration, "provider_map", hosting)
    return RuntimeFacts(SavedModelSelectionRuntimeQuery(records=records), declarations, bindings, hosting, calls)


@pytest.mark.parametrize("runtime", ["local", "serverless"])
@pytest.mark.parametrize("stored_alias", [False, True])
def test_missing_optional_declaration_source_uses_signed_exact_tenant_binding(
    monkeypatch: pytest.MonkeyPatch,
    runtime: str,
    stored_alias: bool,
) -> None:
    facts = runtime_facts(monkeypatch, stored_alias=stored_alias)
    facts.bindings[0].runtime_type = runtime
    assert facts.declarations[0].installation_source is None
    snapshot = facts.query.selection_snapshot(TENANT)
    provider = snapshot.providers[0]
    assert provider.trustworthy is True
    assert provider.system_enabled is True
    assert provider.source_plugin_unique_identifier == SOURCE_UID
    assert provider.current_quota_type == "trial"
    assert [(quota.pool_type, quota.limit, quota.used) for quota in provider.quotas] == [("trial", 20, 0)]
    assert facts.calls == [("declarations", TENANT), ("bindings", TENANT)]
    selected = SavedModelDependencyProvenance.resolve_snapshot(snapshot, (REFERENCE,))[0]
    assert selected.owner == "shared_credit_pool"
    intent = StableSavedModelMigrationIntent.resolve_snapshot(snapshot, (REFERENCE,))[0]
    assert intent.migration_intent == "shared_credit_pool"
    assert intent.migration_pool_types == ("trial",)


@pytest.mark.parametrize(
    "failure",
    [
        "unsigned",
        "github",
        "package",
        "remote",
        "source_conflict",
        "uid",
        "tenant",
        "mutable",
        "duplicate_binding",
        "duplicate_declaration",
        "bare_hosting_only",
        "canonical_disabled",
    ],
)
def test_untrusted_or_conflicting_shared_binding_stays_closed_without_losing_byok(
    monkeypatch: pytest.MonkeyPatch,
    failure: str,
) -> None:
    facts = runtime_facts(monkeypatch, preferred="custom", custom_available=True)
    if failure == "unsigned":
        facts.bindings[0].verified = False
    elif failure in {"github", "package", "remote"}:
        facts.bindings[0].source = PluginInstallationSource(failure)
    elif failure == "source_conflict":
        facts.declarations[0].installation_source = PluginInstallationSource.Github
    elif failure == "uid":
        facts.bindings[0].plugin_unique_identifier = SOURCE_UID.replace("0.4.2", "1.1.0")
    elif failure == "tenant":
        facts.declarations[0].tenant_id = "another-tenant"
    elif failure == "mutable":
        facts.bindings[0].runtime_type = "unknown"
    elif failure == "duplicate_binding":
        facts.bindings.append(facts.bindings[0].model_copy())
    elif failure == "duplicate_declaration":
        facts.declarations.append(facts.declarations[0].model_copy())
    elif failure == "bare_hosting_only":
        facts.hosting["openai"] = facts.hosting.pop(PROVIDER)
    else:
        facts.hosting["openai"] = facts.hosting[PROVIDER].model_copy()
        facts.hosting[PROVIDER].enabled = False
    snapshot = facts.query.selection_snapshot(TENANT)
    assert all(not provider.system_enabled and not provider.quotas for provider in snapshot.providers)
    selected = SavedModelDependencyProvenance.resolve_snapshot(snapshot, (REFERENCE,))[0]
    # Duplicate declarations cannot attest any owner. Otherwise invalid shared
    # metadata must not turn an explicit actual BYOK credential into SYSTEM.
    assert selected.owner == ("unknown" if failure == "duplicate_declaration" else "custom")


def test_unknown_source_is_rejected_by_real_binding_model_not_admitted_as_marketplace() -> None:
    raw = raw_binding()
    raw["source"] = "unrecognized-source"
    with pytest.raises(ValidationError):
        PluginModelProviderBinding.model_validate(raw)


@pytest.mark.parametrize(
    "source", [PluginInstallationSource.Github, PluginInstallationSource.Package, PluginInstallationSource.Remote]
)
def test_marketplace_declaration_cannot_override_nonmarketplace_installation_binding(
    monkeypatch: pytest.MonkeyPatch, source: PluginInstallationSource
) -> None:
    facts = runtime_facts(monkeypatch, preferred="custom", custom_available=True)
    facts.declarations[0].installation_source = PluginInstallationSource.Marketplace
    facts.bindings[0].source = source
    snapshot = facts.query.selection_snapshot(TENANT)
    assert snapshot.providers[0].system_enabled is False
    assert snapshot.providers[0].quotas == ()
    assert SavedModelDependencyProvenance.resolve_snapshot(snapshot, (REFERENCE,))[0].owner == "custom"


def test_explicit_marketplace_source_still_matches_and_explicit_byok_is_not_migrated(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    facts = runtime_facts(monkeypatch, preferred="custom", custom_available=True)
    facts.declarations[0].installation_source = PluginInstallationSource.Marketplace
    snapshot = facts.query.selection_snapshot(TENANT)
    assert snapshot.providers[0].system_enabled is True
    result = StableSavedModelMigrationIntent.resolve_snapshot(snapshot, (REFERENCE,))[0]
    assert result.owner == result.migration_intent == "custom"


def test_valid_default_resolves_canonical_model_but_dynamic_reference_is_never_guessed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    facts = runtime_facts(monkeypatch, stored_alias=True)
    snapshot = facts.query.selection_snapshot(TENANT)
    default = SavedModelReference("dataset", "dataset", "saved", "qa.model", "tenant_default", None, "llm", None)
    dynamic = SavedModelReference("workflow", "app", "saved", "nodes.agent.model", "dynamic", None, "llm", None)
    results = StableSavedModelMigrationIntent.resolve_snapshot(snapshot, (default, dynamic))
    assert (results[0].provider, results[0].model, results[0].migration_intent) == (
        PROVIDER,
        "gpt-4o-mini",
        "shared_credit_pool",
    )
    assert results[1].owner == results[1].migration_intent == "unknown"
