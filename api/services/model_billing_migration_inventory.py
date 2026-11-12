"""Revision-dispatched migration inventory; historical revisions stay unchanged.

The new policy admits saved SYSTEM-credit dependencies rather than treating the
deployment model display allowlist as tenant usage. Source and target evidence
remain mandatory; no user/App/provider configuration or old hash is rewritten.
"""

import hashlib
import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

from services.model_billing_dependency_inventory import (
    AdmittedModelDependencyCaller,
    DependencyInventoryPolicy,
    ModelDependencyInventoryError,
    SavedSystemDependencyInventory,
    stable_dependency_inventory_policy,
)


class SavedDependencyInventoryDeclaration(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)

    schema_version: Literal[1]
    mapping_revision: str = Field(min_length=1)
    inventory_policy: DependencyInventoryPolicy


@dataclass(frozen=True, slots=True)
class RequiredSavedCreditModel:
    provider: str
    model_type: str
    model: str
    pool_types: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class SavedDependencySourceEvidence:
    models: tuple[Mapping[str, object], ...]
    source_ownership: Mapping[str, object]
    unavailable_sources: tuple[Mapping[str, object], ...] = ()
    source_policy_digest: str | None = None
    source_variant_registry_digest: str | None = None
    prospective_variants: tuple[Mapping[str, object], ...] = ()


@dataclass(frozen=True, slots=True)
class ManagedModelReadinessBinding:
    credential_id: str
    plugin_unique_identifier: str
    credential_fingerprint: str


class MigrationInventoryEvidence(Protocol):
    def sources(
        self,
        tenant_id: str,
        revision: str,
        models: Sequence[RequiredSavedCreditModel],
        *,
        inventory_policy: DependencyInventoryPolicy = "saved_system_dependencies_v1",
        source_ownership_providers: tuple[str, ...] = (),
        # None is historical v1/v2; v3 requires even an explicit empty mapping.
        expected_selection_digests: Mapping[str, str] | None = None,
    ) -> SavedDependencySourceEvidence: ...

    def validate_target(self, tenant_id: str, revision: str, inventory: Mapping[str, object]) -> str:
        """Validate immutable target/credential/schema pins; return fingerprint."""
        ...


class SavedMigrationDependencies(Protocol):
    def collect(self, caller: AdmittedModelDependencyCaller) -> SavedSystemDependencyInventory: ...


class HistoricalMigrationInventory(Protocol):
    def inventory(self, tenant_id: str, revision: str, eligibility: str | None) -> dict[str, object]: ...

    def readiness(self, tenant_id: str, revision: str, eligibility: str | None) -> dict[str, object]: ...


class ModelBillingReadinessQuery(Protocol):
    def readiness(
        self, tenant_id: str, revision: str, *, eligibility_policy_version: str | None = None
    ) -> dict[str, object]: ...


def dependency_inventory_uses_saved_policy(policy_json: str, revision: str) -> bool:
    declarations = TypeAdapter(list[SavedDependencyInventoryDeclaration]).validate_json(policy_json)
    if len({item.mapping_revision for item in declarations}) != len(declarations):
        raise ModelDependencyInventoryError("duplicate_dependency_inventory_revision")
    return any(item.mapping_revision == revision for item in declarations)


def saved_dependency_inventory_policy(policy_json: str, revision: str | None) -> DependencyInventoryPolicy:
    declarations = TypeAdapter(list[SavedDependencyInventoryDeclaration]).validate_json(policy_json)
    if len({item.mapping_revision for item in declarations}) != len(declarations):
        raise ModelDependencyInventoryError("duplicate_dependency_inventory_revision")
    return next(
        (item.inventory_policy for item in declarations if item.mapping_revision == revision),
        "saved_system_dependencies_v1",
    )


def _hash(value: object) -> str:
    return (
        "sha256:"
        + hashlib.sha256(
            json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
        ).hexdigest()
    )


class ModelBillingMigrationInventory:
    def __init__(
        self,
        *,
        dependencies: SavedMigrationDependencies,
        evidence: MigrationInventoryEvidence,
        historical: HistoricalMigrationInventory,
        policy_json: str,
    ) -> None:
        self._dependencies, self._evidence, self._historical = dependencies, evidence, historical
        declarations = TypeAdapter(list[SavedDependencyInventoryDeclaration]).validate_json(policy_json)
        if len({item.mapping_revision for item in declarations}) != len(declarations):
            raise ModelDependencyInventoryError("duplicate_dependency_inventory_revision")
        self._policies = {item.mapping_revision: item for item in declarations}

    def inventory(
        self, tenant_id: str, revision: str, *, eligibility_policy_version: str | None = None
    ) -> dict[str, object]:
        policy = self._policies.get(revision)
        if policy is None:
            return self._historical.inventory(tenant_id, revision, eligibility_policy_version)
        caller = AdmittedModelDependencyCaller(
            tenant_id,
            revision,
            policy.inventory_policy if stable_dependency_inventory_policy(policy.inventory_policy) else None,
        )
        saved = self._dependencies.collect(caller)
        if saved.tenant_id != tenant_id or saved.problems:
            raise ModelDependencyInventoryError("saved_system_dependencies_unresolved")
        required: dict[tuple[str, str, str], set[str]] = {}
        for item in saved.required:
            if item.provider is None or item.model_type is None or item.model is None:
                raise ModelDependencyInventoryError("saved_system_dependencies_unresolved")
            pools = (
                item.migration_pool_types
                if stable_dependency_inventory_policy(policy.inventory_policy)
                else item.pool_types
            )
            required.setdefault((item.provider, item.model_type, item.model), set()).update(pools)
        models = tuple(
            RequiredSavedCreditModel(provider, kind, model, tuple(sorted(pools)))
            for (provider, kind, model), pools in sorted(required.items())
        )
        selection_digests: dict[str, str] = {}
        if policy.inventory_policy == "saved_system_dependencies_v3":
            for item in [*saved.required, *saved.excluded]:
                if item.migration_intent not in {"shared_credit_pool", "custom", "independent", "policy_excluded"}:
                    continue
                if (
                    not item.provider
                    or not item.migration_configuration_digest.startswith("sha256:")
                    or item.provider in selection_digests
                    and selection_digests[item.provider] != item.migration_configuration_digest
                ):
                    raise ModelDependencyInventoryError("dependency_selection_digest_missing_or_conflicting")
                selection_digests[item.provider] = item.migration_configuration_digest
        evidence = (
            self._evidence.sources(
                tenant_id,
                revision,
                models,
                inventory_policy=policy.inventory_policy,
                source_ownership_providers=tuple(
                    sorted(
                        {
                            item.provider
                            for item in [*saved.required, *saved.excluded]
                            if item.provider is not None
                            and item.migration_intent in {"shared_credit_pool", "independent", "policy_excluded"}
                        }
                    )
                ),
                expected_selection_digests=selection_digests,
            )
            if policy.inventory_policy == "saved_system_dependencies_v3"
            else (
                self._evidence.sources(
                    tenant_id,
                    revision,
                    models,
                    inventory_policy=policy.inventory_policy,
                    source_ownership_providers=tuple(
                        sorted(
                            {
                                item.provider
                                for item in [*saved.required, *saved.excluded]
                                if item.provider is not None
                                and item.migration_intent in {"shared_credit_pool", "independent"}
                            }
                        )
                    ),
                )
                if policy.inventory_policy == "saved_system_dependencies_v2"
                else self._evidence.sources(tenant_id, revision, models)
            )
        )
        classified = [*evidence.models, *evidence.unavailable_sources]
        actual = {(item.get("provider"), item.get("model_type"), item.get("model")) for item in classified}
        if actual != set(required) or len(actual) != len(classified):
            raise ModelDependencyInventoryError("dependency_source_evidence_incomplete")
        retired = [
            {
                "provider": item.provider,
                "model_type": item.model_type,
                "model": item.model,
                "pool_types": list(
                    item.migration_pool_types
                    if stable_dependency_inventory_policy(policy.inventory_policy)
                    else item.pool_types
                ),
                "reason": "retired",
            }
            for item in saved.excluded
            if item.exclusion_reason == "retired"
        ]
        policy_digest = _hash(policy.model_dump(mode="json"))
        payload = {
            "inventory_policy_digest": policy_digest,
            "dependency_snapshot_hash": saved.snapshot_digest,
            "models": list(evidence.models),
            "source_ownership": evidence.source_ownership,
            "retired_saved_sources": retired,
            "unavailable_sources": list(evidence.unavailable_sources),
            "source_capability_policy_digest": evidence.source_policy_digest,
        }
        if policy.inventory_policy == "saved_system_dependencies_v3":
            payload["access_policy_excluded_sources"] = [
                {
                    "provider": item.provider,
                    "model_type": item.model_type,
                    "model": item.model,
                    "reason": item.exclusion_reason,
                    "configuration_digest": item.migration_configuration_digest,
                }
                for item in saved.excluded
                if item.exclusion_reason == "not_in_enabled_finite_credit_pools"
            ]
        if evidence.source_variant_registry_digest is not None:
            if not stable_dependency_inventory_policy(policy.inventory_policy):
                raise ModelDependencyInventoryError("source_variants_require_stable_saved_policy")
            payload["source_variant_registry_digest"] = evidence.source_variant_registry_digest
            # Prospective declarations are not installed source evidence and
            # never contribute to the selected saved-model exact-set check.
            payload["prospective_variants"] = list(evidence.prospective_variants)
        result: dict[str, object] = {
            **payload,
            "inventory_hash": _hash(payload),
            "model_mapping_version": revision,
            "model_count": len(evidence.models),
            "inventory_policy": policy.inventory_policy,
            # Empty is a positively collected saved configuration snapshot, not
            # a missing source provider/schema that happened to yield zero rows.
        }
        if stable_dependency_inventory_policy(policy.inventory_policy):
            # Read-only diagnostics are explicitly not part of preparation or
            # source ownership authority. Normal consumption may change them.
            result["actual_runtime_ownership"] = [
                {
                    "provider": item.provider,
                    "model_type": item.model_type,
                    "model": item.model,
                    "owner": item.owner,
                    "pool_types": list(item.pool_types),
                    "migration_intent": item.migration_intent,
                    "migration_pool_types": list(item.migration_pool_types),
                    "document_kind": item.reference.document_kind,
                    "owner_id": item.reference.owner_id,
                    "revision": item.reference.revision,
                    "path": item.reference.path,
                }
                for item in [*saved.required, *saved.excluded]
            ]
        return result

    def readiness(
        self, tenant_id: str, revision: str, *, eligibility_policy_version: str | None = None
    ) -> dict[str, object]:
        if revision not in self._policies:
            return self._historical.readiness(tenant_id, revision, eligibility_policy_version)
        inventory = self.inventory(tenant_id, revision, eligibility_policy_version=eligibility_policy_version)
        fingerprint = self._evidence.validate_target(tenant_id, revision, inventory)
        return {**inventory, "daemon_protocol": "model-redirect/v1", "credential_fingerprint": fingerprint}
