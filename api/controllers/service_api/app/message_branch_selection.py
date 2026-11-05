"""Translate an explicit HTTP parent into an owner-validated generation argument."""

from uuid import UUID

from machinery.context import ServiceApiEndUserContext
from services.message_branch_service import MessageBranchService


def select_message_branch(
    *,
    branches: MessageBranchService,
    context: ServiceApiEndUserContext,
    conversation_id: str | None,
    parent_message_id: UUID | None,
) -> str | None:
    """Validate an explicitly present parent, including null, before enqueueing.

    Context must come from API admission. Return the normalized parent only
    after scoped resolution succeeds; failures perform no writes. Omitted
    fields must bypass this handler so legacy generation retains its sentinel.
    """
    parent = str(parent_message_id) if parent_message_id is not None else None
    branches.resolve(context=context, conversation_id=conversation_id, parent_message_id=parent)
    return parent
