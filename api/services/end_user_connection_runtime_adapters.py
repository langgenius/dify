"""Resolve a tool's fixed credential source without falling back to workspace credentials."""

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any

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
from services.end_user_connection_adapters import PluginApiKeyCredentialGateway, validate_provider_authentication
from services.end_user_connection_oauth_adapters import PluginConnectionOAuthGateway
from services.end_user_connection_revision_adapters import PluginConnectionRevisions
from services.end_user_connections.entities import ToolConnectionTarget, WebConnectionContext
from services.end_user_connections.errors import (
    ConnectionConfigurationError,
    ConnectionError,
    ConnectionIdentityError,
    ConnectionRequiredError,
)
from services.end_user_connections.policy import require_owned_connection
from services.end_user_connections.revision import ConnectionRevisionAcceptance
from services.workflow.tool_credentials import resolve_tool_credential_root

if TYPE_CHECKING:
    from core.app.apps.workflow_app_runner import WorkflowRunDriver
    from core.tools.workflow_as_tool.tool import WorkflowTool


def get_tool_runtime(
    *,
    run_context: DifyRunContext,
    workflow_id: str,
    graph: Mapping[str, Any],
    node_id: str,
    spec: WorkflowToolRuntimeSpec,
    variable_pool: VariablePool | None,
    execution_driver: "WorkflowRunDriver | None" = None,
    workflow_tool_definition: "WorkflowTool | None" = None,
) -> Tool:
    try:
        root_id, root = resolve_tool_credential_root(graph, node_id)
        node_data = next(
            node["data"]
            for node in graph.get("nodes", [])
            if node.get("type") != "custom-note" and node["id"] == node_id
        )
        if node_data["tool_name"] != spec.tool_name or root.provider_type.value != spec.provider_type.value:
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
                execution_driver=execution_driver,
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
            revisions = PluginConnectionRevisions(providers=auth, snapshots=repository)
            revisions.require(identity.tenant_id, identity.app_id, graph, context.connection_revision)
            provider = auth.provider(identity.tenant_id, root.provider_id)
            canonical = str(ToolProviderID(provider.entity.identity.name))
            if selection.provider != canonical or root.end_user_auth is None:
                raise ConnectionConfigurationError()
            validate_provider_authentication(provider, root.end_user_auth)
            source = root.end_user_auth.oauth_client_source
            oauth_client = None
            if record.credential_type == ConnectionCredentialType.OAUTH2:
                gateway = PluginConnectionOAuthGateway(
                    clients=repository,
                    providers=auth,
                    handler=OAuthHandler(),
                    auth=PluginCredentialAuthClient(),
                )
                if source is None:
                    raise ConnectionConfigurationError()
                oauth_client = gateway.resolve_client(identity.tenant_id, canonical, source).snapshot.reference
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
                oauth_client_source=source,
                oauth_client=oauth_client,
            )
            from extensions.ext_application_services import application_services

            resolved = application_services().end_user_connection_runtime.resolve(
                identity, connection=record, target=target, connection_revision=context.connection_revision
            )
            accepted_revision = revisions.require(
                identity.tenant_id, identity.app_id, graph, context.connection_revision
            )
            repository.record_revision_acceptance(
                identity, ConnectionRevisionAcceptance.from_revisions(context.connection_revision, accepted_revision)
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
            execution_driver=execution_driver,
            workflow_tool_definition=workflow_tool_definition,
        )
    except ConnectionError as exc:
        raise ToolRuntimeResolutionError(str(exc)) from None
    except ToolNodeError:
        raise
    except Exception:
        raise ToolRuntimeResolutionError("Could not resolve the tool connection.") from None
