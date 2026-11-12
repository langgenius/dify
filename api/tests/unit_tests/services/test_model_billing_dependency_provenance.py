from dataclasses import dataclass, replace
from typing import Literal

import pytest
from typing_extensions import TypedDict

from services.model_billing_dependency_inventory import ResolvedModelDependency, SavedModelReference
from services.model_billing_dependency_provenance import (
    AccessCheckedSavedModelMigrationIntent,
    ModelDependencyDefault,
    ModelDependencyProviderState,
    ModelDependencyQuota,
    ModelDependencySelectionSnapshot,
    SavedModelDependencyProvenance,
    StableSavedModelMigrationIntent,
    stable_source_ownership,
)

PROVIDER = "langgenius/openai/openai"
REFERENCE = SavedModelReference("classic_app", "app", "old-version", "model", "fixed", PROVIDER, "llm", "gpt-4o-mini")
QUOTAS = (ModelDependencyQuota("paid", "credits", 100, 0), ModelDependencyQuota("trial", "credits", 20, 0))
STATE = ModelDependencyProviderState(PROVIDER, True, True, True, None, QUOTAS, "paid", True)


@dataclass
class Selections:
    state: ModelDependencyProviderState
    defaults: tuple[ModelDependencyDefault, ...] = ()

    def selection_snapshot(self, tenant_id: str) -> ModelDependencySelectionSnapshot:
        del tenant_id
        return ModelDependencySelectionSnapshot((self.state,), self.defaults)


def resolve(
    state: ModelDependencyProviderState = STATE, reference: SavedModelReference = REFERENCE
) -> ResolvedModelDependency:
    return SavedModelDependencyProvenance(selections=Selections(state)).resolve("tenant", (reference,))[0]


def test_cloud_default_is_system_even_with_byok_presence() -> None:
    result = resolve()
    assert result.owner == "shared_credit_pool"
    assert result.pool_types == ("paid",)


def test_explicit_byok_preference_never_becomes_system_redirect() -> None:
    assert resolve(replace(STATE, preferred="custom")).owner == "custom"
    assert resolve(replace(STATE, preferred="custom", trustworthy=False, system_enabled=False)).owner == "custom"
    assert resolve(replace(STATE, preferred="custom", preference_trustworthy=False)).owner == "unknown"


def test_custom_preference_without_custom_config_uses_actual_system_fallback() -> None:
    assert resolve(replace(STATE, preferred="custom", custom_available=False)).owner == "shared_credit_pool"


def test_exhausted_system_falls_back_to_byok_before_migration_but_not_after_cutover() -> None:
    exhausted = tuple(replace(item, used=item.limit) for item in QUOTAS)
    state = replace(STATE, quotas=exhausted, preferred="system")
    assert resolve(state).owner == "custom"
    assert resolve(replace(state, compatibility_route=True)).owner == "shared_credit_pool"


@pytest.mark.parametrize(
    ("pool", "unit", "limit", "expected"),
    [
        ("free", "tokens", 100, "provider_free"),
        ("trial", "tokens", 100, "unmetered"),
        ("paid", "credits", -1, "unmetered"),
    ],
)
def test_independent_free_or_unlimited_is_not_shared_credits(
    pool: Literal["paid", "free", "trial"], unit: str, limit: int, expected: str
) -> None:
    quota = ModelDependencyQuota(pool, unit, limit, 0)
    assert resolve(replace(STATE, quotas=(quota,), current_quota_type=pool)).owner == expected


class StateChanges(TypedDict, total=False, closed=True):
    trustworthy: bool
    installed: bool
    system_enabled: bool
    custom_available: bool


@pytest.mark.parametrize(
    "changes", [{"trustworthy": False}, {"installed": False}, {"system_enabled": False, "custom_available": False}]
)
def test_unproven_or_unavailable_owner_is_not_guessed_byok(changes: StateChanges) -> None:
    assert resolve(replace(STATE, **changes)).owner == "unknown"


def test_saved_system_reference_outside_displayed_hosted_restrictions_still_requires_compatibility() -> None:
    quota = replace(QUOTAS[0], models=(("llm", "other-model"),))
    assert resolve(replace(STATE, quotas=(quota,))).owner == "shared_credit_pool"


def test_v3_exact_credit_access_does_not_reinterpret_historical_v2() -> None:
    state = replace(STATE, quotas=tuple(replace(q, models=(("llm", "gpt-4o-mini"),)) for q in QUOTAS))
    reference = replace(REFERENCE, model="gpt-6-astra")
    snapshot = Selections(state).selection_snapshot("tenant")
    old = StableSavedModelMigrationIntent.resolve_snapshot(snapshot, (reference,))[0]
    denied = AccessCheckedSavedModelMigrationIntent.resolve_snapshot(snapshot, (reference,))[0]
    assert old.migration_intent == "shared_credit_pool"
    assert old.migration_pool_types == ("paid", "trial")
    assert denied.migration_intent == "policy_excluded"
    assert denied.exclusion_reason == "not_in_enabled_finite_credit_pools"
    assert denied.migration_pool_types == denied.pool_types == ()
    assert denied.owner == "unknown"
    assert denied.migration_configuration_digest == old.migration_configuration_digest
    positive = AccessCheckedSavedModelMigrationIntent.resolve_snapshot(snapshot, (REFERENCE,))[0]
    assert positive.migration_intent == "shared_credit_pool"
    assert positive.migration_pool_types == ("paid", "trial")


@pytest.mark.parametrize("models", [(), (("text-embedding", "gpt-4o-mini"),)])
def test_v3_matches_normal_name_only_and_empty_unrestricted_access(models: tuple[tuple[str, str], ...]) -> None:
    state = replace(STATE, quotas=(replace(QUOTAS[0], models=models),))
    result = AccessCheckedSavedModelMigrationIntent(selections=Selections(state)).resolve("tenant", (REFERENCE,))[0]
    assert result.migration_intent == "shared_credit_pool"
    assert result.migration_pool_types == ("paid",)


def test_v3_future_trial_access_is_required_and_usage_is_not_a_policy_change() -> None:
    state = replace(
        STATE,
        quotas=(
            replace(QUOTAS[0], models=(("llm", "other"),)),
            replace(QUOTAS[1], models=(("llm", REFERENCE.model or ""),)),
        ),
    )
    first = AccessCheckedSavedModelMigrationIntent(selections=Selections(state)).resolve("tenant", (REFERENCE,))[0]
    consumed = replace(state, quotas=tuple(replace(q, used=q.limit) for q in state.quotas), current_quota_type="trial")
    second = AccessCheckedSavedModelMigrationIntent(selections=Selections(consumed)).resolve("tenant", (REFERENCE,))[0]
    assert first.migration_pool_types == second.migration_pool_types == ("trial",)
    assert first.migration_intent == second.migration_intent == "shared_credit_pool"
    assert first.migration_configuration_digest == second.migration_configuration_digest
    changed = replace(state, quotas=(replace(state.quotas[0], models=()), state.quotas[1]))
    third = AccessCheckedSavedModelMigrationIntent(selections=Selections(changed)).resolve("tenant", (REFERENCE,))[0]
    assert third.migration_configuration_digest != first.migration_configuration_digest


@pytest.mark.parametrize(
    "state",
    [
        replace(STATE, preferred="custom"),
        replace(STATE, quotas=(ModelDependencyQuota("free", "tokens", 100, 0),), current_quota_type="free"),
        replace(STATE, quotas=(ModelDependencyQuota("paid", "credits", -1, 0),)),
    ],
)
def test_v3_custom_and_independent_owners_remain_exactly_historical(state: ModelDependencyProviderState) -> None:
    snapshot = Selections(state).selection_snapshot("tenant")
    assert AccessCheckedSavedModelMigrationIntent.resolve_snapshot(
        snapshot, (REFERENCE,)
    ) == StableSavedModelMigrationIntent.resolve_snapshot(snapshot, (REFERENCE,))


@pytest.mark.parametrize(
    "state",
    [
        replace(STATE, trustworthy=False),
        replace(STATE, preference_trustworthy=False),
        replace(STATE, installed=False),
        replace(STATE, system_enabled=False, custom_available=False),
    ],
)
def test_v3_cannot_use_denied_name_to_exempt_unproven_source(state: ModelDependencyProviderState) -> None:
    reference = replace(REFERENCE, model="gpt-6-astra")
    result = AccessCheckedSavedModelMigrationIntent(selections=Selections(state)).resolve("tenant", (reference,))[0]
    assert result.migration_intent == "unknown"
    assert result.exclusion_reason is None


def test_v3_dynamic_selection_does_not_become_a_policy_exclusion() -> None:
    reference = replace(REFERENCE, kind="dynamic", model=None)
    result = AccessCheckedSavedModelMigrationIntent(selections=Selections(STATE)).resolve("tenant", (reference,))[0]
    assert result.migration_intent == "unknown"
    assert result.exclusion_reason is None


def test_workspace_default_is_exact_saved_default_no_first_model_fallback() -> None:
    reference = replace(REFERENCE, kind="tenant_default", provider=None, model=None)
    assert resolve(reference=reference).owner == "unknown"
    service = SavedModelDependencyProvenance(
        selections=Selections(STATE, (ModelDependencyDefault("llm", PROVIDER, "chosen"),))
    )
    result = service.resolve("tenant", (reference,))[0]
    assert result.model == "chosen"
    assert result.owner == "shared_credit_pool"


def test_stored_credential_id_without_owner_proof_cannot_mint_byok_exemption() -> None:
    assert resolve(reference=replace(REFERENCE, credential_id="unverified")).owner == "unknown"


def stable_resolve(state: ModelDependencyProviderState) -> ResolvedModelDependency:
    return StableSavedModelMigrationIntent(selections=Selections(state)).resolve("tenant", (REFERENCE,))[0]


def test_v2_intent_survives_paid_trial_consumption_and_temporary_byok_without_faking_actual_owner() -> None:
    paid = replace(STATE, quotas=(replace(QUOTAS[0], used=5), QUOTAS[1]))
    trial = replace(
        STATE, quotas=(replace(QUOTAS[0], used=100), replace(QUOTAS[1], used=3)), current_quota_type="trial"
    )
    byok = replace(STATE, quotas=tuple(replace(item, used=item.limit) for item in QUOTAS), current_quota_type="trial")
    records = [stable_resolve(state) for state in (paid, trial, byok)]
    assert [(item.owner, item.pool_types) for item in records] == [
        ("shared_credit_pool", ("paid",)),
        ("shared_credit_pool", ("trial",)),
        ("custom", ()),
    ]
    assert {item.migration_intent for item in records} == {"shared_credit_pool"}
    assert {item.migration_pool_types for item in records} == {("paid", "trial")}
    assert len({item.migration_configuration_digest for item in records}) == 1
    assert stable_source_ownership(paid) == stable_source_ownership(trial) == stable_source_ownership(byok)


def test_v2_independent_free_is_reported_as_free_but_finite_fallback_still_requires_the_saved_model() -> None:
    free = ModelDependencyQuota("free", "credits", 10, 1)
    before = replace(STATE, quotas=(free, QUOTAS[1]), current_quota_type="free")
    after = replace(before, quotas=(replace(free, used=10), QUOTAS[1]), current_quota_type="trial")
    first, second = stable_resolve(before), stable_resolve(after)
    assert first.owner == "provider_free"
    assert first.pool_types == ()
    assert second.owner == "shared_credit_pool"
    assert second.pool_types == ("trial",)
    assert first.migration_pool_types == second.migration_pool_types == ("trial",)
    assert first.migration_configuration_digest == second.migration_configuration_digest
    assert stable_source_ownership(before) == stable_source_ownership(after)


def test_v2_missing_custom_configuration_is_not_a_byok_exemption_from_actual_system_fallback() -> None:
    record = stable_resolve(replace(STATE, preferred="custom", custom_available=False))
    assert record.owner == "shared_credit_pool"  # Existing actual runtime fallback, truthfully reported.
    assert record.migration_intent == "shared_credit_pool"
    assert record.migration_pool_types == ("paid", "trial")
    configured_byok = stable_resolve(replace(STATE, preferred="custom", custom_available=True))
    assert configured_byok.owner == "custom"
    assert configured_byok.migration_intent == "custom"
    assert configured_byok.migration_pool_types == ()


def test_v2_missing_custom_system_fallback_survives_managed_metadata_closure_without_lying_about_actual_owner() -> None:
    before = replace(STATE, preferred="custom", custom_available=False)
    processing = replace(
        before,
        compatibility_route=True,
        managed_system_fallback=True,
        quotas=tuple(replace(quota, limit=0, used=0) for quota in QUOTAS),
    )
    first, second = stable_resolve(before), stable_resolve(processing)
    assert first.owner == second.owner == "shared_credit_pool"
    assert first.migration_intent == second.migration_intent == "shared_credit_pool"
    assert first.migration_configuration_digest == second.migration_configuration_digest


def test_v2_unlimited_owner_stays_independent_and_only_masks_lower_priority_shared_pools() -> None:
    paid_unlimited = replace(STATE, quotas=(replace(QUOTAS[0], limit=-1), QUOTAS[1]))
    record = stable_resolve(paid_unlimited)
    assert record.owner == "unmetered"
    assert record.migration_intent == "independent"
    assert record.migration_pool_types == ()
    trial_unlimited = replace(
        STATE, quotas=(replace(QUOTAS[0], used=100), replace(QUOTAS[1], limit=-1)), current_quota_type="trial"
    )
    record = stable_resolve(trial_unlimited)
    assert record.owner == "unmetered"  # Never relabel current unmetered traffic as charged credits.
    assert record.migration_intent == "shared_credit_pool"
    assert record.migration_pool_types == ("paid",)


def test_v2_money_amounts_are_not_configuration_but_explicit_preferences_bindings_and_models_are() -> None:
    original = stable_resolve(STATE).migration_configuration_digest
    resized = replace(STATE, quotas=(replace(QUOTAS[0], limit=1000, used=99), replace(QUOTAS[1], limit=50)))
    assert stable_resolve(resized).migration_configuration_digest == original
    assert stable_resolve(replace(STATE, preferred="system")).migration_configuration_digest != original
    assert (
        stable_resolve(replace(STATE, source_plugin_unique_identifier="new-immutable")).migration_configuration_digest
        != original
    )
    assert (
        stable_resolve(
            replace(STATE, quotas=(replace(QUOTAS[0], models=(("llm", "changed"),)), QUOTAS[1]))
        ).migration_configuration_digest
        != original
    )
