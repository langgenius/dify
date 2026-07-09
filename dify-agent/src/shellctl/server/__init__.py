"""shellctl server package.

The server stack sits behind lazy exports so importing the network CLI does not
pull in FastAPI, SQLAlchemy, tmux, or the local service runtime unless a
server-side symbol is actually used.
"""

from __future__ import annotations

from importlib import import_module
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from shellctl.server.api import create_app
    from shellctl.server.cli import (
        cli,
        main,
    )
    from shellctl.server.config import ShellctlConfig
    from shellctl.server.db import JobRow
    from shellctl.server.errors import ShellctlServerError
    from shellctl.server.serve import serve_command
    from shellctl.server.service import ShellctlService

__all__ = [
    "JobRow",
    "ShellctlConfig",
    "ShellctlServerError",
    "ShellctlService",
    "cli",
    "create_app",
    "main",
    "serve_command",
]

_EXPORTS = {
    "JobRow": "shellctl.server.db",
    "ShellctlConfig": "shellctl.server.config",
    "ShellctlServerError": "shellctl.server.errors",
    "ShellctlService": "shellctl.server.service",
    "cli": "shellctl.server.cli",
    "create_app": "shellctl.server.api",
    "main": "shellctl.server.cli",
    "serve_command": "shellctl.server.serve",
}


def __getattr__(name: str) -> Any:
    if name not in _EXPORTS:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    module = import_module(_EXPORTS[name])
    value = getattr(module, name)  # noqa: no-new-getattr lazy export proxy
    globals()[name] = value
    return value


def __dir__() -> list[str]:
    return sorted(set(globals()) | set(__all__))
