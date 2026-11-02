"""Protect admitted migration sources and activated legacy SYSTEM routes.

Saved dependency ownership and immutable source bindings protect publication.
A reviewed schema/profile pair does not authorize changing a published source
UID without a separately implemented re-preparation operation.
BYOK and independent FREE ownership never acquire a SYSTEM redirect here.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

from services.model_billing_dependency_inventory import (
    AdmittedModelDependencyCaller,
    ResolvedModelDependency,
    SavedSystemDependencyInventory,
)
from services.plugin.installation_service import AdmittedPluginInstallationCaller


class SourcePluginAdmissionError(ValueError):
    """Secret-free application denial; protocol translation stays in transport."""


@dataclass(frozen=True, slots=True)
class SourcePluginProtection:
    tenant_id: str
    mapping_revision: str
    route_epoch: int
    # Publication-time diagnostic only. Later providers may be absent: never
    # use this projection as a complete current source set for admission.
    source_plugin_ids: tuple[str, ...] | None = None
    # True protects a frozen batch before publication; no target mapping is
    # assumed ready. It cannot be cleared by changing process configuration.
    pre_migration_freeze: bool = False


class SourcePluginProtectionQuery(Protocol):
    def get_protection(self, tenant_id: str) -> SourcePluginProtection | None:
        """Read one tenant's publication and migration projection in a short session.

        None means no durable protection; it is not a database failure fallback. A
        cancelled/blocked migration that was activated remains protected.
        Return detached non-secret values, never a control journal or ORM row.
        """
        ...


class SourcePluginCandidateProof(Protocol):
    def installed_model_plugins(self, tenant_id: str, candidate_uids: Sequence[str]) -> frozenset[str]:
        """Read fresh model bindings to distinguish unrelated installs from model changes.

        Publication-time source ownership is not an inventory of providers
        installed or configured after cutover. Fail closed on read errors.
        """
        ...

    def assert_frozen_bindings(self, tenant_id: str, candidate_uids: Sequence[str]) -> None:
        """For an admitted pre-migration cohort, forbid installed model UID changes.

        Fresh bindings are required. Same immutable UID, unrelated tools and
        not-yet-installed plugins do not replace an existing model runtime.
        No installation, schema execution or credential decryption occurs.
        """
        ...

    def assert_compatible(
        self,
        route: SourcePluginProtection,
        candidate_uids: Sequence[str],
        dependencies: Sequence[ResolvedModelDependency],
    ) -> None:
        """Require the same fresh immutable UID for every affected SYSTEM source.

        Same-UID immutable reinstallation preserves the already installed
        artifact. Changing even a reviewed UID needs explicit re-preparation
        and post-upgrade publication/recovery proof, not an implicit marker
        rewrite. No key decryption, installation, schema or model call.
        Raise SourcePluginAdmissionError on incomplete or stale proof.
        """
        ...


class SourcePluginDependencies(Protocol):
    def collect(self, caller: AdmittedModelDependencyCaller) -> SavedSystemDependencyInventory: ...


class ModelBillingSourcePluginAdmission:
    def __init__(
        self,
        *,
        routes: SourcePluginProtectionQuery,
        dependencies: SourcePluginDependencies,
        candidates: SourcePluginCandidateProof,
        pre_admitted_tenants: frozenset[str],
    ) -> None:
        self._routes = routes
        self._dependencies = dependencies
        self._candidates = candidates
        self._pre_admitted_tenants = pre_admitted_tenants

    def assert_allowed(self, caller: AdmittedPluginInstallationCaller, candidate_uids: Sequence[str]) -> None:
        route = self._routes.get_protection(caller.tenant_id)
        if route is None:
            if caller.tenant_id in self._pre_admitted_tenants:
                self._candidates.assert_frozen_bindings(caller.tenant_id, candidate_uids)
            return
        if route.tenant_id != caller.tenant_id:
            raise SourcePluginAdmissionError("source_plugin_route_state_invalid")
        if route.pre_migration_freeze:
            self._candidates.assert_frozen_bindings(caller.tenant_id, candidate_uids)
            return
        if route.tenant_id != caller.tenant_id or not route.mapping_revision or route.route_epoch <= 0:
            raise SourcePluginAdmissionError("source_plugin_route_state_invalid")
        plugin_ids = {uid.split(":", 1)[0] for uid in candidate_uids}
        inventory = self._dependencies.collect(
            AdmittedModelDependencyCaller(caller.tenant_id, mapping_revision=route.mapping_revision)
        )
        if inventory.tenant_id != caller.tenant_id:
            raise SourcePluginAdmissionError("source_plugin_dependencies_unresolved")
        problems = tuple(
            problem
            for problem in inventory.problems
            if (
                problem.provider is None
                or problem.provider.count("/") != 2
                or problem.provider.rsplit("/", 1)[0] in plugin_ids
            )
        )
        affected = tuple(
            item for item in inventory.required if item.provider and item.provider.rsplit("/", 1)[0] in plugin_ids
        )
        if problems:
            known_relevant = any(
                problem.provider is not None and problem.provider.count("/") == 2 for problem in problems
            )
            installed_models = self._candidates.installed_model_plugins(caller.tenant_id, candidate_uids)
            if affected or known_relevant or installed_models.intersection(plugin_ids):
                raise SourcePluginAdmissionError("source_plugin_dependencies_unresolved")
            # No installed model binding or existing SYSTEM dependency can be
            # replaced. A separate unresolved dynamic selector is not a reason
            # to block an unrelated tool or a new, uninstalled plugin.
            return
        if not affected:
            return
        self._candidates.assert_compatible(route, candidate_uids, affected)
