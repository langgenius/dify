"""Client-safe top-level exports for the Dify Agent package.

Default installs must be able to import ``dify_agent`` without pulling in server
runtime adapters or their optional dependencies. Server-only adapter entry points
remain under ``dify_agent.adapters.llm``.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from dify_agent.client import Client


def __getattr__(name: str) -> object:
    if name == "Client":
        from dify_agent.client import Client

        return Client
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")

__all__ = ["Client"]
