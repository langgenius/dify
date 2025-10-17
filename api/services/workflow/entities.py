"""
Pydantic models for async workflow trigger system.
"""

from collections.abc import Mapping, Sequence
from enum import StrEnum
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field

from models.enums import WorkflowRunTriggeredFrom


class AsyncTriggerStatus(StrEnum):
    """Async trigger execution status"""

    COMPLETED = "completed"
    FAILED = "failed"
    TIMEOUT = "timeout"


class TriggerData(BaseModel):
    """Base trigger data model for async workflow execution"""

    app_id: str
    tenant_id: str
    workflow_id: Optional[str] = None
    root_node_id: str
    inputs: Mapping[str, Any]
    files: Sequence[Mapping[str, Any]] = Field(default_factory=list)
    trigger_type: WorkflowRunTriggeredFrom

    model_config = ConfigDict(use_enum_values=True)


class WebhookTriggerData(TriggerData):
    """Webhook-specific trigger data"""

    trigger_type: WorkflowRunTriggeredFrom = WorkflowRunTriggeredFrom.WEBHOOK
    webhook_url: str
    headers: Mapping[str, str] = Field(default_factory=dict)
    method: str = "POST"


class ScheduleTriggerData(TriggerData):
    """Schedule-specific trigger data"""

    trigger_type: WorkflowRunTriggeredFrom = WorkflowRunTriggeredFrom.SCHEDULE
    schedule_id: str
    cron_expression: str


class PluginTriggerData(TriggerData):
    """Plugin webhook trigger data"""

    trigger_type: WorkflowRunTriggeredFrom = WorkflowRunTriggeredFrom.PLUGIN
    plugin_id: str
    endpoint_id: str


class PluginTriggerDispatchData(BaseModel):
    """Plugin trigger dispatch data for Celery tasks"""

    user_id: str
    tenant_id: str
    endpoint_id: str
    provider_id: str
    subscription_id: str
    timestamp: int
    events: list[str]
    request_id: str


class WorkflowTaskData(BaseModel):
    """Lightweight data structure for Celery workflow tasks"""

    workflow_trigger_log_id: str  # Primary tracking ID - all other data can be fetched from DB

    model_config = ConfigDict(arbitrary_types_allowed=True)


class AsyncTriggerExecutionResult(BaseModel):
    """Result from async trigger-based workflow execution"""

    execution_id: str
    status: AsyncTriggerStatus
    result: Optional[Mapping[str, Any]] = None
    error: Optional[str] = None
    elapsed_time: Optional[float] = None
    total_tokens: Optional[int] = None

    model_config = ConfigDict(use_enum_values=True)


class AsyncTriggerResponse(BaseModel):
    """Response from triggering an async workflow"""

    workflow_trigger_log_id: str
    task_id: str
    status: str
    queue: str

    model_config = ConfigDict(use_enum_values=True)


class TriggerLogResponse(BaseModel):
    """Response model for trigger log data"""

    id: str
    tenant_id: str
    app_id: str
    workflow_id: str
    trigger_type: WorkflowRunTriggeredFrom
    status: str
    queue_name: str
    retry_count: int
    celery_task_id: Optional[str] = None
    workflow_run_id: Optional[str] = None
    error: Optional[str] = None
    outputs: Optional[str] = None
    elapsed_time: Optional[float] = None
    total_tokens: Optional[int] = None
    created_at: Optional[str] = None
    triggered_at: Optional[str] = None
    finished_at: Optional[str] = None

    model_config = ConfigDict(use_enum_values=True)
