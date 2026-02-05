from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class TelemetryContext:
    tenant_id: str | None = None
    user_id: str | None = None
    app_id: str | None = None


@dataclass(frozen=True)
class TelemetryEvent:
    name: str
    context: TelemetryContext
    payload: dict[str, Any]
