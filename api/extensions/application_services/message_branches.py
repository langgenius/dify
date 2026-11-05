"""Adapt admitted execution identities to the transcript-selection use case."""

from machinery.context import ServiceApiEndUserContext
from machinery.message_history import MessageHistory
from models.model import App
from models.workflow import Workflow


def resolve_message_history(
    *,
    app: App,
    workflow: Workflow,
    end_user_id: str,
    conversation_id: str | None,
    parent_message_id: str | None,
) -> MessageHistory:
    """Revalidate queued/resumed selection using persisted app and admitted user.

    Must run before executing the graph. No request-supplied history IDs are
    trusted. Invalid ownership or unsupported workspace state fails closed;
    successful resolution reads only and retains current conversation state.
    """
    from extensions.ext_application_services import application_services

    branches = application_services().message_branches
    branches.validate_workflow(workflow.graph_dict)
    return branches.resolve(
        context=ServiceApiEndUserContext(
            tenant_id=app.tenant_id, app_id=app.id, app_mode=app.mode, end_user_id=end_user_id
        ),
        conversation_id=conversation_id,
        parent_message_id=parent_message_id,
    )
