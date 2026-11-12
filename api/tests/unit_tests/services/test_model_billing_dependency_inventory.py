from collections.abc import Sequence
from dataclasses import dataclass, replace

import pytest

from services.model_billing_dependency_inventory import (
    AdmittedModelDependencyCaller,
    ExtractedModelDependencies,
    ModelBillingDependencyInventory,
    ModelDependencyDocument,
    ModelDependencyInventoryError,
    ResolvedModelDependency,
    SavedModelReference,
    SettlementOwner,
)

PROVIDER = "langgenius/openai/openai"


@dataclass
class Documents:
    documents: tuple[ModelDependencyDocument, ...] = ()

    def collect(self, tenant_id: str) -> Sequence[ModelDependencyDocument]:
        del tenant_id
        return self.documents


@dataclass
class Extractor:
    references: tuple[SavedModelReference, ...]

    def extract(self, tenant_id: str, documents: Sequence[ModelDependencyDocument]) -> ExtractedModelDependencies:
        del tenant_id, documents
        return ExtractedModelDependencies(self.references, ())


@dataclass
class Provenance:
    resolved: tuple[ResolvedModelDependency, ...]

    def resolve(self, tenant_id: str, references: Sequence[SavedModelReference]) -> Sequence[ResolvedModelDependency]:
        del tenant_id, references
        return self.resolved


@dataclass
class Retirements:
    revision: str

    def identities(self, mapping_revision: str | None) -> frozenset[tuple[str, str, str]]:
        return frozenset({(PROVIDER, "llm", "retired")}) if mapping_revision == self.revision else frozenset()


def reference(model: str = "gpt-4o-mini") -> SavedModelReference:
    return SavedModelReference("workflow", "app", "dormant", "nodes.n.model", "fixed", PROVIDER, "llm", model)


def inventory(
    items: tuple[ResolvedModelDependency, ...], *, documents: Documents | None = None
) -> ModelBillingDependencyInventory:
    return ModelBillingDependencyInventory(
        documents=documents or Documents(),
        extractor=Extractor(tuple(item.reference for item in items)),
        provenance=Provenance(items),
        retirements=Retirements("new-revision"),
    )


@pytest.mark.parametrize("owner", ["custom", "provider_free", "unmetered"])
def test_only_verified_shared_credit_provenance_is_required(owner: SettlementOwner) -> None:
    ref = reference()
    item = ResolvedModelDependency(ref, owner, ref.provider, ref.model_type, ref.model)
    result = inventory((item,)).collect(AdmittedModelDependencyCaller("tenant"))
    assert result.required == ()
    assert result.excluded == (item,)
    assert result.problems == ()


def test_saved_system_model_outside_allowlist_remains_required_and_config_is_fingerprinted() -> None:
    ref = replace(reference("not-in-hosted-list"), configuration_digest="sha256:one")
    item = ResolvedModelDependency(ref, "shared_credit_pool", ref.provider, ref.model_type, ref.model, ("paid",))
    result = inventory((item,)).collect(AdmittedModelDependencyCaller("tenant"))
    assert result.required == (item,)
    changed = replace(item, reference=replace(ref, configuration_digest="sha256:two"))
    assert (
        inventory((changed,)).collect(AdmittedModelDependencyCaller("tenant")).snapshot_digest != result.snapshot_digest
    )


def test_v3_access_exclusion_is_explicit_and_keeps_the_saved_reference() -> None:
    from services.model_billing_dependency_provenance import (
        AccessCheckedSavedModelMigrationIntent,
        StableSavedModelMigrationIntent,
    )
    from tests.unit_tests.services.test_model_billing_dependency_provenance import QUOTAS, STATE, Selections

    references = (reference("gpt-4o-mini"), reference("gpt-6-astra"))
    state = replace(STATE, quotas=tuple(replace(q, models=(("llm", "gpt-4o-mini"),)) for q in QUOTAS))
    selections = Selections(state)
    service = ModelBillingDependencyInventory(
        documents=Documents(),
        extractor=Extractor(references),
        provenance=Provenance(()),
        stable_provenance=StableSavedModelMigrationIntent(selections=selections),
        access_checked_provenance=AccessCheckedSavedModelMigrationIntent(selections=selections),
    )
    historical = service.collect(AdmittedModelDependencyCaller("tenant", "old", "saved_system_dependencies_v2"))
    result = service.collect(AdmittedModelDependencyCaller("tenant", "new", "saved_system_dependencies_v3"))
    assert [item.model for item in historical.required] == ["gpt-4o-mini", "gpt-6-astra"]
    assert [item.model for item in result.required] == ["gpt-4o-mini"]
    assert result.excluded[0].reference == references[1]
    assert result.excluded[0].exclusion_reason == "not_in_enabled_finite_credit_pools"
    assert result.problems == ()
    assert result.snapshot_digest != historical.snapshot_digest


def test_v3_requires_its_explicit_resolver_and_cannot_exempt_dynamic_identity() -> None:
    with pytest.raises(ModelDependencyInventoryError, match="provenance_unavailable"):
        inventory(()).collect(AdmittedModelDependencyCaller("tenant", "new", "saved_system_dependencies_v3"))
    ref = replace(reference("outside"), kind="dynamic")
    forged = ResolvedModelDependency(
        ref,
        "unknown",
        PROVIDER,
        "llm",
        "outside",
        exclusion_reason="not_in_enabled_finite_credit_pools",
        migration_intent="policy_excluded",
        migration_configuration_digest="sha256:configuration",
    )
    service = ModelBillingDependencyInventory(
        documents=Documents(),
        extractor=Extractor((ref,)),
        provenance=Provenance(()),
        access_checked_provenance=Provenance((forged,)),
    )
    result = service.collect(AdmittedModelDependencyCaller("tenant", "new", "saved_system_dependencies_v3"))
    assert result.excluded == result.required == ()
    assert result.problems[0].code == "dynamic_system_model_unresolved"


def test_dynamic_and_missing_default_are_blockers_not_guessed_models() -> None:
    dynamic = replace(reference(), kind="dynamic", provider=None, model=None, configuration_digest="sha256:selector")
    items = (ResolvedModelDependency(dynamic, "unknown", None, "llm", None),)
    result = inventory(items).collect(AdmittedModelDependencyCaller("tenant"))
    assert result.required == result.excluded == ()
    assert result.problems[0].code == "dynamic_system_model_unresolved"
    assert result.problems[0].configuration_digest == "sha256:selector"


def test_retirement_is_exact_revision_reported_exclusion_not_silent_model_removal() -> None:
    ref = reference("retired")
    item = ResolvedModelDependency(ref, "shared_credit_pool", ref.provider, ref.model_type, ref.model, ("paid",))
    service = inventory((item,))
    assert service.collect(AdmittedModelDependencyCaller("tenant", "old-revision")).required == (item,)
    result = service.collect(AdmittedModelDependencyCaller("tenant", "new-revision"))
    assert result.required == ()
    assert result.excluded == (replace(item, exclusion_reason="retired"),)
    assert result.problems == ()


def test_foreign_owner_document_and_incomplete_provenance_fail_closed() -> None:
    service = inventory((), documents=Documents((ModelDependencyDocument("foreign", "workflow", "app", "draft", {}),)))
    with pytest.raises(ModelDependencyInventoryError, match="owner_scope"):
        service.collect(AdmittedModelDependencyCaller("tenant"))
    service = ModelBillingDependencyInventory(
        documents=Documents(), extractor=Extractor((reference(),)), provenance=Provenance(())
    )
    with pytest.raises(ModelDependencyInventoryError, match="provenance_incomplete"):
        service.collect(AdmittedModelDependencyCaller("tenant"))


def test_input_order_does_not_change_snapshot_hash() -> None:
    first = ResolvedModelDependency(reference(), "shared_credit_pool", PROVIDER, "llm", "gpt-4o-mini", ("paid",))
    second = replace(first, reference=replace(reference(), revision="draft"))
    caller = AdmittedModelDependencyCaller("tenant")
    assert (
        inventory((first, second)).collect(caller).snapshot_digest
        == inventory((second, first)).collect(caller).snapshot_digest
    )
