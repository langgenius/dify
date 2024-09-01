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


class FileType(str, Enum):
    IMAGE = "image"
    DOCUMENT = "document"
    AUDIO = "audio"
    VIDEO = "video"
    CUSTOM = "custom"

    @staticmethod
    def value_of(value):
        for member in FileType:
            if member.value == value:
                return member
        raise ValueError(f"No matching enum found for value '{value}'")


class FileTransferMethod(str, Enum):
    REMOTE_URL = "remote_url"
    LOCAL_FILE = "local_file"
    TOOL_FILE = "tool_file"

    @staticmethod
    def value_of(value):
        for member in FileTransferMethod:
            if member.value == value:
                return member
        raise ValueError(f"No matching enum found for value '{value}'")


__all__ = [
    "NodeType",
    "CreatedByRole",
    "UserFrom",
    "WorkflowRunTriggeredFrom",
    "FileType",
    "FileTransferMethod",
]
