"""Fresh immutable source bindings; never rebase a published migration implicitly.

A reviewed package/schema pair alone cannot rewrite publication-time source
markers or certify in-flight/recovery behavior. Until an explicit re-preparation
use case exists, an affected active SYSTEM source may only reinstall its exact
current UID. The target plugin retains its separate pinned bootstrap owner.
"""

import re
from collections.abc import Sequence
from typing import Protocol

from core.plugin.entities.plugin import PluginInstallationSource
from core.plugin.entities.plugin_daemon import PluginModelProviderBinding
from services.model_billing_dependency_inventory import ResolvedModelDependency
from services.model_billing_source_plugin_admission import SourcePluginAdmissionError, SourcePluginProtection


class SourcePluginMetadata(Protocol):
    def fetch_model_provider_bindings(self, tenant_id: str) -> Sequence[PluginModelProviderBinding]: ...


def _provider(binding: PluginModelProviderBinding) -> str:
    return binding.provider if binding.provider.count("/") == 2 else f"{binding.plugin_id}/{binding.provider}"


def _immutable(uid: str, plugin_id: str) -> bool:
    return bool(
        re.fullmatch(r"[a-z0-9_-]+/[a-z0-9_-]+:[^@]+@[0-9a-f]{64}", uid)
        and not any(char.isspace() for char in uid)
        and uid.split(":", 1)[0] == plugin_id
    )


class SourcePluginContractGateway:
    def __init__(self, *, metadata: SourcePluginMetadata, managed_target_plugin_id: str) -> None:
        if not re.fullmatch(r"[a-z0-9_-]+/[a-z0-9_-]+", managed_target_plugin_id):
            raise ValueError("Invalid managed target plugin identity")
        self._metadata = metadata
        self._managed_target_plugin_id = managed_target_plugin_id

    def _bindings(self, tenant_id: str) -> Sequence[PluginModelProviderBinding]:
        try:
            return self._metadata.fetch_model_provider_bindings(tenant_id)
        except Exception:
            raise SourcePluginAdmissionError("source_plugin_contract_unavailable") from None

    def installed_model_plugins(self, tenant_id: str, candidate_uids: Sequence[str]) -> frozenset[str]:
        bindings = self._bindings(tenant_id)
        if any(not re.fullmatch(r"[a-z0-9_-]+/[a-z0-9_-]+", item.plugin_id) for item in bindings):
            raise SourcePluginAdmissionError("source_plugin_binding_unverified")
        candidates = {uid.split(":", 1)[0] for uid in candidate_uids}
        return frozenset(item.plugin_id for item in bindings if item.plugin_id in candidates)

    def assert_frozen_bindings(self, tenant_id: str, candidate_uids: Sequence[str]) -> None:
        bindings = self._bindings(tenant_id)
        for uid in candidate_uids:
            plugin_id = uid.split(":", 1)[0]
            matching = [
                item
                for item in bindings
                if item.plugin_id == plugin_id and item.plugin_id != self._managed_target_plugin_id
            ]
            if not matching:
                continue
            if (
                {item.plugin_unique_identifier for item in matching} != {uid}
                or not _immutable(uid, plugin_id)
                or any(
                    item.source == PluginInstallationSource.Remote or item.runtime_type not in {"local", "serverless"}
                    for item in matching
                )
            ):
                raise SourcePluginAdmissionError("source_plugin_migration_cohort_frozen")

    def assert_compatible(
        self,
        route: SourcePluginProtection,
        candidate_uids: Sequence[str],
        dependencies: Sequence[ResolvedModelDependency],
    ) -> None:
        candidates: dict[str, str] = {}
        for uid in candidate_uids:
            plugin_id = uid.split(":", 1)[0]
            if not _immutable(uid, plugin_id):
                raise SourcePluginAdmissionError("source_plugin_candidate_not_immutable")
            if plugin_id in candidates and candidates[plugin_id] != uid:
                raise SourcePluginAdmissionError("source_plugin_candidate_ambiguous")
            candidates[plugin_id] = uid
        bindings = self._bindings(route.tenant_id)
        for dependency in dependencies:
            provider = dependency.provider
            if provider is None or provider.count("/") != 2:
                raise SourcePluginAdmissionError("source_plugin_dependency_unresolved")
            plugin_id = provider.rsplit("/", 1)[0]
            candidate = candidates.get(plugin_id)
            matching = [item for item in bindings if item.plugin_id == plugin_id and _provider(item) == provider]
            if (
                candidate is None
                or len(matching) != 1
                or matching[0].source == PluginInstallationSource.Remote
                or matching[0].runtime_type not in {"local", "serverless"}
                or not _immutable(matching[0].plugin_unique_identifier, plugin_id)
            ):
                raise SourcePluginAdmissionError("source_plugin_binding_unverified")
            if candidate != matching[0].plugin_unique_identifier:
                raise SourcePluginAdmissionError("source_plugin_replacement_requires_reprepare")
