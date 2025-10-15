from typing import Any, Optional

from pydantic import Field

from core.workflow.enums import ErrorStrategy
from core.workflow.nodes.base.entities import BaseNodeData, RetryConfig


class PluginTriggerNodeData(BaseNodeData):
    """Plugin trigger node data"""

    title: str
    desc: Optional[str] = None
    plugin_id: str = Field(..., description="Plugin ID")
    provider_id: str = Field(..., description="Provider ID")
    event_name: str = Field(..., description="Event name")
    subscription_id: str = Field(..., description="Subscription ID")
    plugin_unique_identifier: str = Field(..., description="Plugin unique identifier")
    parameters: dict[str, Any] = Field(default_factory=dict, description="Trigger parameters")

    # Error handling
    error_strategy: Optional[ErrorStrategy] = Field(
        default=ErrorStrategy.FAIL_BRANCH, description="Error handling strategy"
    )
    retry_config: RetryConfig = Field(default_factory=lambda: RetryConfig(), description="Retry configuration")
