"""
Pydantic models for async workflow trigger system.
"""

from collections.abc import Mapping, Sequence
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from models.enums import AppTriggerType, WorkflowRunTriggeredFrom


class AsyncTriggerStatus(StrEnum):
    """Async trigger execution status"""

    COMPLETED = "completed"
    FAILED = "failed"
    TIMEOUT = "timeout"


class TriggerMetadata(BaseModel):
    """Trigger metadata"""

    type: AppTriggerType = Field(default=AppTriggerType.UNKNOWN)


class TriggerData(BaseModel):
    """Base trigger data model for async workflow execution"""

    app_id: str
    tenant_id: str
    workflow_id: str | None = None
    root_node_id: str
    inputs: Mapping[str, Any]
    files: Sequence[Mapping[str, Any]] = Field(default_factory=list)
    trigger_type: AppTriggerType
    trigger_from: WorkflowRunTriggeredFrom
    trigger_metadata: TriggerMetadata | None = None

    model_config = ConfigDict(use_enum_values=True)


class WebhookTriggerData(TriggerData):
    """Webhook-specific trigger data"""

    trigger_type: AppTriggerType = AppTriggerType.TRIGGER_WEBHOOK
    trigger_from: WorkflowRunTriggeredFrom = WorkflowRunTriggeredFrom.WEBHOOK


class ScheduleTriggerData(TriggerData):
    """Schedule-specific trigger data"""

    trigger_type: AppTriggerType = AppTriggerType.TRIGGER_SCHEDULE
    trigger_from: WorkflowRunTriggeredFrom = WorkflowRunTriggeredFrom.SCHEDULE


class PluginTriggerMetadata(TriggerMetadata):
    """Plugin trigger metadata"""

    type: AppTriggerType = AppTriggerType.TRIGGER_PLUGIN

    endpoint_id: str
    plugin_unique_identifier: str
    provider_id: str
    event_name: str
    icon_filename: str
    icon_dark_filename: str


class PluginTriggerData(TriggerData):
    """Plugin webhook trigger data"""

    trigger_type: AppTriggerType = AppTriggerType.TRIGGER_PLUGIN
    trigger_from: WorkflowRunTriggeredFrom = WorkflowRunTriggeredFrom.PLUGIN
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
    result: Mapping[str, Any] | None = None
    error: str | None = None
    elapsed_time: float | None = None
    total_tokens: int | None = None

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
    celery_task_id: str | None = None
    workflow_run_id: str | None = None
    error: str | None = None
    outputs: str | None = None
    elapsed_time: float | None = None
    total_tokens: int | None = None
    created_at: str | None = None
    triggered_at: str | None = None
    finished_at: str | None = None

    model_config = ConfigDict(use_enum_values=True)


class WorkflowScheduleCFSPlanEntity(BaseModel):
    """
    CFS plan entity.
    Ensure each workflow run inside Dify is associated with a CFS(Completely Fair Scheduler) plan.

    """

    class Strategy(StrEnum):
        """
        CFS plan strategy.
        """

        TimeSlice = "time-slice"  # time-slice based plan
        Nop = "nop"  # no plan, just run the workflow

    schedule_strategy: Strategy
    granularity: int = Field(default=-1)  # -1 means infinite
