"""Blinker signal handlers for enterprise telemetry.

Registered at import time via ``@signal.connect`` decorators.
Import must happen during ``ext_enterprise_telemetry.init_app()`` to ensure handlers fire.
"""

from __future__ import annotations

import logging
import uuid

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
    from enterprise.telemetry.contracts import TelemetryCase, TelemetryEnvelope
    from extensions.ext_enterprise_telemetry import get_enterprise_exporter
    from tasks.enterprise_telemetry_task import process_enterprise_telemetry

    exporter = get_enterprise_exporter()
    if not exporter:
        return

    tenant_id = str(getattr(sender, "tenant_id", "") or "")
    payload = {
        "app_id": getattr(sender, "id", None),
        "mode": getattr(sender, "mode", None),
    }

    envelope = TelemetryEnvelope(
        case=TelemetryCase.APP_CREATED,
        tenant_id=tenant_id,
        event_id=str(uuid.uuid4()),
        payload=payload,
    )

    process_enterprise_telemetry.delay(envelope.model_dump_json())


@app_was_deleted.connect
def _handle_app_deleted(sender: object, **kwargs: object) -> None:
    from enterprise.telemetry.contracts import TelemetryCase, TelemetryEnvelope
    from extensions.ext_enterprise_telemetry import get_enterprise_exporter
    from tasks.enterprise_telemetry_task import process_enterprise_telemetry

    exporter = get_enterprise_exporter()
    if not exporter:
        return

    tenant_id = str(getattr(sender, "tenant_id", "") or "")
    payload = {
        "app_id": getattr(sender, "id", None),
    }

    envelope = TelemetryEnvelope(
        case=TelemetryCase.APP_DELETED,
        tenant_id=tenant_id,
        event_id=str(uuid.uuid4()),
        payload=payload,
    )

    process_enterprise_telemetry.delay(envelope.model_dump_json())


@app_was_updated.connect
def _handle_app_updated(sender: object, **kwargs: object) -> None:
    from enterprise.telemetry.contracts import TelemetryCase, TelemetryEnvelope
    from extensions.ext_enterprise_telemetry import get_enterprise_exporter
    from tasks.enterprise_telemetry_task import process_enterprise_telemetry

    exporter = get_enterprise_exporter()
    if not exporter:
        return

    tenant_id = str(getattr(sender, "tenant_id", "") or "")
    payload = {
        "app_id": getattr(sender, "id", None),
    }

    envelope = TelemetryEnvelope(
        case=TelemetryCase.APP_UPDATED,
        tenant_id=tenant_id,
        event_id=str(uuid.uuid4()),
        payload=payload,
    )

    process_enterprise_telemetry.delay(envelope.model_dump_json())


@feedback_was_created.connect
def _handle_feedback_created(sender: object, **kwargs: object) -> None:
    from enterprise.telemetry.contracts import TelemetryCase, TelemetryEnvelope
    from extensions.ext_enterprise_telemetry import get_enterprise_exporter
    from tasks.enterprise_telemetry_task import process_enterprise_telemetry

    exporter = get_enterprise_exporter()
    if not exporter:
        return

    tenant_id = str(kwargs.get("tenant_id", "") or "")
    payload = {
        "message_id": getattr(sender, "message_id", None),
        "app_id": getattr(sender, "app_id", None),
        "conversation_id": getattr(sender, "conversation_id", None),
        "from_end_user_id": getattr(sender, "from_end_user_id", None),
        "from_account_id": getattr(sender, "from_account_id", None),
        "rating": getattr(sender, "rating", None),
        "from_source": getattr(sender, "from_source", None),
        "content": getattr(sender, "content", None),
    }

    envelope = TelemetryEnvelope(
        case=TelemetryCase.FEEDBACK_CREATED,
        tenant_id=tenant_id,
        event_id=str(uuid.uuid4()),
        payload=payload,
    )

    process_enterprise_telemetry.delay(envelope.model_dump_json())
