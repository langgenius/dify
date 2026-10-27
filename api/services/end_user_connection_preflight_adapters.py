"""Resolve published, independent tool requirements and explicit reuse groups."""

from collections.abc import Mapping
from typing import Any, Protocol

from pydantic import ValidationError

from constants.end_user_connections import ConnectionCredentialType, OAuthClientSource
from core.tools.plugin_tool.provider import PluginToolProviderController
from models.provider_ids import ToolProviderID
from services.end_user_connection_adapters import PluginApiKeyCredentialGateway, validate_provider_authentication
from services.end_user_connection_oauth_adapters import PluginConnectionOAuthGateway
from services.end_user_connection_revision_adapters import PluginConnectionRevisions
from services.end_user_connections.entities import ConnectionOAuthClient, ToolConnectionTarget, WebConnectionContext
from services.end_user_connections.errors import (
    ConnectionConfigurationError,
    ConnectionReauthorizationRequiredError,
)
from services.end_user_connections.preflight import ConnectionRequirement
from services.end_user_connections.revision import ConnectionRevisionSnapshots
from services.workflow.tool_credentials import (
    ToolCredentialConfig,
    check_tool_credentials,
    get_tool_connection_requirements,
)


class PreflightGraphQuery(Protocol):
    def preflight_graph(
        self, context: WebConnectionContext, workflow_id: str | None, conversation_id: str | None
    ) -> tuple[str, Mapping[str, Any]]: ...


class PublishedPreflightRequirements:
    def __init__(
        self,
        *,
        workflows: PreflightGraphQuery,
        providers: PluginApiKeyCredentialGateway,
        oauth: PluginConnectionOAuthGateway,
        snapshots: ConnectionRevisionSnapshots,
    ) -> None:
        self._workflows = workflows
        self._providers = providers
        self._oauth = oauth
        self._revisions = PluginConnectionRevisions(providers=providers, snapshots=snapshots)

    def resolve(
        self,
        context: WebConnectionContext,
        workflow_id: str | None,
        conversation_id: str | None,
        *,
        oauth_providers: frozenset[str],
        connection_revision: str,
    ) -> tuple[str, str, tuple[ConnectionRequirement, ...]]:
        workflow_id, graph = self._workflows.preflight_graph(context, workflow_id, conversation_id)
        revision = self._revisions.require(context.tenant_id, context.app_id, graph, connection_revision)
        try:
            if check_tool_credentials(graph, complete=True):
                raise ConnectionConfigurationError()
            nodes = {
                node["id"]: node["data"]
                for node in graph.get("nodes", [])
                if isinstance(node, Mapping)
                and node.get("type") != "custom-note"
                and isinstance(node.get("data"), Mapping)
                and node["data"].get("type") == "tool"
            }
            configs = {node_id: ToolCredentialConfig.model_validate(data) for node_id, data in nodes.items()}
            providers: dict[str, PluginToolProviderController] = {}
            clients: dict[tuple[str, OAuthClientSource], ConnectionOAuthClient | None] = {}
            requirements: list[ConnectionRequirement] = []
            for requirement in get_tool_connection_requirements(graph):
                node_id = requirement.node_id
                config = configs[node_id]
                auth = config.end_user_auth
                if auth is None or auth.purpose is None:
                    raise ConnectionConfigurationError()
                data = nodes[node_id]
                reference = data["provider_id"]
                if reference not in providers:
                    providers[reference] = self._providers.provider(context.tenant_id, reference)
                provider = providers[reference]
                if provider.get_tool(data["tool_name"]) is None:
                    raise ConnectionConfigurationError()
                canonical = str(ToolProviderID(provider.entity.identity.name))
                allowed = frozenset(ConnectionCredentialType(value) for value in auth.allowed_credential_types or ())
                supported = frozenset(
                    ConnectionCredentialType(value.value)
                    for value in provider.get_supported_credential_types()
                    if value.value in {"api-key", "oauth2"}
                )
                validate_provider_authentication(provider, auth)
                source = auth.oauth_client_source
                client_key = (canonical, source) if source is not None else None
                if (
                    canonical in oauth_providers
                    and ConnectionCredentialType.OAUTH2 in allowed
                    and client_key is not None
                    and client_key not in clients
                ):
                    try:
                        clients[client_key] = self._oauth.resolve_client(
                            context.tenant_id, canonical, client_key[1]
                        ).snapshot
                    except ConnectionReauthorizationRequiredError:
                        clients[client_key] = None
                requirements.append(
                    ConnectionRequirement(
                        target=ToolConnectionTarget(
                            tenant_id=context.tenant_id,
                            app_id=context.app_id,
                            workflow_id=workflow_id,
                            node_id=node_id,
                            provider=canonical,
                            allowed_credential_types=allowed,
                            provider_credential_types=supported,
                            oauth_client_source=source,
                            oauth_client=clients.get(client_key) if client_key is not None else None,
                        ),
                        title=requirement.title,
                        purpose=requirement.purpose,
                        node_ids=requirement.node_ids,
                    )
                )
            return workflow_id, revision, tuple(requirements)
        except (KeyError, TypeError, ValueError, ValidationError):
            raise ConnectionConfigurationError() from None
