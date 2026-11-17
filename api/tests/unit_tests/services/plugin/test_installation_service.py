"""All five installation owners run real source admission before mutation."""

from collections.abc import Callable, Sequence
from dataclasses import dataclass, field

import pytest

from graphon.model_runtime.utils.encoders import jsonable_encoder
from services.model_billing_dependency_inventory import SettlementOwner
from services.model_billing_source_plugin_admission import SourcePluginAdmissionError
from services.plugin.installation_gateway import LegacyPluginInstallationGateway
from services.plugin.installation_service import (
    AdmittedPluginInstallationCaller,
    PluginInstallationOperation,
    PluginInstallationResult,
    PluginInstallationService,
)
from tests.unit_tests.services.test_model_billing_source_plugin_admission import TENANT, UID, service


@dataclass
class MutationJournal:
    entries: list[tuple[str, tuple[object, ...]]] = field(default_factory=list)

    def assert_available(
        self, operation: PluginInstallationOperation, original_uid: str | None, candidate_uid: str | None
    ) -> None:
        pass

    def _record(self, method: str, args: tuple[object, ...]) -> PluginInstallationResult:
        self.entries.append((method, args))
        return PluginInstallationResult(False, "owned-task", None)

    def install_from_local_pkg(
        self, tenant_id: str, plugin_unique_identifiers: Sequence[str]
    ) -> PluginInstallationResult:
        return self._record("package", (tenant_id, tuple(plugin_unique_identifiers)))

    def install_from_marketplace_pkg(
        self, tenant_id: str, plugin_unique_identifiers: Sequence[str]
    ) -> PluginInstallationResult:
        return self._record("marketplace", (tenant_id, tuple(plugin_unique_identifiers)))

    def install_from_github(
        self, tenant_id: str, plugin_unique_identifier: str, repo: str, version: str, package: str
    ) -> PluginInstallationResult:
        return self._record("github", (tenant_id, plugin_unique_identifier, repo, version, package))

    def upgrade_plugin_with_marketplace(
        self, tenant_id: str, original_plugin_unique_identifier: str, new_plugin_unique_identifier: str
    ) -> PluginInstallationResult:
        return self._record(
            "upgrade_marketplace", (tenant_id, original_plugin_unique_identifier, new_plugin_unique_identifier)
        )

    def upgrade_plugin_with_github(
        self,
        tenant_id: str,
        original_plugin_unique_identifier: str,
        new_plugin_unique_identifier: str,
        repo: str,
        version: str,
        package: str,
    ) -> PluginInstallationResult:
        return self._record(
            "upgrade_github",
            (tenant_id, original_plugin_unique_identifier, new_plugin_unique_identifier, repo, version, package),
        )


def invoke(target: PluginInstallationService, flow: str) -> PluginInstallationResult:
    caller = AdmittedPluginInstallationCaller(TENANT)
    if flow == "package":
        return target.install_from_local_pkg(caller, [UID])
    if flow == "marketplace":
        return target.install_from_marketplace_pkg(caller, [UID])
    if flow == "github":
        return target.install_from_github(caller, UID, "owner/repo", "v1", "file.difypkg")
    if flow == "upgrade_marketplace":
        return target.upgrade_plugin_with_marketplace(caller, "old-immutable-source", UID)
    return target.upgrade_plugin_with_github(caller, "old-immutable-source", UID, "owner/repo", "v1", "file.difypkg")


def test_result_keeps_existing_console_task_response_shape() -> None:
    assert jsonable_encoder(PluginInstallationResult(False, "owned-task", None)) == {
        "all_installed": False,
        "task_id": "owned-task",
        "task": None,
    }


def test_marketplace_disabled_still_precedes_route_state_and_daemon_reads(
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(MARKETPLACE_ENABLED=False)
    admission, routes, inventories, contracts = service(active=True)
    target = PluginInstallationService(admission=admission, mutations=LegacyPluginInstallationGateway())
    with pytest.raises(ValueError, match="marketplace is not enabled"):
        invoke(target, "marketplace")
    assert routes.tenants == []
    assert inventories.tenants == []
    assert contracts.calls == []


@pytest.mark.parametrize("flow", ["package", "marketplace", "github", "upgrade_marketplace", "upgrade_github"])
def test_unknown_candidate_never_reaches_any_daemon_mutation(flow: str) -> None:
    admission, _, _, _ = service()
    mutations = MutationJournal()
    target = PluginInstallationService(admission=admission, mutations=mutations)
    with pytest.raises(SourcePluginAdmissionError, match="not_reviewed"):
        invoke(target, flow)
    assert mutations.entries == []


@pytest.mark.parametrize("flow", ["package", "marketplace", "github", "upgrade_marketplace", "upgrade_github"])
@pytest.mark.parametrize(
    ("owner", "active"), [("shared_credit_pool", False), ("custom", True), ("provider_free", True)]
)
def test_legacy_and_byok_only_operations_keep_result_and_owner_scope(
    flow: str, owner: SettlementOwner, active: bool
) -> None:
    admission, _, _, _ = service(owner=owner, active=active)
    mutations = MutationJournal()
    target = PluginInstallationService(admission=admission, mutations=mutations)
    assert invoke(target, flow) == PluginInstallationResult(False, "owned-task", None)
    assert len(mutations.entries) == 1
    assert mutations.entries[0][0] == flow
    assert mutations.entries[0][1][0] == TENANT
