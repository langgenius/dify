from typing import Optional

from pydantic import BaseModel, Field

from core.workflow.nodes.base import BaseNodeData


class TriggerScheduleNodeData(BaseNodeData):
    """
    Trigger Schedule Node Data
    """

    mode: str = Field(default="visual", description="Schedule mode: visual or cron")
    frequency: Optional[str] = Field(
        default=None, description="Frequency for visual mode: hourly, daily, weekly, monthly"
    )
    cron_expression: Optional[str] = Field(default=None, description="Cron expression for cron mode")
    visual_config: Optional[dict] = Field(default=None, description="Visual configuration details")
    timezone: str = Field(default="UTC", description="Timezone for schedule execution")


class ScheduleConfig(BaseModel):
    node_id: str
    cron_expression: str
    timezone: str = "UTC"


class SchedulePlanUpdate(BaseModel):
    node_id: Optional[str] = None
    cron_expression: Optional[str] = None
    timezone: Optional[str] = None
