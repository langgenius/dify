"""Blinker signal handlers for enterprise telemetry.

Registered at import time via ``@signal.connect`` decorators.
Import must happen during ``ext_enterprise_telemetry.init_app()`` to ensure handlers fire.
"""

from __future__ import annotations

import logging

from enterprise.telemetry.entities import EnterpriseTelemetryCounter
from enterprise.telemetry.telemetry_log import emit_metric_only_event
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
    from extensions.ext_enterprise_telemetry import get_enterprise_exporter

    exporter = get_enterprise_exporter()
    if not exporter:
        return

    attrs = {
        "dify.app.id": getattr(sender, "id", None),
        "dify.tenant_id": getattr(sender, "tenant_id", None),
        "dify.app.mode": getattr(sender, "mode", None),
    }

    emit_metric_only_event(
        event_name="dify.app.created",
        attributes=attrs,
        tenant_id=str(getattr(sender, "tenant_id", "") or ""),
    )
    exporter.increment_counter(
        EnterpriseTelemetryCounter.REQUESTS,
        1,
        {
            "type": "app.created",
            "tenant_id": getattr(sender, "tenant_id", ""),
        },
    )


@app_was_deleted.connect
def _handle_app_deleted(sender: object, **kwargs: object) -> None:
    from extensions.ext_enterprise_telemetry import get_enterprise_exporter

    exporter = get_enterprise_exporter()
    if not exporter:
        return

    attrs = {
        "dify.app.id": getattr(sender, "id", None),
        "dify.tenant_id": getattr(sender, "tenant_id", None),
    }

    emit_metric_only_event(
        event_name="dify.app.deleted",
        attributes=attrs,
        tenant_id=str(getattr(sender, "tenant_id", "") or ""),
    )
    exporter.increment_counter(
        EnterpriseTelemetryCounter.REQUESTS,
        1,
        {
            "type": "app.deleted",
            "tenant_id": getattr(sender, "tenant_id", ""),
        },
    )


@app_was_updated.connect
def _handle_app_updated(sender: object, **kwargs: object) -> None:
    from extensions.ext_enterprise_telemetry import get_enterprise_exporter

    exporter = get_enterprise_exporter()
    if not exporter:
        return

    attrs = {
        "dify.app.id": getattr(sender, "id", None),
        "dify.tenant_id": getattr(sender, "tenant_id", None),
    }

    emit_metric_only_event(
        event_name="dify.app.updated",
        attributes=attrs,
        tenant_id=str(getattr(sender, "tenant_id", "") or ""),
    )
    exporter.increment_counter(
        EnterpriseTelemetryCounter.REQUESTS,
        1,
        {
            "type": "app.updated",
            "tenant_id": getattr(sender, "tenant_id", ""),
        },
    )


@feedback_was_created.connect
def _handle_feedback_created(sender: object, **kwargs: object) -> None:
    from extensions.ext_enterprise_telemetry import get_enterprise_exporter

    exporter = get_enterprise_exporter()
    if not exporter:
        return

    include_content = exporter.include_content
    attrs: dict = {
        "dify.message.id": getattr(sender, "message_id", None),
        "dify.tenant_id": kwargs.get("tenant_id"),
        "dify.app_id": getattr(sender, "app_id", None),
        "dify.conversation.id": getattr(sender, "conversation_id", None),
        "gen_ai.user.id": getattr(sender, "from_end_user_id", None) or getattr(sender, "from_account_id", None),
        "dify.feedback.rating": getattr(sender, "rating", None),
        "dify.feedback.from_source": getattr(sender, "from_source", None),
    }
    if include_content:
        attrs["dify.feedback.content"] = getattr(sender, "content", None)

    emit_metric_only_event(
        event_name="dify.feedback.created",
        attributes=attrs,
        tenant_id=str(kwargs.get("tenant_id", "") or ""),
        user_id=str(getattr(sender, "from_end_user_id", None) or getattr(sender, "from_account_id", None) or ""),
    )
    exporter.increment_counter(
        EnterpriseTelemetryCounter.FEEDBACK,
        1,
        {
            "tenant_id": str(kwargs.get("tenant_id", "")),
            "app_id": str(getattr(sender, "app_id", "")),
            "rating": str(getattr(sender, "rating", "")),
        },
    )
