from enum import StrEnum

from core.workflow.enums import NodeType


class CreatorUserRole(StrEnum):
    ACCOUNT = "account"
    END_USER = "end_user"


class UserFrom(StrEnum):
    ACCOUNT = "account"
    END_USER = "end-user"


class WorkflowRunTriggeredFrom(StrEnum):
    DEBUGGING = "debugging"
    APP_RUN = "app-run"  # webapp / service api
    RAG_PIPELINE_RUN = "rag-pipeline-run"
    RAG_PIPELINE_DEBUGGING = "rag-pipeline-debugging"
    WEBHOOK = "webhook"
    SCHEDULE = "schedule"
    PLUGIN = "plugin"


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


class WorkflowTriggerStatus(StrEnum):
    """Workflow Trigger Execution Status"""

    PENDING = "pending"
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    PAUSED = "paused"
    FAILED = "failed"
    RATE_LIMITED = "rate_limited"
    RETRYING = "retrying"


class AppTriggerStatus(StrEnum):
    """App Trigger Status Enum"""

    ENABLED = "enabled"
    DISABLED = "disabled"
    UNAUTHORIZED = "unauthorized"


class AppTriggerType(StrEnum):
    """App Trigger Type Enum"""

    TRIGGER_WEBHOOK = NodeType.TRIGGER_WEBHOOK.value
    TRIGGER_SCHEDULE = NodeType.TRIGGER_SCHEDULE.value
    TRIGGER_PLUGIN = NodeType.TRIGGER_PLUGIN.value

    # for backward compatibility
    UNKNOWN = "unknown"
