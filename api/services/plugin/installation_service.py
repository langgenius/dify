"""Admitted plugin binding mutations, before any daemon installation side effect.

Download, signature checks and cache invalidation belong to the gateway. All
manual, import and asynchronous callers share this application entry point.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal, Protocol

type PluginInstallationOperation = Literal["package", "marketplace", "github", "upgrade_marketplace", "upgrade_github"]


@dataclass(frozen=True, slots=True)
class AdmittedPluginInstallationCaller:
    """Workspace scope already admitted by transport or an internal task owner."""

    tenant_id: str


@dataclass(frozen=True, slots=True)
class PluginInstallationResult:
    all_installed: bool
    task_id: str
    # None means the daemon has not returned the optional task snapshot.
    task: dict[str, object] | None


class PluginInstallationAdmission(Protocol):
    def assert_allowed(self, caller: AdmittedPluginInstallationCaller, candidate_uids: Sequence[str]) -> None:
        """Reject incompatible replacements before download/upload/install/upgrade.

        This is an admission check, not an atomic database/daemon transaction.
        Implementations must fail closed on uncertain active route facts.
        """
        ...


class PluginBindingMutations(Protocol):
    def assert_available(
        self,
        operation: PluginInstallationOperation,
        original_uid: str | None,
        candidate_uid: str | None,
    ) -> None:
        """Preserve existing non-mutating source-policy admission before route reads.

        None original/candidate identifies a non-upgrade or package batch.
        No download, daemon call, cache invalidation or credential access.
        """
        ...

    def install_from_local_pkg(
        self, tenant_id: str, plugin_unique_identifiers: Sequence[str]
    ) -> PluginInstallationResult: ...

    def install_from_marketplace_pkg(
        self, tenant_id: str, plugin_unique_identifiers: Sequence[str]
    ) -> PluginInstallationResult: ...

    def install_from_github(
        self, tenant_id: str, plugin_unique_identifier: str, repo: str, version: str, package: str
    ) -> PluginInstallationResult: ...

    def upgrade_plugin_with_marketplace(
        self, tenant_id: str, original_plugin_unique_identifier: str, new_plugin_unique_identifier: str
    ) -> PluginInstallationResult: ...

    def upgrade_plugin_with_github(
        self,
        tenant_id: str,
        original_plugin_unique_identifier: str,
        new_plugin_unique_identifier: str,
        repo: str,
        version: str,
        package: str,
    ) -> PluginInstallationResult: ...


class PluginInstallationService:
    def __init__(self, *, admission: PluginInstallationAdmission, mutations: PluginBindingMutations) -> None:
        self._admission = admission
        self._mutations = mutations

    def assert_installable(self, caller: AdmittedPluginInstallationCaller, candidate_uids: Sequence[str]) -> None:
        """Admit legacy bulk owners that retain their stricter signature mechanics."""
        self._admission.assert_allowed(caller, candidate_uids)

    def install_from_local_pkg(
        self, caller: AdmittedPluginInstallationCaller, plugin_unique_identifiers: Sequence[str]
    ) -> PluginInstallationResult:
        self._mutations.assert_available("package", None, None)
        self._admission.assert_allowed(caller, plugin_unique_identifiers)
        return self._mutations.install_from_local_pkg(caller.tenant_id, plugin_unique_identifiers)

    def install_from_marketplace_pkg(
        self, caller: AdmittedPluginInstallationCaller, plugin_unique_identifiers: Sequence[str]
    ) -> PluginInstallationResult:
        self._mutations.assert_available("marketplace", None, None)
        self._admission.assert_allowed(caller, plugin_unique_identifiers)
        return self._mutations.install_from_marketplace_pkg(caller.tenant_id, plugin_unique_identifiers)

    def install_from_github(
        self,
        caller: AdmittedPluginInstallationCaller,
        plugin_unique_identifier: str,
        repo: str,
        version: str,
        package: str,
    ) -> PluginInstallationResult:
        self._mutations.assert_available("github", None, plugin_unique_identifier)
        self._admission.assert_allowed(caller, (plugin_unique_identifier,))
        return self._mutations.install_from_github(caller.tenant_id, plugin_unique_identifier, repo, version, package)

    def upgrade_plugin_with_marketplace(
        self,
        caller: AdmittedPluginInstallationCaller,
        original_plugin_unique_identifier: str,
        new_plugin_unique_identifier: str,
    ) -> PluginInstallationResult:
        self._mutations.assert_available(
            "upgrade_marketplace", original_plugin_unique_identifier, new_plugin_unique_identifier
        )
        self._admission.assert_allowed(caller, (new_plugin_unique_identifier,))
        return self._mutations.upgrade_plugin_with_marketplace(
            caller.tenant_id, original_plugin_unique_identifier, new_plugin_unique_identifier
        )

    def upgrade_plugin_with_github(
        self,
        caller: AdmittedPluginInstallationCaller,
        original_plugin_unique_identifier: str,
        new_plugin_unique_identifier: str,
        repo: str,
        version: str,
        package: str,
    ) -> PluginInstallationResult:
        self._mutations.assert_available(
            "upgrade_github", original_plugin_unique_identifier, new_plugin_unique_identifier
        )
        self._admission.assert_allowed(caller, (new_plugin_unique_identifier,))
        return self._mutations.upgrade_plugin_with_github(
            caller.tenant_id, original_plugin_unique_identifier, new_plugin_unique_identifier, repo, version, package
        )
