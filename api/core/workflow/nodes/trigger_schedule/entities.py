from typing import Literal, Union

from pydantic import BaseModel, Field

from core.workflow.nodes.base import BaseNodeData


class TriggerScheduleNodeData(BaseNodeData):
    """
    Trigger Schedule Node Data
    """

    mode: str = Field(default="visual", description="Schedule mode: visual or cron")
    frequency: str | None = Field(default=None, description="Frequency for visual mode: hourly, daily, weekly, monthly")
    cron_expression: str | None = Field(default=None, description="Cron expression for cron mode")
    visual_config: dict | None = Field(default=None, description="Visual configuration details")
    timezone: str = Field(default="UTC", description="Timezone for schedule execution")


class ScheduleConfig(BaseModel):
    node_id: str
    cron_expression: str
    timezone: str = "UTC"


class SchedulePlanUpdate(BaseModel):
    node_id: str | None = None
    cron_expression: str | None = None
    timezone: str | None = None


class VisualConfig(BaseModel):
    """Visual configuration for schedule trigger"""

    # For hourly frequency
    on_minute: int | None = Field(default=0, ge=0, le=59, description="Minute of the hour (0-59)")

    # For daily, weekly, monthly frequencies
    time: str | None = Field(default="12:00 AM", description="Time in 12-hour format (e.g., '2:30 PM')")

    # For weekly frequency
    weekdays: list[Literal["sun", "mon", "tue", "wed", "thu", "fri", "sat"]] | None = Field(
        default=None, description="List of weekdays to run on"
    )

    # For monthly frequency
    monthly_days: list[Union[int, Literal["last"]]] | None = Field(
        default=None, description="Days of month to run on (1-31 or 'last')"
    )
