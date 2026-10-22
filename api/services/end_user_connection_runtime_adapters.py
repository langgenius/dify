"""Resolve a tool's fixed credential source without falling back to workspace credentials."""

from collections.abc import Mapping
from typing import Any

from clients.plugin.auth import PluginCredentialAuthClient
from constants.end_user_connections import ConnectionCredentialType
from core.app.entities.app_invoke_entities import DifyRunContext, InvokeFrom, UserFrom
from core.db import session_factory
from core.plugin.entities.plugin_daemon import CredentialType
from core.plugin.impl.oauth import OAuthHandler
from core.tools.__base.tool import Tool
from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.entities.tool_entities import ToolInvokeFrom
from core.tools.tool_manager import ToolManager, WorkflowToolRuntimeSpec
from graphon.nodes.tool.exc import ToolNodeError, ToolRuntimeResolutionError
from graphon.runtime import VariablePool
from models.provider_ids import ToolProviderID
from repositories.end_user_connection_repository import EndUserConnectionRepository
from services.end_user_connection_adapters import PluginApiKeyCredentialGateway
from services.end_user_connection_oauth_adapters import PluginConnectionOAuthGateway
from services.end_user_connections.entities import ToolConnectionTarget, WebConnectionContext
from services.end_user_connections.errors import (
    ConnectionConfigurationError,
    ConnectionError,
    ConnectionIdentityError,
    ConnectionRequiredError,
)
from services.end_user_connections.policy import require_owned_connection
from services.workflow.tool_credentials import resolve_tool_credential_root


def get_tool_runtime(
    *,
    run_context: DifyRunContext,
    workflow_id: str,
    graph: Mapping[str, Any],
    node_id: str,
    spec: WorkflowToolRuntimeSpec,
    variable_pool: VariablePool | None,
) -> Tool:
    try:
        root_id, root = resolve_tool_credential_root(graph, node_id)
        if root.tool_name != spec.tool_name or root.provider_type.value != spec.provider_type.value:
            raise ConnectionConfigurationError()
        if spec.provider_id != root.provider_id and str(ToolProviderID(spec.provider_id)) != str(
            ToolProviderID(root.provider_id)
        ):
            raise ConnectionConfigurationError()
        if root.credential_source == "workspace":
            tool = ToolManager.get_tool_runtime(
                provider_type=spec.provider_type,
                provider_id=spec.provider_id,
                tool_name=spec.tool_name,
                tenant_id=run_context.tenant_id,
                user_id=run_context.user_id,
                invoke_from=run_context.invoke_from,
                tool_invoke_from=ToolInvokeFrom.WORKFLOW,
                credential_id=root.credential_id,
            )
        else:
            context = run_context.connection_context
            if context is None:
                raise ConnectionRequiredError()
            if (
                run_context.invoke_from != InvokeFrom.WEB_APP
                or run_context.user_from != UserFrom.END_USER
                or context.tenant_id != run_context.tenant_id
                or context.app_id != run_context.app_id
                or context.end_user_id != run_context.user_id
                or context.workflow_id != workflow_id
            ):
                raise ConnectionIdentityError()
            identity = WebConnectionContext(context.tenant_id, context.app_id, context.end_user_id, context.account_id)
            repository = EndUserConnectionRepository(session_factory=session_factory.get_session_maker())
            repository.validate_execution_context(identity, workflow_id, conversation_id=None)
            selections = [selection for selection in context.selections if selection.node_id == root_id]
            if len(selections) != 1 or selections[0].connection_id is None:
                raise ConnectionRequiredError()
            selection = selections[0]
            connection_id = selection.connection_id
            assert connection_id is not None
            record = require_owned_connection(
                identity, repository.access_records(identity, frozenset({connection_id})).get(connection_id)
            )
            auth = PluginApiKeyCredentialGateway(auth=PluginCredentialAuthClient())
            provider = auth.provider(identity.tenant_id, root.provider_id)
            canonical = str(ToolProviderID(provider.entity.identity.name))
            if selection.provider != canonical or root.end_user_auth is None:
                raise ConnectionConfigurationError()
            oauth_client = None
            if record.credential_type == ConnectionCredentialType.OAUTH2:
                gateway = PluginConnectionOAuthGateway(
                    clients=repository,
                    providers=auth,
                    handler=OAuthHandler(),
                    auth=PluginCredentialAuthClient(),
                )
                oauth_client = gateway.resolve_client(identity.tenant_id, canonical).snapshot.reference
            target = ToolConnectionTarget(
                tenant_id=identity.tenant_id,
                app_id=identity.app_id,
                workflow_id=workflow_id,
                node_id=root_id,
                provider=canonical,
                allowed_credential_types=frozenset(
                    ConnectionCredentialType(value) for value in root.end_user_auth.allowed_credential_types or ()
                ),
                provider_credential_types=frozenset(
                    ConnectionCredentialType(value.value)
                    for value in provider.get_supported_credential_types()
                    if value.value in {"api-key", "oauth2"}
                ),
                oauth_client=oauth_client,
            )
            from extensions.ext_application_services import application_services

            resolved = application_services().end_user_connection_runtime.resolve(
                identity, connection_id=connection_id, target=target
            )
            tool = provider.get_tool(spec.tool_name).fork_tool_runtime(
                runtime=ToolRuntime(
                    tenant_id=identity.tenant_id,
                    user_id=identity.end_user_id,
                    invoke_from=run_context.invoke_from,
                    tool_invoke_from=ToolInvokeFrom.WORKFLOW,
                    credentials=dict(resolved.credentials),
                    credential_type=CredentialType(resolved.access.credential_type.value),
                    connection_id=resolved.access.id,
                )
            )
        return ToolManager.get_workflow_tool_runtime(
            run_context.tenant_id,
            run_context.app_id,
            node_id,
            spec,
            run_context.user_id,
            run_context.invoke_from,
            variable_pool,
            tool_runtime=tool,
        )
    except ConnectionError as exc:
        raise ToolRuntimeResolutionError(str(exc)) from None
    except ToolNodeError:
        raise
    except Exception:
        raise ToolRuntimeResolutionError("Could not resolve the tool connection.") from None
