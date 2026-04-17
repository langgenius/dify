from __future__ import annotations

import enum


class ToolCredentialAccessScope(enum.StrEnum):
    """Who may use a workspace tool provider credential (plugin / builtin)."""

    # All workspace members may select and run tools with this credential.
    WORKSPACE = "workspace"
    # Only the creator may use this credential.
    PRIVATE = "private"
    # Creator plus explicitly listed workspace accounts (see ToolBuiltinProviderAllowedAccount).
    RESTRICTED = "restricted"
