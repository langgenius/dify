"""
Pydantic models for async workflow trigger system.
"""

from collections.abc import Mapping, Sequence
from enum import StrEnum
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field


class TriggerType(StrEnum):
    """Types of workflow triggers"""
    WEBHOOK = "webhook"
    SCHEDULE = "schedule"
    PLUGIN = "plugin"


class ExecutionStatus(StrEnum):
    """Workflow execution status"""
    COMPLETED = "completed"
    FAILED = "failed"
    TIMEOUT = "timeout"


class TriggerData(BaseModel):
    """Base trigger data model for async workflow execution"""
    app_id: str
    tenant_id: str
    workflow_id: Optional[str] = None
    inputs: Mapping[str, Any]
    files: Sequence[Mapping[str, Any]] = Field(default_factory=list)
    trigger_type: TriggerType
    
    model_config = ConfigDict(use_enum_values=True)


class WebhookTriggerData(TriggerData):
    """Webhook-specific trigger data"""
    trigger_type: TriggerType = TriggerType.WEBHOOK
    webhook_url: str
    headers: Mapping[str, str] = Field(default_factory=dict)
    method: str = "POST"


class ScheduleTriggerData(TriggerData):
    """Schedule-specific trigger data"""
    trigger_type: TriggerType = TriggerType.SCHEDULE
    schedule_id: str
    cron_expression: str


class PluginTriggerData(TriggerData):
    """Plugin webhook trigger data"""
    trigger_type: TriggerType = TriggerType.PLUGIN
    plugin_id: str
    webhook_url: str


class WorkflowTaskData(BaseModel):
    """Lightweight data structure for Celery workflow tasks"""
    workflow_trigger_log_id: str  # Primary tracking ID - all other data can be fetched from DB
    
    model_config = ConfigDict(arbitrary_types_allowed=True)


class WorkflowExecutionResult(BaseModel):
    """Result from workflow execution"""
    execution_id: str
    status: ExecutionStatus
    result: Optional[Mapping[str, Any]] = None
    error: Optional[str] = None
    elapsed_time: Optional[float] = None
    total_tokens: Optional[int] = None
    
    model_config = ConfigDict(use_enum_values=True)