"""Resolve published, independent tool requirements and explicit reuse groups."""

from collections.abc import Mapping
from typing import Any, Protocol

from pydantic import ValidationError

from constants.end_user_connections import ConnectionCredentialType
from core.tools.plugin_tool.provider import PluginToolProviderController
from models.provider_ids import ToolProviderID
from services.end_user_connection_adapters import PluginApiKeyCredentialGateway
from services.end_user_connection_oauth_adapters import PluginConnectionOAuthGateway
from services.end_user_connections.entities import ConnectionOAuthClient, ToolConnectionTarget, WebConnectionContext
from services.end_user_connections.errors import ConnectionConfigurationError, ConnectionReauthorizationRequiredError
from services.end_user_connections.preflight import ConnectionRequirement
from services.workflow.tool_credentials import ToolCredentialConfig, check_tool_credentials


class PreflightGraphQuery(Protocol):
    def preflight_graph(
        self, context: WebConnectionContext, workflow_id: str, conversation_id: str | None
    ) -> Mapping[str, Any]: ...


class PublishedPreflightRequirements:
    def __init__(
        self,
        *,
        workflows: PreflightGraphQuery,
        providers: PluginApiKeyCredentialGateway,
        oauth: PluginConnectionOAuthGateway,
    ) -> None:
        self._workflows = workflows
        self._providers = providers
        self._oauth = oauth

    def resolve(
        self,
        context: WebConnectionContext,
        workflow_id: str,
        conversation_id: str | None,
        *,
        oauth_providers: frozenset[str],
    ) -> tuple[ConnectionRequirement, ...]:
        graph = self._workflows.preflight_graph(context, workflow_id, conversation_id)
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
            clients: dict[str, ConnectionOAuthClient | None] = {}
            requirements: list[ConnectionRequirement] = []
            for node_id, config in configs.items():
                if config.credential_source != "end_user":
                    continue
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
                if not allowed or not allowed.issubset(supported):
                    raise ConnectionConfigurationError()
                if (
                    canonical in oauth_providers
                    and ConnectionCredentialType.OAUTH2 in allowed
                    and canonical not in clients
                ):
                    try:
                        clients[canonical] = self._oauth.resolve_client(context.tenant_id, canonical).snapshot.reference
                    except ConnectionReauthorizationRequiredError:
                        clients[canonical] = None
                title = data.get("title")
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
                            oauth_client=clients.get(canonical),
                        ),
                        title=title if isinstance(title, str) and title else node_id,
                        purpose=auth.purpose,
                        node_ids=(node_id, *(key for key, value in configs.items() if value.reuse_node_id == node_id)),
                    )
                )
            return tuple(requirements)
        except (KeyError, TypeError, ValueError, ValidationError):
            raise ConnectionConfigurationError() from None
