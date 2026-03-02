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
from events.feedback_event import feedback_was_created

logger = logging.getLogger(__name__)

__all__ = [
    "_handle_app_created",
    "_handle_app_deleted",
    "_handle_app_updated",
    "_handle_feedback_created",
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


@feedback_was_created.connect
def _handle_feedback_created(sender: object, **kwargs: object) -> None:
    try:
        from core.telemetry.gateway import emit as gateway_emit
        from enterprise.telemetry.contracts import TelemetryCase

        tenant_id = str(kwargs.get("tenant_id", "") or "")
        gateway_emit(
            case=TelemetryCase.FEEDBACK_CREATED,
            context={"tenant_id": tenant_id},
            payload={
                "message_id": getattr(sender, "message_id", None),
                "app_id": getattr(sender, "app_id", None),
                "conversation_id": getattr(sender, "conversation_id", None),
                "from_end_user_id": getattr(sender, "from_end_user_id", None),
                "from_account_id": getattr(sender, "from_account_id", None),
                "rating": getattr(sender, "rating", None),
                "from_source": getattr(sender, "from_source", None),
                "content": getattr(sender, "content", None),
            },
        )
    except Exception:
        logger.warning("Failed to emit feedback_created telemetry", exc_info=True)
