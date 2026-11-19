"""Loaded provider data consumed outside database transactions."""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Protocol

from core.plugin.entities.plugin_daemon import CredentialType
from core.tools.entities.tool_entities import ToolProviderType
from models.tools import BuiltinToolProvider, MCPToolProvider
from services.tools.api.contracts import ApiToolProviderRecord


@dataclass(frozen=True)
class BuiltinCredential:
    id: str
    tenant_id: str
    provider: str
    user_id: str
    credential_type: CredentialType
    encrypted_credentials: str | None
    credentials: dict[str, Any]
    expires_at: int
    updated_at: datetime


@dataclass(frozen=True)
class ToolOAuthClient:
    tenant_params: dict[str, Any] | None
    system_params: str | None


@dataclass(frozen=True)
class MCPProviderRecord:
    provider: MCPToolProvider
    author: str


class ToolProviderIcons(Protocol):
    def icon(self, *, tenant_id: str, provider_type: ToolProviderType, provider_id: str) -> str | None: ...


class ToolProviders(ToolProviderIcons, Protocol):
    def api_providers(self, *, tenant_id: str) -> list[ApiToolProviderRecord]: ...

    def api_by_name(self, *, tenant_id: str, name: str) -> ApiToolProviderRecord | None: ...

    def api_labels(self, *, tenant_id: str, provider_ids: Sequence[str]) -> dict[str, list[str]]: ...

    def default_builtin(self, *, tenant_id: str) -> list[BuiltinToolProvider]: ...

    def mcp_providers(self, *, tenant_id: str) -> list[MCPProviderRecord]: ...

    def mcp_record(self, *, tenant_id: str, provider_id: str) -> MCPProviderRecord | None: ...

    def mcp(self, *, tenant_id: str, provider_id: str) -> MCPToolProvider | None: ...

    def get(self, *, tenant_id: str, provider_id: str) -> ApiToolProviderRecord | None: ...

    def builtin_credential(
        self, *, tenant_id: str, provider_names: Sequence[str], credential_id: str | None
    ) -> BuiltinCredential | None: ...

    def oauth_client(self, *, tenant_id: str, plugin_id: str, provider: str) -> ToolOAuthClient: ...

    def refresh_builtin_credential(
        self, *, record: BuiltinCredential, credentials: Mapping[str, Any], expires_at: int
    ) -> bool: ...
