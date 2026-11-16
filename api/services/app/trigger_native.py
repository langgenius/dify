"""Plain records for enterprise's informational native trigger state query."""

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class NativeTriggerNode:
    node_id: str
    trigger_type: str
    subscription_id: str
    provider_id: str


@dataclass(frozen=True, slots=True)
class NativeTriggerState:
    enabled: bool | None
    authorized: bool | None
