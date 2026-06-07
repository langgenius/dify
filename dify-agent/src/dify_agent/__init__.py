"""Client-safe top-level exports for the Dify Agent package.

Default installs must be able to import ``dify_agent`` without pulling in server
runtime adapters or their optional dependencies. Server-only adapter entry points
remain under ``dify_agent.adapters.llm``.
"""

from dify_agent.client import Client

__all__ = ["Client"]
