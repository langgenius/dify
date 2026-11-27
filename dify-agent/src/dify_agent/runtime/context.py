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
from dify_agent.runtime.tool_call_limits import InMemoryToolCallLimitStore

if TYPE_CHECKING:
    from dify_agent.layers.browser.layer import BrowserSession
    from dify_agent.layers.knowledge_fs.session import KnowledgeFsSessionStore
    from dify_agent.layers.shell.layer import ShellSession


class LayerData(TypedDict):
    config: dict[str, JsonValue]
    state: dict[str, JsonValue]


@dataclass
class BrowserSessionSlots:
    """Synchronous, fail-fast counter of live browser sessions per process.

    One headless Chromium per session makes this a memory ceiling, so a
    saturated counter fails the run immediately (retryable) instead of
    queueing behind other runs.
    """

    limit: int
    in_use: int = 0

    def try_acquire(self) -> bool:
        if self.in_use >= self.limit:
            return False
        self.in_use += 1
        return True

    def release(self) -> None:
        self.in_use = max(0, self.in_use - 1)


@dataclass
class Services:
    """Lifespan-owned infrastructure borrowed by every run."""

    plugin_daemon_http_client: httpx.AsyncClient
    dify_api_http_client: httpx.AsyncClient
    plugin_daemon_url: str = "http://localhost:5002"
    plugin_daemon_api_key: str = field(default="", repr=False)
    inner_api_url: str = "http://localhost:5001"
    inner_api_key: str = field(default="", repr=False)
    agent_file_upload_max_bytes: int = 50 * 1024 * 1024
    runtime_backend_profile: RuntimeBackendProfile | None = None
    shell_redact_patterns: list[str] = field(default_factory=list)
    agent_stub_api_base_url: str | None = None
    agent_stub_token_factory: ShellAgentStubTokenFactory | None = None
    knowledge_session_store: KnowledgeFsSessionStore | None = None
    # Process-wide cap on live browser sessions (one headless Chromium each).
    # Owned by the lifespan so every run shares one counter; None = uncapped.
    browser_session_slots: BrowserSessionSlots | None = None


@dataclass
class RunResources:
    leases: dict[str, RuntimeLease] = field(default_factory=dict)
    shells: dict[str, ShellSession] = field(default_factory=dict)
    browsers: dict[str, BrowserSession] = field(default_factory=dict)


@dataclass
class Deps:
    layers: dict[str, LayerData]
    services: Services
    run_id: str
    resources: RunResources = field(default_factory=RunResources)
    # Live counters never enter layer/session state or lifespan Services.
    tool_call_limit_store: InMemoryToolCallLimitStore = field(default_factory=InMemoryToolCallLimitStore)
