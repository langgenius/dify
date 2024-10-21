from enum import Enum

from .model import App, AppMode, Message
from .types import StringUUID
from .workflow import ConversationVariable, Workflow, WorkflowNodeExecutionStatus

__all__ = ["ConversationVariable", "StringUUID", "AppMode", "WorkflowNodeExecutionStatus", "Workflow", "App", "Message"]


class CreatedByRole(Enum):
    """
    Enum class for createdByRole
    """

    ACCOUNT = "account"
    END_USER = "end_user"

    @classmethod
    def value_of(cls, value: str) -> "CreatedByRole":
        """
        Get value of given mode.

        :param value: mode value
        :return: mode
        """
        for role in cls:
            if role.value == value:
                return role
        raise ValueError(f"invalid createdByRole value {value}")
