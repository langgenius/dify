from typing import Any, Optional

from pydantic import Field

from core.workflow.nodes.base.entities import BaseNodeData, RetryConfig
from core.workflow.nodes.enums import ErrorStrategy


class PluginTriggerData(BaseNodeData):
    """Plugin trigger node data"""

    title: str
    desc: Optional[str] = None
    plugin_id: str = Field(..., description="Plugin ID")
    provider_id: str = Field(..., description="Provider ID")
    trigger_name: str = Field(..., description="Trigger name")
    subscription_id: str = Field(..., description="Subscription ID")
    parameters: dict[str, Any] = Field(default_factory=dict, description="Trigger parameters")

    # Error handling
    error_strategy: Optional[ErrorStrategy] = Field(
        default=ErrorStrategy.FAIL_BRANCH, description="Error handling strategy"
    )
    retry_config: RetryConfig = Field(default_factory=lambda: RetryConfig(), description="Retry configuration")
    default_value_dict: dict[str, Any] = Field(
        default_factory=dict, description="Default values for outputs when error occurs"
    )
