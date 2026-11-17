"""Tenant-owned saved model dependencies for a new migration inventory policy.

Saved selectors, not the deployment HOSTED allowlist, establish configuration
dependencies. Adapters use each configuration owner's typed selection schema
and the runtime's non-secret credential-selection facts. Unknown selectors or
ownership stay explicit blockers; a CUSTOM, independent FREE or unmetered owner
is never silently promoted to SYSTEM shared credits. No configuration is edited.
"""

import hashlib
import json
from collections.abc import Sequence
from dataclasses import dataclass, field, replace
from typing import Literal, Protocol

type DocumentKind = Literal["classic_app", "conversation_override", "workflow", "agent", "dataset", "tenant_default"]
type ReferenceKind = Literal["fixed", "tenant_default", "dynamic"]
type SettlementOwner = Literal["shared_credit_pool", "custom", "provider_free", "unmetered", "unknown"]
type DependencyInventoryPolicy = Literal[
    "saved_system_dependencies_v1", "saved_system_dependencies_v2", "saved_system_dependencies_v3"
]
type MigrationModelIntent = Literal["shared_credit_pool", "custom", "independent", "unknown", "policy_excluded"]


def stable_dependency_inventory_policy(policy: DependencyInventoryPolicy) -> bool:
    return policy in {"saved_system_dependencies_v2", "saved_system_dependencies_v3"}


@dataclass(frozen=True, slots=True)
class AdmittedModelDependencyCaller:
    """Tenant scope supplied only after internal or workspace admission."""

    tenant_id: str
    mapping_revision: str | None = None
    # None resolves the exact revision's configured policy; old/no policy is v1.
    inventory_policy: DependencyInventoryPolicy | None = None


@dataclass(frozen=True, slots=True)
class ModelDependencyDocument:
    tenant_id: str
    kind: DocumentKind
    owner_id: str
    revision: str
    # Source configuration may contain prompts. Never log or export this field.
    payload: object = field(repr=False)


@dataclass(frozen=True, slots=True)
class ClassicModelSelectors:
    model: str | None
    dataset: str | None
    agent: str | None
    suggested_questions: str | None
    speech_to_text: str | None
    text_to_speech: str | None
    # Conversation overrides are a complete config in the current format.
    override: str | None = None
    annotation_provider: str | None = None
    annotation_model: str | None = None
    annotation_binding_id: str | None = None


@dataclass(frozen=True, slots=True)
class WorkflowModelSelectors:
    graph: str
    features: str | None


@dataclass(frozen=True, slots=True)
class AgentModelSelectors:
    configuration: object = field(repr=False)


@dataclass(frozen=True, slots=True)
class DatasetModelSelectors:
    indexing_technique: str | None
    embedding_provider: str | None
    embedding_model: str | None
    retrieval: object = field(repr=False)
    external: bool = False
    summary: object = None
    has_qa_documents: bool = False


@dataclass(frozen=True, slots=True)
class DefaultModelSelector:
    provider: str
    model_type: str
    model: str


@dataclass(frozen=True, slots=True)
class SavedModelReference:
    document_kind: DocumentKind
    owner_id: str
    revision: str
    path: str
    kind: ReferenceKind
    # None means the selector needs a tenant default or is dynamically bound.
    provider: str | None
    model_type: str | None
    model: str | None
    # None delegates credential selection to the current provider/model owner.
    credential_id: str | None = None
    # Hash only the owned selector's configuration, never a secret credential.
    configuration_digest: str = ""


@dataclass(frozen=True, slots=True)
class ModelDependencyProblem:
    document_kind: DocumentKind
    owner_id: str
    revision: str
    path: str
    code: str
    configuration_digest: str = ""
    # None means unknown/potentially any provider; it is not a BYOK exemption.
    provider: str | None = None


@dataclass(frozen=True, slots=True)
class ExtractedModelDependencies:
    references: tuple[SavedModelReference, ...]
    problems: tuple[ModelDependencyProblem, ...]


@dataclass(frozen=True, slots=True)
class ResolvedModelDependency:
    reference: SavedModelReference
    owner: SettlementOwner
    # Fixed references and resolved defaults have these values. A dynamic
    # selector may have a provable CUSTOM/FREE owner without a concrete model.
    provider: str | None
    model_type: str | None
    model: str | None
    pool_types: tuple[str, ...] = ()
    exclusion_reason: Literal["retired", "not_in_enabled_finite_credit_pools"] | None = None
    # Version 2 separates migration capability from the observed request owner.
    # In particular temporary fallback to BYOK never becomes evidence of BYOK
    # intent, nor is an independent FREE request reported as charged credits.
    migration_intent: MigrationModelIntent | None = None
    migration_pool_types: tuple[str, ...] = ()
    migration_configuration_digest: str = ""


@dataclass(frozen=True, slots=True)
class SavedSystemDependencyInventory:
    tenant_id: str
    required: tuple[ResolvedModelDependency, ...]
    excluded: tuple[ResolvedModelDependency, ...]
    problems: tuple[ModelDependencyProblem, ...]
    snapshot_digest: str


class ModelDependencyInventoryError(ValueError):
    """Secret-free inventory failure; transport owns HTTP representation."""


class SavedModelDocumentsQuery(Protocol):
    def collect(self, tenant_id: str) -> Sequence[ModelDependencyDocument]:
        """Read every owned saved configuration, including dormant versions.

        Adapters own short read sessions and complete tenant/resource joins.
        Return detached records, never ORM objects or sessions. No remote I/O
        or writes occur in a read transaction. Removed/inaccessible resources
        are not revived. Fail on read errors rather than report an empty list.
        """
        ...


class ModelDependencyExtractor(Protocol):
    def extract(self, tenant_id: str, documents: Sequence[ModelDependencyDocument]) -> ExtractedModelDependencies:
        """Use typed configuration owners, not recursive arbitrary JSON search.

        Secondary model selectors are included only when their owned feature
        can execute. Dynamic/unrecognized model selectors remain problems or
        dynamic references; they must not become a guessed concrete model.
        This operation never mutates or logs the supplied configuration.
        """
        ...


class ModelDependencyProvenance(Protocol):
    def resolve(self, tenant_id: str, references: Sequence[SavedModelReference]) -> Sequence[ResolvedModelDependency]:
        """Resolve actual default/provider/credential-selection ownership.

        Use non-secret facts, explicit credential IDs and the real runtime's
        source-selection rules. Return one result for every reference in order.
        An unavailable provider/default or unprovable owner is `unknown`, never
        a CUSTOM/legacy assumption. Do not decrypt keys, reserve credits, invoke
        models, write usage or rewrite preferences to probe ownership.
        """
        ...


class ModelDependencyRetirementQuery(Protocol):
    def identities(self, mapping_revision: str | None) -> frozenset[tuple[str, str, str]]:
        """Return only exact retirements of the caller's immutable revision."""
        ...


class ModelDependencyInventoryPolicies(Protocol):
    def for_revision(self, mapping_revision: str | None) -> DependencyInventoryPolicy: ...


def _reference_payload(reference: SavedModelReference) -> dict[str, object]:
    return {
        "document_kind": reference.document_kind,
        "owner_id": reference.owner_id,
        "revision": reference.revision,
        "path": reference.path,
        "kind": reference.kind,
        "provider": reference.provider,
        "model_type": reference.model_type,
        "model": reference.model,
        "credential_id": reference.credential_id,
        "configuration_digest": reference.configuration_digest,
    }


class ModelBillingDependencyInventory:
    def __init__(
        self,
        *,
        documents: SavedModelDocumentsQuery,
        extractor: ModelDependencyExtractor,
        provenance: ModelDependencyProvenance,
        retirements: ModelDependencyRetirementQuery | None = None,
        stable_provenance: ModelDependencyProvenance | None = None,
        policies: ModelDependencyInventoryPolicies | None = None,
        # None preserves historical construction; v3 fails closed without it.
        access_checked_provenance: ModelDependencyProvenance | None = None,
    ) -> None:
        self._documents = documents
        self._extractor = extractor
        self._provenance = provenance
        self._retirements = retirements
        self._stable_provenance = stable_provenance
        self._policies = policies
        self._access_checked_provenance = access_checked_provenance

    def collect(self, caller: AdmittedModelDependencyCaller) -> SavedSystemDependencyInventory:
        documents = self._documents.collect(caller.tenant_id)
        if any(document.tenant_id != caller.tenant_id for document in documents):
            raise ModelDependencyInventoryError("dependency_owner_scope_mismatch")
        extracted = self._extractor.extract(caller.tenant_id, documents)
        policy = caller.inventory_policy or (
            self._policies.for_revision(caller.mapping_revision) if self._policies else "saved_system_dependencies_v1"
        )
        if policy not in {
            "saved_system_dependencies_v1",
            "saved_system_dependencies_v2",
            "saved_system_dependencies_v3",
        }:
            raise ModelDependencyInventoryError("unknown_dependency_inventory_policy")
        provenance = (
            self._access_checked_provenance
            if policy == "saved_system_dependencies_v3"
            else self._stable_provenance
            if policy == "saved_system_dependencies_v2"
            else self._provenance
        )
        if provenance is None:
            raise ModelDependencyInventoryError("stable_dependency_provenance_unavailable")
        resolved = provenance.resolve(caller.tenant_id, extracted.references)
        retired = self._retirements.identities(caller.mapping_revision) if self._retirements else frozenset()
        if len(resolved) != len(extracted.references) or any(
            item.reference != reference for item, reference in zip(resolved, extracted.references, strict=True)
        ):
            raise ModelDependencyInventoryError("dependency_provenance_incomplete")
        required: list[ResolvedModelDependency] = []
        excluded: list[ResolvedModelDependency] = []
        problems = list(extracted.problems)
        for item in resolved:
            reference = item.reference
            intent = item.migration_intent if stable_dependency_inventory_policy(policy) else item.owner
            pools = item.migration_pool_types if stable_dependency_inventory_policy(policy) else item.pool_types
            if policy == "saved_system_dependencies_v3" and intent == "policy_excluded":
                if (
                    reference.kind != "dynamic"
                    and item.provider
                    and item.model_type
                    and item.model
                    and not pools
                    and item.exclusion_reason == "not_in_enabled_finite_credit_pools"
                    and item.migration_configuration_digest
                ):
                    excluded.append(item)
                    continue
            if intent == "shared_credit_pool" and (item.provider, item.model_type, item.model) in retired:
                excluded.append(replace(item, exclusion_reason="retired"))
                continue
            if intent in {"custom", "provider_free", "unmetered", "independent"}:
                excluded.append(item)
                continue
            if (
                intent != "shared_credit_pool"
                or reference.kind == "dynamic"
                or not item.provider
                or not item.model_type
                or not item.model
                or not pools
            ):
                problems.append(
                    ModelDependencyProblem(
                        reference.document_kind,
                        reference.owner_id,
                        reference.revision,
                        reference.path,
                        "dynamic_system_model_unresolved" if reference.kind == "dynamic" else "model_owner_unresolved",
                        reference.configuration_digest,
                        item.provider or reference.provider,
                    )
                )
                continue
            required.append(item)
        required.sort(key=_dependency_order)
        excluded.sort(key=_dependency_order)
        problems.sort(key=lambda item: (item.document_kind, item.owner_id, item.revision, item.path, item.code))
        payload = {
            "policy": policy,
            "tenant_id": caller.tenant_id,
            "retired_identities": [list(identity) for identity in sorted(retired)],
            "references": [
                {
                    **_reference_payload(item.reference),
                    "owner": item.owner,
                    "resolved_provider": item.provider,
                    "resolved_model_type": item.model_type,
                    "resolved_model": item.model,
                    "pool_types": list(item.pool_types),
                    "exclusion_reason": item.exclusion_reason,
                }
                for item in [*required, *excluded]
            ],
            "problems": [
                {
                    "document_kind": item.document_kind,
                    "owner_id": item.owner_id,
                    "revision": item.revision,
                    "path": item.path,
                    "code": item.code,
                    "configuration_digest": item.configuration_digest,
                    "provider": item.provider,
                }
                for item in problems
            ],
        }
        if stable_dependency_inventory_policy(policy):
            # Actual owner/current pool stay on the returned records for audit,
            # not in a capability/configuration hash that must survive usage.
            payload["references"] = [
                {
                    **_reference_payload(item.reference),
                    "migration_intent": item.migration_intent,
                    "resolved_provider": item.provider,
                    "resolved_model_type": item.model_type,
                    "resolved_model": item.model,
                    "migration_pool_types": list(item.migration_pool_types),
                    "migration_configuration_digest": item.migration_configuration_digest,
                    "exclusion_reason": item.exclusion_reason,
                }
                for item in [*required, *excluded]
            ]
        digest = (
            "sha256:"
            + hashlib.sha256(
                json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
            ).hexdigest()
        )
        return SavedSystemDependencyInventory(
            caller.tenant_id, tuple(required), tuple(excluded), tuple(problems), digest
        )


def _dependency_order(item: ResolvedModelDependency) -> tuple[str, ...]:
    return (
        item.reference.document_kind,
        item.reference.owner_id,
        item.reference.revision,
        item.reference.path,
        item.provider or "",
        item.model_type or "",
        item.model or "",
        item.reference.configuration_digest,
    )
