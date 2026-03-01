from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from core.ops.entities.trace_entity import TraceTaskName


@dataclass(frozen=True)
class TelemetryContext:
    tenant_id: str | None = None
    user_id: str | None = None
    app_id: str | None = None


@dataclass(frozen=True)
class TelemetryEvent:
    name: TraceTaskName
    context: TelemetryContext
    payload: dict[str, Any]
