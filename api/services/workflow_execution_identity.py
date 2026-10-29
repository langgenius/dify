"""Trusted caller identity passed into workflow execution, independent of ORM state."""

from typing import TYPE_CHECKING

from core.app.entities.app_invoke_entities import UserFrom
from repositories.entities.workflow_execution import WorkflowExecutionIdentity

if TYPE_CHECKING:
    from models.account import Account
    from models.model import EndUser


def build_workflow_execution_identity(user: "Account | EndUser") -> WorkflowExecutionIdentity:
    """Adapt a resolved caller at the service/task boundary; never infer a role from the entry point."""
    from models.account import Account
    from models.model import EndUser

    if isinstance(user, Account):
        return WorkflowExecutionIdentity(user_id=user.id, user_from=UserFrom.ACCOUNT)
    if isinstance(user, EndUser):
        return WorkflowExecutionIdentity(user_id=user.id, user_from=UserFrom.END_USER)
    raise TypeError("Workflow caller must be an Account or EndUser")
