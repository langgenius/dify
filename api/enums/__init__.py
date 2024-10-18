from enum import Enum

from .workflow_nodes import NodeType


class CreatedByRole(str, Enum):
    """
    TODO: Need to write docstring
    """

    ACCOUNT = "account"
    END_USER = "end_user"


class UserFrom(str, Enum):
    """
    TODO: Need to write docstring
    """

    ACCOUNT = "account"
    END_USER = "end-user"


class WorkflowRunTriggeredFrom(str, Enum):
    DEBUGGING = "debugging"
    APP_RUN = "app-run"


__all__ = [
    "NodeType",
    "CreatedByRole",
    "UserFrom",
    "WorkflowRunTriggeredFrom",
]
