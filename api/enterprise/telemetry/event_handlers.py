"""Blinker signal handlers for enterprise telemetry.

Registered at import time via ``@signal.connect`` decorators.
Import must happen during ``ext_enterprise_telemetry.init_app()`` to
ensure handlers fire.  Each handler delegates to ``core.telemetry``
which handles routing, EE-gating, and dispatch.

All handlers are best-effort: exceptions are caught and logged so that
telemetry failures never break user-facing operations.
"""

from __future__ import annotations

import logging

from events.app_event import app_was_created, app_was_deleted, app_was_updated

logger = logging.getLogger(__name__)

__all__ = [
    "_handle_app_created",
    "_handle_app_deleted",
    "_handle_app_updated",
]


def _optional_str(value: object) -> str | None:
    """Coerce a value to ``str | None`` for telemetry payloads."""
    if value is None:
        return None
    return str(value)


@app_was_created.connect
def _handle_app_created(sender: object, **kwargs: object) -> None:
    try:
        from core.telemetry import AppCreatedEvent, TelemetryContext, emit

        emit(
            AppCreatedEvent(
                context=TelemetryContext(
                    tenant_id=str(getattr(sender, "tenant_id", "") or ""),
                ),
                payload={
                    "app_id": _optional_str(getattr(sender, "id", None)),
                    "mode": _optional_str(getattr(sender, "mode", None)),
                },
            )
        )
    except Exception:
        logger.warning("Failed to emit app_created telemetry", exc_info=True)


@app_was_updated.connect
def _handle_app_updated(sender: object, **kwargs: object) -> None:
    try:
        from core.telemetry import AppUpdatedEvent, TelemetryContext, emit

        emit(
            AppUpdatedEvent(
                context=TelemetryContext(
                    tenant_id=str(getattr(sender, "tenant_id", "") or ""),
                ),
                payload={"app_id": _optional_str(getattr(sender, "id", None))},
            )
        )
    except Exception:
        logger.warning("Failed to emit app_updated telemetry", exc_info=True)


@app_was_deleted.connect
def _handle_app_deleted(sender: object, **kwargs: object) -> None:
    try:
        from core.telemetry import AppDeletedEvent, TelemetryContext, emit

        emit(
            AppDeletedEvent(
                context=TelemetryContext(
                    tenant_id=str(getattr(sender, "tenant_id", "") or ""),
                ),
                payload={"app_id": _optional_str(getattr(sender, "id", None))},
            )
        )
    except Exception:
        logger.warning("Failed to emit app_deleted telemetry", exc_info=True)
