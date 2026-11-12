"""Immutable binding admission; reviewed offline compatibility cannot rebase publication."""

from collections.abc import Sequence
from dataclasses import dataclass, field, replace

import pytest

from core.plugin.entities.plugin import PluginInstallationSource
from core.plugin.entities.plugin_daemon import PluginModelProviderBinding
from services.model_billing_dependency_inventory import ResolvedModelDependency, SavedSystemDependencyInventory
from services.model_billing_source_plugin_admission import (
    ModelBillingSourcePluginAdmission,
    SourcePluginAdmissionError,
    SourcePluginProtection,
)
from services.plugin.installation_service import AdmittedPluginInstallationCaller
from services.plugin.source_plugin_contract_gateway import SourcePluginContractGateway
from tests.unit_tests.services.test_model_billing_anthropic_adapter import binding, peer_binding_index
from tests.unit_tests.services.test_model_billing_openai_chat_adapter import PROFILE
from tests.unit_tests.services.test_model_billing_source_plugin_admission import TENANT, Inventories, Routes, dependency


@dataclass
class Metadata:
    bindings: list[PluginModelProviderBinding]
    calls: list[str] = field(default_factory=list)

    def fetch_model_provider_bindings(self, tenant_id: str) -> Sequence[PluginModelProviderBinding]:
        self.calls.append(tenant_id)
        return self.bindings


def metadata(index: int = 0) -> Metadata:
    return Metadata(
        [
            PluginModelProviderBinding(
                provider="langgenius/anthropic/anthropic",
                installation_id="owned-installation",
                plugin_id="langgenius/anthropic",
                plugin_unique_identifier=binding(index)["marker"]["source_plugin_uid"],
                runtime_type="local",
                source=PluginInstallationSource.Marketplace,
                version="0.3.38",
                verified=True,
            )
        ]
    )


def arguments(index: int = 0) -> tuple[SourcePluginProtection, ResolvedModelDependency]:
    item = dependency()
    ref = replace(
        item.reference, provider="langgenius/anthropic/anthropic", model=binding(index)["marker"]["source_model"]
    )
    return SourcePluginProtection(TENANT, "frozen-profile-v1", 1), replace(
        item, reference=ref, provider=ref.provider, model=ref.model
    )


def gateway(meta: Metadata) -> SourcePluginContractGateway:
    return SourcePluginContractGateway(metadata=meta, managed_target_plugin_id="langgenius/tokener")


def test_same_immutable_uid_reinstallation_uses_only_fresh_binding() -> None:
    meta = metadata()
    route, item = arguments()
    gateway(meta).assert_compatible(route, [binding()["marker"]["source_plugin_uid"]], [item])
    assert meta.calls == [TENANT]


@pytest.mark.parametrize("installed_new", [False, True])
def test_readme_only_signed1ded_artifact_still_requires_publication_repreparation(installed_new: bool) -> None:
    from tests.helpers.unit.model_billing_openai110_artifact_profiles import OLD_UID, SOURCE_UID

    current, candidate = (SOURCE_UID, OLD_UID) if installed_new else (OLD_UID, SOURCE_UID)
    meta = Metadata(
        [
            PluginModelProviderBinding(
                provider="langgenius/openai/openai",
                installation_id="owned-installation",
                plugin_id="langgenius/openai",
                plugin_unique_identifier=current,
                runtime_type="local",
                source=PluginInstallationSource.Marketplace,
                version="1.1.0",
                verified=True,
            )
        ]
    )
    route = SourcePluginProtection(TENANT, "old-frozen-profile", 1)
    admission = ModelBillingSourcePluginAdmission(
        routes=Routes(route),
        dependencies=Inventories(SavedSystemDependencyInventory(TENANT, (dependency(),), (), (), "sha256:" + "f" * 64)),
        candidates=gateway(meta),
        pre_admitted_tenants=frozenset(),
    )
    admission.assert_allowed(AdmittedPluginInstallationCaller(TENANT), [current])
    with pytest.raises(SourcePluginAdmissionError, match="requires_reprepare"):
        admission.assert_allowed(AdmittedPluginInstallationCaller(TENANT), [candidate])
    with pytest.raises(SourcePluginAdmissionError, match="cohort_frozen"):
        gateway(meta).assert_frozen_bindings(TENANT, [candidate])
    assert meta.calls == [TENANT] * 3


@pytest.mark.parametrize("changed_uid", [False, True])
def test_late_installed_system_provider_is_not_excluded_by_openai_only_publication(changed_uid: bool) -> None:
    meta = metadata()
    _, late_dependency = arguments()
    published = SourcePluginProtection(TENANT, "frozen-v1", 1, source_plugin_ids=("langgenius/openai",))
    inventories = Inventories(SavedSystemDependencyInventory(TENANT, (late_dependency,), (), (), "sha256:" + "f" * 64))
    admission = ModelBillingSourcePluginAdmission(
        routes=Routes(published), dependencies=inventories, candidates=gateway(meta), pre_admitted_tenants=frozenset()
    )
    candidate = binding(peer_binding_index(0) if changed_uid else 0)["marker"]["source_plugin_uid"]
    if changed_uid:
        with pytest.raises(SourcePluginAdmissionError, match="requires_reprepare"):
            admission.assert_allowed(AdmittedPluginInstallationCaller(TENANT), [candidate])
    else:
        admission.assert_allowed(AdmittedPluginInstallationCaller(TENANT), [candidate])
    assert inventories.tenants == [TENANT]
    assert meta.calls == [TENANT]
    assert late_dependency.provider == "langgenius/anthropic/anthropic"


def test_late_installed_byok_provider_is_not_frozen_by_publication() -> None:
    meta = metadata()
    _, late_dependency = arguments()
    byok = replace(late_dependency, owner="custom")
    published = SourcePluginProtection(TENANT, "frozen-v1", 1, source_plugin_ids=("langgenius/openai",))
    inventories = Inventories(SavedSystemDependencyInventory(TENANT, (), (byok,), (), "sha256:" + "f" * 64))
    admission = ModelBillingSourcePluginAdmission(
        routes=Routes(published), dependencies=inventories, candidates=gateway(meta), pre_admitted_tenants=frozenset()
    )
    admission.assert_allowed(
        AdmittedPluginInstallationCaller(TENANT), [binding(peer_binding_index(0))["marker"]["source_plugin_uid"]]
    )
    assert inventories.tenants == [TENANT]
    assert meta.calls == []


@pytest.mark.parametrize("index", range(8))
def test_even_reviewed_0338_to_0339_change_requires_explicit_publication_repreparation(index: int) -> None:
    meta = metadata(index)
    route, item = arguments(index)
    candidate = binding(peer_binding_index(index))["marker"]["source_plugin_uid"]
    with pytest.raises(SourcePluginAdmissionError, match="requires_reprepare"):
        gateway(meta).assert_compatible(route, [candidate], [item])
    assert meta.calls == [TENANT]


def test_actual_openai_042_does_not_allow_unreviewed_110_source() -> None:
    meta = metadata()
    meta.bindings[0] = meta.bindings[0].model_copy(
        update={
            "provider": "langgenius/openai/openai",
            "plugin_id": "langgenius/openai",
            "plugin_unique_identifier": PROFILE["source_plugin_uid"],
        }
    )
    with pytest.raises(SourcePluginAdmissionError, match="requires_reprepare"):
        gateway(meta).assert_compatible(
            SourcePluginProtection(TENANT, "frozen-openai-v1", 1),
            ["langgenius/openai:1.1.0@" + "c" * 64],
            [dependency()],
        )


@pytest.mark.parametrize("kind", ["remote", "duplicate", "missing", "uid_prefix", "mutable_uid", "runtime"])
def test_ambiguous_or_mutable_source_is_not_reinstalled(kind: str) -> None:
    meta = metadata()
    route, item = arguments()
    candidate = binding()["marker"]["source_plugin_uid"]
    if kind == "remote":
        meta.bindings[0] = meta.bindings[0].model_copy(update={"source": PluginInstallationSource.Remote})
    elif kind == "duplicate":
        meta.bindings.append(meta.bindings[0])
    elif kind == "missing":
        meta.bindings.clear()
    elif kind == "uid_prefix":
        meta.bindings[0] = meta.bindings[0].model_copy(
            update={"plugin_unique_identifier": "langgenius/openai:0.4.2@" + "a" * 64}
        )
    elif kind == "mutable_uid":
        meta.bindings[0] = meta.bindings[0].model_copy(
            update={"plugin_unique_identifier": "langgenius/anthropic:remote"}
        )
    else:
        meta.bindings[0] = meta.bindings[0].model_copy(update={"runtime_type": "remote"})
    with pytest.raises(SourcePluginAdmissionError, match="binding_unverified"):
        gateway(meta).assert_compatible(route, [candidate], [item])


def test_pre_migration_freeze_allows_same_uid_and_unrelated_or_new_plugin() -> None:
    meta = metadata()
    target = gateway(meta)
    target.assert_frozen_bindings(TENANT, [binding()["marker"]["source_plugin_uid"]])
    target.assert_frozen_bindings(TENANT, ["langgenius/time:1.0.0@" + "f" * 64])
    target.assert_frozen_bindings(TENANT, ["langgenius/openai:1.1.0@" + "f" * 64])
    assert meta.calls == [TENANT] * 3


def test_pre_migration_freeze_rejects_even_reviewed_different_uid() -> None:
    meta = metadata()
    candidate = binding(peer_binding_index(0))["marker"]["source_plugin_uid"]
    with pytest.raises(SourcePluginAdmissionError, match="cohort_frozen"):
        gateway(meta).assert_frozen_bindings(TENANT, [candidate])


def test_source_freeze_leaves_managed_target_conflict_to_its_existing_owner() -> None:
    meta = metadata()
    meta.bindings[0] = meta.bindings[0].model_copy(
        update={
            "provider": "tokener",
            "plugin_id": "langgenius/tokener",
            "plugin_unique_identifier": "langgenius/tokener:0.4.3-dev4@" + "a" * 64,
        }
    )
    gateway(meta).assert_frozen_bindings(TENANT, ["langgenius/tokener:0.4.3-dev7@" + "b" * 64])
    assert meta.calls == [TENANT]


@pytest.mark.parametrize("suffix", ["bad", "1.0.0@" + "a" * 63, "1.0.0 @" + "a" * 64])
def test_candidate_identity_must_be_content_addressed(suffix: str) -> None:
    meta = metadata()
    route, item = arguments()
    with pytest.raises(SourcePluginAdmissionError, match="not_immutable"):
        gateway(meta).assert_compatible(route, ["langgenius/anthropic:" + suffix], [item])
    assert meta.calls == []
