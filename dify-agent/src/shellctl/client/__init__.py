"""Async HTTP client package for shellctl.

`shellctl.client` remains importable as before, but it is
 now a package so future client helpers can live beside the main SDK class.
"""

from shellctl.client.sdk import (
    ShellctlClient,
    ShellctlClientError,
)

__all__ = ["ShellctlClient", "ShellctlClientError"]
