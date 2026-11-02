"""Real application admission with detached ownership records and no daemon writes."""

from collections.abc import Sequence
from dataclasses import dataclass, field, replace

import pytest

from services.model_billing_dependency_inventory import (
    AdmittedModelDependencyCaller,
    ModelDependencyProblem,
    ResolvedModelDependency,
    SavedModelReference,
    SavedSystemDependencyInventory,
    SettlementOwner,
)
from services.model_billing_source_plugin_admission import (
    ModelBillingSourcePluginAdmission,
    SourcePluginAdmissionError,
    SourcePluginProtection,
)
from services.plugin.installation_service import AdmittedPluginInstallationCaller

TENANT = "11111111-1111-1111-1111-111111111111"
UID = "langgenius/openai:1.1.0@" + "a" * 64


@dataclass
class Routes:
    route: SourcePluginProtection | None
    tenants: list[str] = field(default_factory=list)

    def get_protection(self, tenant_id: str) -> SourcePluginProtection | None:
        self.tenants.append(tenant_id)
        return self.route


@dataclass
class Inventories:
    value: SavedSystemDependencyInventory
    tenants: list[str] = field(default_factory=list)

    def collect(self, caller: AdmittedModelDependencyCaller) -> SavedSystemDependencyInventory:
        self.tenants.append(caller.tenant_id)
        return self.value


@dataclass
class Contracts:
    approved: bool
    calls: list[tuple[SourcePluginProtection, tuple[str, ...], tuple[ResolvedModelDependency, ...]]] = field(
        default_factory=list
    )
    freezes: list[tuple[str, tuple[str, ...]]] = field(default_factory=list)
    installed_models: frozenset[str] = frozenset({"langgenius/openai"})
    binding_reads: list[str] = field(default_factory=list)

    def installed_model_plugins(self, tenant_id: str, candidate_uids: Sequence[str]) -> frozenset[str]:
        self.binding_reads.append(tenant_id)
        return self.installed_models.intersection(uid.split(":", 1)[0] for uid in candidate_uids)

    def assert_frozen_bindings(self, tenant_id: str, candidate_uids: Sequence[str]) -> None:
        self.freezes.append((tenant_id, tuple(candidate_uids)))

    def assert_compatible(
        self,
        route: SourcePluginProtection,
        candidate_uids: Sequence[str],
        dependencies: Sequence[ResolvedModelDependency],
    ) -> None:
        self.calls.append((route, tuple(candidate_uids), tuple(dependencies)))
        if not self.approved:
            raise SourcePluginAdmissionError("source_plugin_replacement_not_reviewed")


def dependency(owner: SettlementOwner = "shared_credit_pool") -> ResolvedModelDependency:
    reference = SavedModelReference(
        "workflow", "app-1", "published-v1", "nodes.0.model", "fixed", "langgenius/openai/openai", "llm", "gpt-4o-mini"
    )
    return ResolvedModelDependency(
        reference, owner, reference.provider, reference.model_type, reference.model, ("paid",)
    )  # type: ignore[arg-type]


def inventory(
    *, owner: SettlementOwner = "shared_credit_pool", problem: bool = False
) -> SavedSystemDependencyInventory:
    item = dependency(owner)
    return SavedSystemDependencyInventory(
        TENANT,
        (item,) if owner == "shared_credit_pool" else (),
        () if owner == "shared_credit_pool" else (item,),
        (ModelDependencyProblem("workflow", "app-1", "published-v1", "nodes.0.model", "model_owner_unresolved"),)
        if problem
        else (),
        "sha256:" + "b" * 64,
    )


def service(
    *,
    active: bool = True,
    owner: SettlementOwner = "shared_credit_pool",
    approved: bool = False,
    problem: bool = False,
    pre_admitted_tenants: frozenset[str] = frozenset(),
) -> tuple[ModelBillingSourcePluginAdmission, Routes, Inventories, Contracts]:
    routes = Routes(SourcePluginProtection(TENANT, "frozen-v1", 1) if active else None)
    inventories = Inventories(inventory(owner=owner, problem=problem))
    contracts = Contracts(approved)
    return (
        ModelBillingSourcePluginAdmission(
            routes=routes, dependencies=inventories, candidates=contracts, pre_admitted_tenants=pre_admitted_tenants
        ),
        routes,
        inventories,
        contracts,
    )


def test_legacy_and_never_activated_tenant_do_not_query_inventory_or_daemon() -> None:
    admission, routes, inventories, contracts = service(active=False)
    admission.assert_allowed(AdmittedPluginInstallationCaller(TENANT), (UID,))
    assert routes.tenants == [TENANT]
    assert inventories.tenants == []
    assert contracts.calls == []


def test_admitted_cohort_is_frozen_even_before_migration_row_exists() -> None:
    admission, _, inventories, contracts = service(active=False, pre_admitted_tenants=frozenset({TENANT}))
    admission.assert_allowed(AdmittedPluginInstallationCaller(TENANT), (UID,))
    assert contracts.freezes == [(TENANT, (UID,))]
    assert inventories.tenants == []
    assert contracts.calls == []


def test_durable_pre_migration_freeze_survives_process_allowlist_removal() -> None:
    admission, routes, inventories, contracts = service()
    routes.route = SourcePluginProtection(TENANT, "frozen-v1", 0, pre_migration_freeze=True)
    admission.assert_allowed(AdmittedPluginInstallationCaller(TENANT), (UID,))
    assert contracts.freezes == [(TENANT, (UID,))]
    assert inventories.tenants == []
    assert contracts.calls == []


def test_active_route_uses_reviewed_profiles_not_blanket_pre_cohort_freeze() -> None:
    admission, _, _, contracts = service(approved=True, pre_admitted_tenants=frozenset({TENANT}))
    admission.assert_allowed(AdmittedPluginInstallationCaller(TENANT), (UID,))
    assert len(contracts.calls) == 1
    assert contracts.freezes == []


@pytest.mark.parametrize("owner", ["custom", "provider_free", "unmetered"])
def test_byok_and_independent_free_only_dependencies_are_unaffected(owner: SettlementOwner) -> None:
    admission, _, _, contracts = service(owner=owner)
    admission.assert_allowed(AdmittedPluginInstallationCaller(TENANT), (UID,))
    assert contracts.calls == []


def test_unrelated_tool_plugin_is_not_blocked_by_system_model_dependency() -> None:
    admission, _, _, contracts = service()
    admission.assert_allowed(AdmittedPluginInstallationCaller(TENANT), ("langgenius/time:1.0.0@" + "c" * 64,))
    assert contracts.calls == []


def test_unrelated_tool_requires_current_inventory_and_fresh_model_binding_proof() -> None:
    admission, routes, inventories, contracts = service(problem=True)
    routes.route = SourcePluginProtection(TENANT, "frozen-v1", 1, ("langgenius/openai",))
    admission.assert_allowed(AdmittedPluginInstallationCaller(TENANT), ("langgenius/time:1.0.0@" + "c" * 64,))
    assert inventories.tenants == [TENANT]
    assert contracts.binding_reads == [TENANT]
    assert contracts.calls == []


def test_unresolved_inventory_is_not_treated_as_byok() -> None:
    admission, _, _, contracts = service(problem=True)
    with pytest.raises(SourcePluginAdmissionError, match="dependencies_unresolved"):
        admission.assert_allowed(AdmittedPluginInstallationCaller(TENANT), (UID,))
    assert contracts.calls == []


def test_known_unrelated_source_problem_does_not_block_another_provider() -> None:
    admission, _, inventories, contracts = service(problem=True)
    problem = replace(inventories.value.problems[0], provider="langgenius/openai/openai")
    inventories.value = replace(inventories.value, problems=(problem,))
    admission.assert_allowed(AdmittedPluginInstallationCaller(TENANT), ("langgenius/anthropic:0.3.39@" + "f" * 64,))
    assert contracts.calls == []


def test_malformed_problem_provider_is_not_evidence_of_unrelated_ownership() -> None:
    admission, _, inventories, contracts = service(problem=True)
    problem = replace(inventories.value.problems[0], provider="unknown")
    inventories.value = replace(inventories.value, problems=(problem,))
    with pytest.raises(SourcePluginAdmissionError, match="dependencies_unresolved"):
        admission.assert_allowed(AdmittedPluginInstallationCaller(TENANT), (UID,))
    assert contracts.calls == []


def test_exact_frozen_revision_and_only_affected_system_dependencies_reach_proof_owner() -> None:
    admission, _, _, contracts = service(approved=True)
    admission.assert_allowed(AdmittedPluginInstallationCaller(TENANT), (UID,))
    assert contracts.calls == [(SourcePluginProtection(TENANT, "frozen-v1", 1), (UID,), (dependency(),))]


def test_unknown_source_candidate_is_rejected() -> None:
    admission, _, _, _ = service()
    with pytest.raises(SourcePluginAdmissionError, match="not_reviewed"):
        admission.assert_allowed(AdmittedPluginInstallationCaller(TENANT), (UID,))
