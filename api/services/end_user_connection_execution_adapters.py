"""Bind Web execution selections to persisted identity and the server-selected Workflow."""

from collections.abc import Mapping
from typing import Any

from pydantic import ValidationError

from context.connection_execution import ConnectionExecutionContext
from models.model import Account, App, EndUser
from models.workflow import Workflow
from repositories.end_user_connection_repository import EndUserConnectionRepository
from services.end_user_connection_identity import connection_context_from_web_passport
from services.end_user_connections.errors import ConnectionIdentityError
from services.end_user_connections.execution import ConnectionRunInput
from services.workflow.tool_credentials import requires_end_user_connections


def prepare_web_connection_execution(
    *, app: App, user: Account | EndUser, workflow: Workflow, args: Mapping[str, Any]
) -> ConnectionExecutionContext | None:
    if (
        args.get("workflow_id") is None
        and args.get("connections") is None
        and not requires_end_user_connections(workflow.graph_dict)
    ):
        return None
    if not isinstance(user, EndUser):
        raise ConnectionIdentityError()
    identity = connection_context_from_web_passport(app=app, end_user=user)
    if workflow.tenant_id != identity.tenant_id or workflow.app_id != identity.app_id:
        raise ConnectionIdentityError()
    try:
        command = ConnectionRunInput.model_validate(
            {"workflow_id": args.get("workflow_id"), "connections": args.get("connections")}
        )
    except ValidationError:
        raise ValueError("Invalid connection execution payload.") from None

    from extensions.ext_application_services import application_services

    return application_services().end_user_connection_execution.prepare(
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
        or conversation_id != context.conversation_id
    ):
        raise ConnectionIdentityError()
    repository.validate_execution_context(identity, context.workflow_id, context.conversation_id)
