import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field, replace

import pytest

from services.model_billing_dependency_inventory import (
    AdmittedModelDependencyCaller,
    DependencyInventoryPolicy,
    ModelDependencyInventoryError,
    ModelDependencyProblem,
    ResolvedModelDependency,
    SavedModelReference,
    SavedSystemDependencyInventory,
)
from services.model_billing_migration_inventory import (
    ModelBillingMigrationInventory,
    RequiredSavedCreditModel,
    SavedDependencySourceEvidence,
)

PROVIDER = "langgenius/openai/openai"
POLICY = json.dumps(
    [{"schema_version": 1, "mapping_revision": "new-v2", "inventory_policy": "saved_system_dependencies_v1"}]
)


@dataclass
class Dependencies:
    value: SavedSystemDependencyInventory
    callers: list[AdmittedModelDependencyCaller] = field(default_factory=list)

    def collect(self, caller: AdmittedModelDependencyCaller) -> SavedSystemDependencyInventory:
        self.callers.append(caller)
        return self.value


@dataclass
class Historical:
    calls: list[tuple[str, str, str | None]] = field(default_factory=list)
    value: dict[str, object] = field(default_factory=lambda: {"inventory_hash": "historical-hash", "historical": True})

    def inventory(self, tenant_id: str, revision: str, eligibility: str | None) -> dict[str, object]:
        del tenant_id
        self.calls.append(("inventory", revision, eligibility))
        return self.value

    def readiness(self, tenant_id: str, revision: str, eligibility: str | None) -> dict[str, object]:
        del tenant_id
        self.calls.append(("readiness", revision, eligibility))
        return self.value


@dataclass
class Evidence:
    omit_model: bool = False
    calls: list[tuple[RequiredSavedCreditModel, ...]] = field(default_factory=list)
    target_calls: list[Mapping[str, object]] = field(default_factory=list)

    def sources(
        self,
        tenant_id: str,
        revision: str,
        models: Sequence[RequiredSavedCreditModel],
        *,
        inventory_policy: DependencyInventoryPolicy = "saved_system_dependencies_v1",
        source_ownership_providers: tuple[str, ...] = (),
    ) -> SavedDependencySourceEvidence:
        del tenant_id, inventory_policy, source_ownership_providers
        self.calls.append(tuple(models))
        items = tuple(
            {
                "provider": item.provider,
                "model_type": item.model_type,
                "model": item.model,
                "mapping_revision": revision,
                "source_schema_digest": "sha256:source",
                "source_plugin_uid": "immutable-package",
            }
            for item in models
        )
        return SavedDependencySourceEvidence(items[:-1] if self.omit_model else items, {})

    def validate_target(self, tenant_id: str, revision: str, inventory: Mapping[str, object]) -> str:
        del tenant_id, revision
        self.target_calls.append(inventory)
        return "sha256:managed-fingerprint"


def saved() -> SavedSystemDependencyInventory:
    reference = SavedModelReference(
        "workflow", "app", "historical", "nodes.m.model", "fixed", PROVIDER, "llm", "chosen"
    )
    dependency = ResolvedModelDependency(reference, "shared_credit_pool", PROVIDER, "llm", "chosen", ("paid",))
    return SavedSystemDependencyInventory("tenant", (dependency,), (), (), "sha256:snapshot")


def facade(
    value: SavedSystemDependencyInventory | None = None, *, policy: str = POLICY
) -> tuple[ModelBillingMigrationInventory, Dependencies, Evidence, Historical]:
    dependencies, evidence, historical = Dependencies(value or saved()), Evidence(), Historical()
    return (
        ModelBillingMigrationInventory(
            dependencies=dependencies, evidence=evidence, historical=historical, policy_json=policy
        ),
        dependencies,
        evidence,
        historical,
    )


@pytest.mark.parametrize("policy", ["[]", POLICY])
@pytest.mark.parametrize("eligibility", [None, "paid-legacy-v1", "free-legacy-v1"])
def test_unselected_historical_revision_delegates_exact_result_without_querying_new_inventory(
    policy: str, eligibility: str | None
) -> None:
    service, dependencies, evidence, historical = facade(policy=policy)
    assert service.inventory("tenant", "old-v1", eligibility_policy_version=eligibility) is historical.value
    assert service.readiness("tenant", "old-v1", eligibility_policy_version=eligibility) is historical.value
    assert historical.calls == [("inventory", "old-v1", eligibility), ("readiness", "old-v1", eligibility)]
    assert dependencies.callers == evidence.calls == evidence.target_calls == []


def test_new_revision_uses_only_exact_saved_system_dependencies_not_display_allowlist() -> None:
    value = saved()
    byok = replace(value.required[0], owner="custom", model="own-model")
    service, dependencies, evidence, historical = facade(replace(value, excluded=(byok,)))
    result = service.inventory("tenant", "new-v2")
    assert evidence.calls == [(RequiredSavedCreditModel(PROVIDER, "llm", "chosen", ("paid",)),)]
    assert dependencies.callers == [AdmittedModelDependencyCaller("tenant", "new-v2")]
    assert result["model_count"] == 1
    assert result["inventory_policy"] == "saved_system_dependencies_v1"
    assert historical.calls == []


def test_missing_actual_saved_model_evidence_fails_closed() -> None:
    service, _, evidence, _ = facade()
    evidence.omit_model = True
    with pytest.raises(ModelDependencyInventoryError, match="source_evidence_incomplete"):
        service.inventory("tenant", "new-v2")


def test_dynamic_unresolved_dependency_blocks_before_any_source_or_target_check() -> None:
    problem = ModelDependencyProblem("workflow", "app", "draft", "nodes.agent.model", "dynamic_system_model_unresolved")
    service, _, evidence, _ = facade(replace(saved(), problems=(problem,)))
    with pytest.raises(ModelDependencyInventoryError, match="dependencies_unresolved"):
        service.readiness("tenant", "new-v2")
    assert evidence.calls == evidence.target_calls == []


def test_positive_empty_configuration_still_requires_target_protocol_and_credential_readiness() -> None:
    service, _, evidence, _ = facade(replace(saved(), required=()))
    result = service.readiness("tenant", "new-v2")
    assert result["model_count"] == 0
    assert result["credential_fingerprint"] == "sha256:managed-fingerprint"
    assert len(evidence.target_calls) == 1


def test_saved_configuration_snapshot_change_invalidates_new_hash_without_rebinding_old_revision() -> None:
    service, dependencies, _, _ = facade()
    old = service.inventory("tenant", "new-v2")["inventory_hash"]
    dependencies.value = replace(dependencies.value, snapshot_digest="sha256:changed")
    assert service.inventory("tenant", "new-v2")["inventory_hash"] != old
    assert service.inventory("tenant", "old-v1")["inventory_hash"] == "historical-hash"


def test_retired_saved_reference_is_reported_without_inventing_a_target_route() -> None:
    value = saved()
    retired = replace(value.required[0], exclusion_reason="retired")
    service, _, evidence, _ = facade(replace(value, required=(), excluded=(retired,)))
    result = service.inventory("tenant", "new-v2")
    assert evidence.calls == [()]
    assert result["retired_saved_sources"]
    assert result["models"] == []


def test_duplicate_or_unknown_revision_policy_is_not_accepted() -> None:
    with pytest.raises(ModelDependencyInventoryError, match="duplicate"):
        facade(policy=json.dumps(json.loads(POLICY) * 2))
