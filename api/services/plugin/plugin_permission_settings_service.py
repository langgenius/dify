"""Workspace plugin permission settings use cases.

This application module is framework, ORM, persistence, and configuration neutral.
It works with the admitted ``RequestContext`` and immutable settings records, and
reaches storage only through the consumer-owned ``PluginPermissionSettingsStore``.

Invariants:
- Every operation is scoped to the admitted caller's active workspace; callers
  never pass a workspace identifier of their own.
- A workspace stores at most one settings record. The persistence adapter enforces
  this with the ``unique_tenant_plugin`` constraint.
- A workspace without stored settings reads as ``DEFAULT_PLUGIN_PERMISSION_SETTINGS``
  (install by admins, debug by everyone). This is the established Console contract
  and intentionally differs from the persistence column default for debugging,
  which only applies to rows inserted without an explicit value.

Who may change settings is decided by the transport, which preserves the legacy
account property check, including its RBAC-enabled bypass. This module does not
repeat that policy.
"""

from dataclasses import dataclass
from typing import Protocol

from enums.plugin_permission import TenantPluginDebugPermission, TenantPluginInstallPermission
from machinery.context import RequestContext


@dataclass(frozen=True, slots=True)
class PluginPermissionSettings:
    """Immutable plugin install and debug permission levels of one workspace."""

    install_permission: TenantPluginInstallPermission
    debug_permission: TenantPluginDebugPermission


DEFAULT_PLUGIN_PERMISSION_SETTINGS = PluginPermissionSettings(
    install_permission=TenantPluginInstallPermission.ADMINS,
    debug_permission=TenantPluginDebugPermission.EVERYONE,
)


class PluginPermissionSettingsStore(Protocol):
    """Persistence port for workspace plugin permission settings.

    Owner scope: every operation reads or writes only the row of ``workspace_id``.
    Transactions: each operation owns one short session; ``save_settings`` commits
    one bounded write transaction before returning.
    Concurrency: settings are replaced as a whole, so the last committed write wins.
    The ``unique_tenant_plugin`` constraint keeps one row per workspace; when a
    concurrent first write inserts that row first, the adapter replaces it instead
    of creating a duplicate.
    Errors: database failures propagate unchanged and leave no partial write.
    """

    def get_settings(self, workspace_id: str) -> PluginPermissionSettings | None:
        """Return the stored settings, or ``None`` when the workspace has no row."""
        ...

    def save_settings(self, workspace_id: str, settings: PluginPermissionSettings) -> None:
        """Insert or replace the workspace row with ``settings`` and commit."""
        ...


class PluginPermissionSettingsService:
    """Read and replace the plugin permission settings of the active workspace."""

    def __init__(self, *, settings: PluginPermissionSettingsStore) -> None:
        self._settings = settings

    def get_settings(self, context: RequestContext) -> PluginPermissionSettings:
        """Return the effective settings of the caller's active workspace.

        Preconditions: ``context`` was admitted with a non-empty active workspace.
        Postconditions: returns the stored settings, or
        ``DEFAULT_PLUGIN_PERMISSION_SETTINGS`` when none are stored. No state changes.
        Raises ``ValueError`` when the context has no active workspace.
        """
        stored = self._settings.get_settings(_workspace_id(context))
        return DEFAULT_PLUGIN_PERMISSION_SETTINGS if stored is None else stored

    def change_settings(
        self,
        context: RequestContext,
        settings: PluginPermissionSettings,
    ) -> PluginPermissionSettings:
        """Replace the settings of the caller's active workspace.

        Preconditions: ``context`` was admitted with a non-empty active workspace and
        the caller is allowed to change workspace plugin permissions.
        Postconditions: on success the workspace has exactly one stored row equal to
        ``settings``, other workspaces are unchanged, and ``settings`` is returned.
        On failure the stored settings are unchanged.
        Raises ``ValueError`` when the context has no active workspace.
        """
        self._settings.save_settings(_workspace_id(context), settings)
        return settings


def _workspace_id(context: RequestContext) -> str:
    """Return the admitted active workspace, rejecting account-only contexts."""
    if not context.active_workspace_id:
        raise ValueError("Plugin permission settings require an active workspace.")
    return context.active_workspace_id
