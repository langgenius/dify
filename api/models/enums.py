from enum import StrEnum

from core.trigger.constants import (
    TRIGGER_PLUGIN_NODE_TYPE,
    TRIGGER_SCHEDULE_NODE_TYPE,
    TRIGGER_WEBHOOK_NODE_TYPE,
)


class CreatorUserRole(StrEnum):
    ACCOUNT = "account"
    END_USER = "end_user"


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
    PAUSED = "paused"
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
    RATE_LIMITED = "rate_limited"


class AppTriggerType(StrEnum):
    """App Trigger Type Enum"""

    TRIGGER_WEBHOOK = TRIGGER_WEBHOOK_NODE_TYPE
    TRIGGER_SCHEDULE = TRIGGER_SCHEDULE_NODE_TYPE
    TRIGGER_PLUGIN = TRIGGER_PLUGIN_NODE_TYPE

    # for backward compatibility
    UNKNOWN = "unknown"


class AppStatus(StrEnum):
    """App Status Enum"""

    NORMAL = "normal"


class AppMCPServerStatus(StrEnum):
    """AppMCPServer Status Enum"""

    NORMAL = "normal"
    ACTIVE = "active"
    INACTIVE = "inactive"


class ConversationStatus(StrEnum):
    """Conversation Status Enum"""

    NORMAL = "normal"
