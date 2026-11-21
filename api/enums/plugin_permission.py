"""Workspace plugin permission levels, independent of persistence models.

The string values are stored in ``account_plugin_permissions`` and exposed in the
Console API contract, so they must stay stable.
"""

from enum import StrEnum


class TenantPluginInstallPermission(StrEnum):
    EVERYONE = "everyone"
    ADMINS = "admins"
    NOBODY = "noone"


class TenantPluginDebugPermission(StrEnum):
    EVERYONE = "everyone"
    ADMINS = "admins"
    NOBODY = "noone"
