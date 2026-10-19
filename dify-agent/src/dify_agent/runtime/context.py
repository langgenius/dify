"""Dependencies for native Pydantic AI modules.

``layers`` is the sole source of module config and persisted state. Models are
validated copies and state changes must be dumped back explicitly. Services are
borrowed from the server lifespan; resources exist only inside one native run
and are closed by the capability that acquired them.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, TypedDict

import httpx
from pydantic import JsonValue

from dify_agent.agent_stub.shell_env import ShellAgentStubTokenFactory
from dify_agent.runtime_backend import RuntimeBackendProfile, RuntimeLease

if TYPE_CHECKING:
    from dify_agent.layers.shell.layer import ShellSession


class LayerData(TypedDict):
    config: dict[str, JsonValue]
    state: dict[str, JsonValue]


@dataclass
class Services:
    """Lifespan-owned infrastructure borrowed by every run."""

    plugin_daemon_http_client: httpx.AsyncClient
    dify_api_http_client: httpx.AsyncClient
    plugin_daemon_url: str = "http://localhost:5002"
    plugin_daemon_api_key: str = field(default="", repr=False)
    inner_api_url: str = "http://localhost:5001"
    inner_api_key: str = field(default="", repr=False)
    runtime_backend_profile: RuntimeBackendProfile | None = None
    shell_redact_patterns: list[str] = field(default_factory=list)
    agent_stub_api_base_url: str | None = None
    agent_stub_token_factory: ShellAgentStubTokenFactory | None = None


@dataclass
class RunResources:
    leases: dict[str, RuntimeLease] = field(default_factory=dict)
    shells: dict[str, ShellSession] = field(default_factory=dict)


@dataclass
class Deps:
    layers: dict[str, LayerData]
    services: Services
    run_id: str
    resources: RunResources = field(default_factory=RunResources)
