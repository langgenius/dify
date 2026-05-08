"""Blinker signal handlers for enterprise telemetry.

Registered at import time via ``@signal.connect`` decorators.
Import must happen during ``ext_enterprise_telemetry.init_app()`` to
ensure handlers fire.  Each handler delegates to ``core.telemetry.gateway``
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


@app_was_created.connect
def _handle_app_created(sender: object, **kwargs: object) -> None:
    try:
        from core.telemetry.gateway import emit as gateway_emit
        from enterprise.telemetry.contracts import TelemetryCase

        gateway_emit(
            case=TelemetryCase.APP_CREATED,
            context={"tenant_id": str(getattr(sender, "tenant_id", "") or "")},
            payload={
                "app_id": getattr(sender, "id", None),
                "mode": getattr(sender, "mode", None),
            },
        )
    except Exception:
        logger.warning("Failed to emit app_created telemetry", exc_info=True)


@app_was_updated.connect
def _handle_app_updated(sender: object, **kwargs: object) -> None:
    try:
        from core.telemetry.gateway import emit as gateway_emit
        from enterprise.telemetry.contracts import TelemetryCase

        gateway_emit(
            case=TelemetryCase.APP_UPDATED,
            context={"tenant_id": str(getattr(sender, "tenant_id", "") or "")},
            payload={"app_id": getattr(sender, "id", None)},
        )
    except Exception:
        logger.warning("Failed to emit app_updated telemetry", exc_info=True)


@app_was_deleted.connect
def _handle_app_deleted(sender: object, **kwargs: object) -> None:
    try:
        from core.telemetry.gateway import emit as gateway_emit
        from enterprise.telemetry.contracts import TelemetryCase

        gateway_emit(
            case=TelemetryCase.APP_DELETED,
            context={"tenant_id": str(getattr(sender, "tenant_id", "") or "")},
            payload={"app_id": getattr(sender, "id", None)},
        )
    except Exception:
        logger.warning("Failed to emit app_deleted telemetry", exc_info=True)
