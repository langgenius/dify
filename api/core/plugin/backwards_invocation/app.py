"""Compatibility exports for the service-owned plugin App invocation boundary.

New callers must import from :mod:`services.plugin.app_invocation`. This module
only keeps the historical import path working until the remaining legacy core
plugin callers are retired.
"""

from services.plugin.app_invocation import AppScopedEndUserProvisioner, PluginAppBackwardsInvocation

__all__ = ["AppScopedEndUserProvisioner", "PluginAppBackwardsInvocation"]
