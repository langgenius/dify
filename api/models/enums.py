from enum import StrEnum


class CreatorUserRole(StrEnum):
    ACCOUNT = "account"
    END_USER = "end_user"


class UserFrom(StrEnum):
    ACCOUNT = "account"
    END_USER = "end-user"


class WorkflowRunTriggeredFrom(StrEnum):
    DEBUGGING = "debugging"
    APP_RUN = "app-run"
    RAG_PIPELINE_RUN = "rag-pipeline-run"
    RAG_PIPELINE_DEBUGGING = "rag-pipeline-debugging"


class DraftVariableType(StrEnum):
    # node means that the correspond variable
    NODE = "node"
    SYS = "sys"
    CONVERSATION = "conversation"


class MessageStatus(StrEnum):
    """
    Message Status Enum
    """

    NORMAL = "normal"
    ERROR = "error"


class ExecutionOffLoadType(StrEnum):
    INPUTS = "inputs"
    PROCESS_DATA = "process_data"
    OUTPUTS = "outputs"
