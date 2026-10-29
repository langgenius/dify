"""Bind Web execution selections to persisted identity and the server-selected Workflow."""

from collections.abc import Mapping
from typing import Any

from pydantic import ValidationError

from clients.plugin.auth import PluginCredentialAuthClient
from context.connection_execution import ConnectionExecutionContext
from core.db.session_factory import get_session_maker
from models.model import Account, App, AppMode, EndUser
from models.workflow import Workflow
from repositories.end_user_connection_repository import EndUserConnectionRepository
from services.end_user_connection_adapters import PluginApiKeyCredentialGateway
from services.end_user_connection_identity import connection_context_from_web_passport
from services.end_user_connection_revision_adapters import PluginConnectionRevisions
from services.end_user_connections.errors import (
    ConnectionConfigurationError,
    ConnectionIdentityError,
    ConnectionRevisionChangedError,
)
from services.end_user_connections.execution import ConnectionRunInput
from services.workflow.tool_credentials import requires_end_user_connections


def prepare_web_connection_execution(
    *, app: App, user: Account | EndUser, workflow: Workflow, args: Mapping[str, Any]
) -> ConnectionExecutionContext | None:
    required = requires_end_user_connections(workflow.graph_dict)
    try:
        command = ConnectionRunInput.model_validate(
            {"connection_revision": args.get("connection_revision"), "connections": args.get("connections")}
        )
    except ValidationError:
        raise ValueError("Invalid connection execution payload.") from None
    repository = EndUserConnectionRepository(session_factory=get_session_maker())
    if not required and command.connection_revision is not None:
        PluginConnectionRevisions(
            providers=PluginApiKeyCredentialGateway(auth=PluginCredentialAuthClient()), snapshots=repository
        ).require(app.tenant_id, app.id, workflow.graph_dict, command.connection_revision)
    if not required and command.connections:
        raise ConnectionConfigurationError()
    if not isinstance(user, EndUser):
        if required:
            raise ConnectionIdentityError()
        return None
    identity = connection_context_from_web_passport(app=app, end_user=user)
    if workflow.tenant_id != identity.tenant_id or workflow.app_id != identity.app_id:
        raise ConnectionIdentityError()

    if not required:
        repository.validate_execution_identity(identity, args.get("conversation_id"))
        return None

    from extensions.ext_application_services import application_services

    services = application_services()
    conversation_id = args.get("conversation_id")
    has_explicit_connections = "connections" in args
    if app.mode == AppMode.ADVANCED_CHAT and conversation_id and not has_explicit_connections:
        command = command.model_copy(
            update={"connections": services.connection_selections.restore(identity, workflow.id, conversation_id)}
        )
    return services.end_user_connection_execution.prepare(
        identity,
        command,
        workflow_id=workflow.id,
        conversation_id=args.get("conversation_id"),
    )


def validate_connection_execution(
    context: ConnectionExecutionContext,
    *,
    app: App,
    user: Account | EndUser,
    workflow: Workflow,
    conversation_id: str | None,
    repository: EndUserConnectionRepository,
) -> None:
    """Reconstruct authority after serialization without selecting a newer publication."""
    if not isinstance(user, EndUser):
        raise ConnectionIdentityError()
    identity = connection_context_from_web_passport(app=app, end_user=user)
    if (
        identity.tenant_id != context.tenant_id
        or identity.app_id != context.app_id
        or identity.end_user_id != context.end_user_id
        or identity.account_id != context.account_id
        or workflow.id != context.workflow_id
        or workflow.tenant_id != identity.tenant_id
        or workflow.app_id != identity.app_id
    ):
        raise ConnectionIdentityError()
    if workflow.version == Workflow.VERSION_DRAFT:
        raise ConnectionRevisionChangedError()
    repository.validate_execution_identity(identity, conversation_id)
