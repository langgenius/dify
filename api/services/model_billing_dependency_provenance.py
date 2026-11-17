"""Read-only credential-selection policy for saved model dependencies.

Facts come from provider owners, never encrypted credential values. This mirrors
the normal provider preference/fallback order; it does not turn a deployment
allowlist or a saved `credential_ref` into evidence of paid SYSTEM usage.
"""

import hashlib
import json
from collections.abc import Sequence
from dataclasses import dataclass, replace
from typing import Literal, Protocol

from services.model_billing_dependency_inventory import ResolvedModelDependency, SavedModelReference


@dataclass(frozen=True, slots=True)
class ModelDependencyQuota:
    pool_type: Literal["paid", "free", "trial"]
    unit: str
    limit: int
    used: int
    # Preserved as source-selection evidence, not a proof that a saved model
    # is callable. get_current_credentials uses these to bind base_model_name;
    # it does not reject direct saved references outside a HOSTED listing.
    models: tuple[tuple[str, str], ...] = ()

    @property
    def valid(self) -> bool:
        return self.limit == -1 or self.limit > self.used


@dataclass(frozen=True, slots=True)
class ModelDependencyProviderState:
    provider: str
    installed: bool
    system_enabled: bool
    custom_available: bool
    preferred: Literal["system", "custom"] | None
    quotas: tuple[ModelDependencyQuota, ...]
    current_quota_type: str | None
    cloud: bool
    compatibility_route: bool = False
    native_tokener: bool = False
    # Duplicate/malformed provider preference or ambiguous immutable binding.
    trustworthy: bool = True
    preference_trustworthy: bool = True
    source_plugin_unique_identifier: str | None = None
    managed_system_fallback: bool = False


@dataclass(frozen=True, slots=True)
class ModelDependencyDefault:
    model_type: str
    provider: str
    model: str


@dataclass(frozen=True, slots=True)
class ModelDependencySelectionSnapshot:
    providers: tuple[ModelDependencyProviderState, ...]
    defaults: tuple[ModelDependencyDefault, ...]


@dataclass(frozen=True, slots=True)
class StoredDependencyProvider:
    provider: str
    provider_type: str
    quota_type: str | None
    quota_limit: int | None
    quota_used: int | None


@dataclass(frozen=True, slots=True)
class StoredDependencyPreference:
    provider: str
    preferred: str


@dataclass(frozen=True, slots=True)
class StoredModelDependencySelections:
    providers: tuple[StoredDependencyProvider, ...]
    preferences: tuple[StoredDependencyPreference, ...]
    custom_model_providers: tuple[str, ...]
    defaults: tuple[ModelDependencyDefault, ...]
    pools: tuple[tuple[str, int, int], ...]
    billing_source: str | None


class ModelDependencySelectionQuery(Protocol):
    def selection_snapshot(self, tenant_id: str) -> ModelDependencySelectionSnapshot:
        """Materialize non-secret source-selection facts; fail on read errors."""
        ...


class SavedModelDependencyProvenance:
    def __init__(self, *, selections: ModelDependencySelectionQuery) -> None:
        self._selections = selections

    def resolve(self, tenant_id: str, references: Sequence[SavedModelReference]) -> Sequence[ResolvedModelDependency]:
        snapshot = self._selections.selection_snapshot(tenant_id)
        return self.resolve_snapshot(snapshot, references)

    @staticmethod
    def resolve_snapshot(
        snapshot: ModelDependencySelectionSnapshot, references: Sequence[SavedModelReference]
    ) -> Sequence[ResolvedModelDependency]:
        providers = {provider.provider: provider for provider in snapshot.providers}
        defaults = {default.model_type: default for default in snapshot.defaults}
        if len(providers) != len(snapshot.providers) or len(defaults) != len(snapshot.defaults):
            # Ambiguous selection facts cannot attest BYOK or credits ownership.
            return tuple(_unknown(reference) for reference in references)
        return tuple(
            SavedModelDependencyProvenance._resolve(reference, providers, defaults) for reference in references
        )

    @staticmethod
    def _resolve(
        reference: SavedModelReference,
        providers: dict[str, ModelDependencyProviderState],
        defaults: dict[str, ModelDependencyDefault],
    ) -> ResolvedModelDependency:
        provider, model, model_type = reference.provider, reference.model, reference.model_type
        if reference.kind == "tenant_default":
            default = defaults.get(model_type or "")
            if default is None:
                return _unknown(reference)
            provider, model = default.provider, default.model
        state = providers.get(provider or "")
        if state is None or not state.installed or not state.preference_trustworthy:
            return _unknown(reference, provider=provider, model=model)
        # An explicit credential selection is only populated by an owner whose
        # actual runtime consumes that credential ID. Ownership still needs a
        # separately verified tenant-scoped credential fact; do not guess BYOK.
        if reference.credential_id is not None:
            return _unknown(reference, provider=provider, model=model)
        if state.native_tokener and not state.compatibility_route:
            preferred = "custom"
        elif state.preferred is not None:
            preferred = state.preferred
        elif state.cloud and state.system_enabled:
            preferred = "system"
        elif state.custom_available:
            preferred = "custom"
        elif state.system_enabled:
            preferred = "system"
        else:
            preferred = "custom"
        quota = next((quota for quota in state.quotas if quota.pool_type == state.current_quota_type), None)
        managed_pool = state.compatibility_route and quota is not None and _shared(quota)
        has_valid_quota = any(quota.valid for quota in state.quotas)
        selected = preferred
        if preferred == "system":
            if not state.system_enabled or not state.quotas:
                if not state.compatibility_route:
                    selected = "custom"
            elif not has_valid_quota and not managed_pool and state.custom_available:
                selected = "custom"
        elif (
            not state.custom_available
            and state.system_enabled
            and (has_valid_quota or state.managed_system_fallback and managed_pool)
        ):
            selected = "system"
        if selected == "custom":
            # CUSTOM without any configuration is unavailable, not proof that
            # a saved SYSTEM dependency can safely be omitted from migration.
            owner = "custom" if state.custom_available else "unknown"
            return ResolvedModelDependency(reference, owner, provider, model_type, model)
        if not state.trustworthy or not state.system_enabled or quota is None:
            return _unknown(reference, provider=provider, model=model)
        if quota.limit == -1:
            return ResolvedModelDependency(reference, "unmetered", provider, model_type, model)
        if quota.pool_type == "free":
            return ResolvedModelDependency(reference, "provider_free", provider, model_type, model)
        if not _shared(quota):
            return ResolvedModelDependency(reference, "unmetered", provider, model_type, model)
        # The current credentials owner, not a displayed HOSTED allowlist,
        # settles an existing direct App request. Source schema/readiness later
        # proves actual model support; absent models remain required blockers.
        return ResolvedModelDependency(reference, "shared_credit_pool", provider, model_type, model, (quota.pool_type,))


class StableSavedModelMigrationIntent:
    """Configuration capability, never a claim about the request's paid usage."""

    def __init__(self, *, selections: ModelDependencySelectionQuery) -> None:
        self._selections = selections

    def resolve(self, tenant_id: str, references: Sequence[SavedModelReference]) -> Sequence[ResolvedModelDependency]:
        return self.resolve_snapshot(self._selections.selection_snapshot(tenant_id), references)

    @staticmethod
    def resolve_snapshot(
        snapshot: ModelDependencySelectionSnapshot, references: Sequence[SavedModelReference]
    ) -> Sequence[ResolvedModelDependency]:
        actual = SavedModelDependencyProvenance.resolve_snapshot(snapshot, references)
        providers = {item.provider: item for item in snapshot.providers}
        if len(providers) != len(snapshot.providers):
            return tuple(replace(item, migration_intent="unknown") for item in actual)
        result: list[ResolvedModelDependency] = []
        for item in actual:
            state = providers.get(item.provider or "")
            if (
                state is None
                or not state.installed
                or not state.preference_trustworthy
                or item.reference.credential_id
                or len({quota.pool_type for quota in state.quotas}) != len(state.quotas)
            ):
                result.append(replace(item, migration_intent="unknown"))
                continue
            configured_preference = (
                "custom"
                if state.native_tokener and not state.compatibility_route
                else state.preferred
                or (
                    "system"
                    if state.cloud and state.system_enabled
                    else "custom"
                    if state.custom_available
                    else "system"
                    if state.system_enabled
                    else "custom"
                )
            )
            pools = stable_shared_pool_types(state)
            if configured_preference == "custom" and state.custom_available:
                intent = "custom"
            elif not state.trustworthy or not state.system_enabled or not state.quotas:
                intent = "unknown"
            else:
                intent = "shared_credit_pool" if pools else "independent"
            result.append(
                replace(
                    item,
                    migration_intent=intent,
                    migration_pool_types=pools if intent == "shared_credit_pool" else (),
                    migration_configuration_digest=stable_selection_digest(state),
                )
            )
        return tuple(result)


class AccessCheckedSavedModelMigrationIntent:
    """V3 only: finite capability must also pass normal ModelManager access.

    Match exact names, not model types; an empty restriction list is unrestricted.
    Historical v1/v2 resolution and fingerprints are deliberately unchanged.
    """

    def __init__(self, *, selections: ModelDependencySelectionQuery) -> None:
        self._selections = selections

    def resolve(self, tenant_id: str, references: Sequence[SavedModelReference]) -> Sequence[ResolvedModelDependency]:
        return self.resolve_snapshot(self._selections.selection_snapshot(tenant_id), references)

    @staticmethod
    def resolve_snapshot(
        snapshot: ModelDependencySelectionSnapshot, references: Sequence[SavedModelReference]
    ) -> Sequence[ResolvedModelDependency]:
        original = StableSavedModelMigrationIntent.resolve_snapshot(snapshot, references)
        providers = {item.provider: item for item in snapshot.providers}
        result: list[ResolvedModelDependency] = []
        for item in original:
            if item.migration_intent != "shared_credit_pool":
                result.append(item)
                continue
            if item.reference.kind == "dynamic" or not item.model or not item.model_type:
                result.append(replace(item, migration_intent="unknown"))
                continue
            state = providers[item.provider or ""]
            allowed = tuple(
                quota.pool_type
                for quota in state.quotas
                if quota.pool_type in item.migration_pool_types
                and (not quota.models or any(name == item.model for _, name in quota.models))
            )
            # Actual current access may be denied even though a later pool is
            # allowed. Do not label that unavailable request as paid usage.
            current = next((quota for quota in state.quotas if quota.pool_type == state.current_quota_type), None)
            if (
                item.owner == "shared_credit_pool"
                and current
                and current.models
                and all(name != item.model for _, name in current.models)
            ):
                item = replace(item, owner="unknown", pool_types=())
            result.append(
                replace(item, migration_pool_types=tuple(sorted(allowed)))
                if allowed
                else replace(
                    item,
                    migration_intent="policy_excluded",
                    migration_pool_types=(),
                    exclusion_reason="not_in_enabled_finite_credit_pools",
                )
            )
        return tuple(result)


def stable_shared_pool_types(state: ModelDependencyProviderState) -> tuple[str, ...]:
    """Finite shared pools that can become active without changing config.

    Paid > independent FREE > trial. A permanently valid unlimited pool masks
    only lower-priority pools; finite FREE may exhaust and never masks fallback.
    Zero/exhausted finite balances still establish capability, not funds.
    """
    priority = {"paid": 0, "free": 1, "trial": 2}
    permanent = min((priority[item.pool_type] for item in state.quotas if item.limit == -1), default=3)
    return tuple(
        item.pool_type
        for item in sorted(state.quotas, key=lambda item: priority[item.pool_type])
        if _shared(item) and priority[item.pool_type] < permanent
    )


def stable_selection_digest(state: ModelDependencyProviderState) -> str:
    payload = {
        "provider": state.provider,
        "installed": state.installed,
        "system_enabled": state.system_enabled,
        "custom_available": state.custom_available,
        "preferred": state.preferred,
        "cloud": state.cloud,
        "native_without_compatibility": state.native_tokener and not state.compatibility_route,
        "trustworthy": state.trustworthy,
        "preference_trustworthy": state.preference_trustworthy,
        "source_plugin_uid": state.source_plugin_unique_identifier,
        "quotas": [
            {
                "pool_type": item.pool_type,
                "unit": item.unit,
                "unmetered": item.limit == -1,
                "models": [list(model) for model in sorted(item.models)],
            }
            for item in sorted(state.quotas, key=lambda item: item.pool_type)
        ],
    }
    return (
        "sha256:"
        + hashlib.sha256(
            json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
        ).hexdigest()
    )


def stable_source_ownership(state: ModelDependencyProviderState) -> dict[str, object]:
    """Explicit v2 structural authority; no selected pool or spendable amount."""
    return {
        "schema_version": 2,
        "shared_pool_types": list(stable_shared_pool_types(state)),
        "quotas": {quota.pool_type: {"unit": quota.unit, "unmetered": quota.limit == -1} for quota in state.quotas},
    }


def _shared(quota: ModelDependencyQuota) -> bool:
    return quota.pool_type in {"trial", "paid"} and quota.limit != -1 and quota.unit in {"credits", "times"}


def _unknown(
    reference: SavedModelReference, *, provider: str | None = None, model: str | None = None
) -> ResolvedModelDependency:
    return ResolvedModelDependency(
        reference, "unknown", provider or reference.provider, reference.model_type, model or reference.model
    )
