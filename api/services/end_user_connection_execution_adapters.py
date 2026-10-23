"""Bind Web execution selections to persisted identity and the server-selected Workflow."""

from collections.abc import Mapping
from typing import Any

from pydantic import ValidationError

from context.connection_execution import ConnectionExecutionContext
from models.model import Account, App, AppMode, EndUser
from models.workflow import Workflow
from repositories.end_user_connection_repository import EndUserConnectionRepository
from services.end_user_connection_identity import connection_context_from_web_passport
from services.end_user_connections.errors import (
    ConnectionConfigurationError,
    ConnectionIdentityError,
    ConnectionWorkflowChangedError,
)
from services.end_user_connections.execution import ConnectionRunInput
from services.workflow.tool_credentials import requires_end_user_connections


def prepare_web_connection_execution(
    *, app: App, user: Account | EndUser, workflow: Workflow, args: Mapping[str, Any], workflow_run_id: str
) -> ConnectionExecutionContext | None:
    required = requires_end_user_connections(workflow.graph_dict)
    try:
        command = ConnectionRunInput.model_validate(
            {"workflow_id": args.get("workflow_id"), "connections": args.get("connections")}
        )
    except ValidationError:
        raise ValueError("Invalid connection execution payload.") from None
    if command.workflow_id is not None and str(command.workflow_id) != workflow.id:
        raise ConnectionWorkflowChangedError()
    if not required and command.connections:
        raise ConnectionConfigurationError()
    if not isinstance(user, EndUser):
        if required:
            raise ConnectionIdentityError()
        return None
    identity = connection_context_from_web_passport(app=app, end_user=user)
    if workflow.tenant_id != identity.tenant_id or workflow.app_id != identity.app_id:
        raise ConnectionIdentityError()

    from extensions.ext_application_services import application_services

    services = application_services()
    conversation_id = args.get("conversation_id")
    has_explicit_connections = "connections" in args
    if not required:
        empty = ConnectionExecutionContext(
            tenant_id=identity.tenant_id,
            app_id=identity.app_id,
            end_user_id=identity.end_user_id,
            account_id=identity.account_id,
            workflow_id=workflow.id,
            selections=(),
        )
        services.connection_selections.save_run(empty, workflow_run_id, conversation_id, update_conversation=True)
        return None
    if app.mode == AppMode.ADVANCED_CHAT and conversation_id and not has_explicit_connections:
        command = command.model_copy(
            update={"connections": services.connection_selections.restore(identity, workflow.id, conversation_id)}
        )
    execution = services.end_user_connection_execution.prepare(
        identity,
        command,
        workflow_id=workflow.id,
        conversation_id=args.get("conversation_id"),
    )
    services.connection_selections.save_run(
        execution, workflow_run_id, conversation_id, update_conversation=has_explicit_connections
    )
    return execution


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
        raise ConnectionWorkflowChangedError()
    repository.validate_execution_identity(identity, conversation_id)
