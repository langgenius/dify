"""Celery worker for enterprise metric/log telemetry events.

This module defines the Celery task that processes telemetry envelopes
from the enterprise_telemetry queue. It deserializes envelopes and
dispatches them to the EnterpriseMetricHandler.
"""

import json
import logging

from celery import shared_task

from enterprise.telemetry.contracts import TelemetryEnvelope
from enterprise.telemetry.metric_handler import EnterpriseMetricHandler

logger = logging.getLogger(__name__)


@shared_task(queue="enterprise_telemetry")
def process_enterprise_telemetry(envelope_json: str) -> None:
    """Process enterprise metric/log telemetry envelope.

    This task is enqueued by the TelemetryGateway for metric/log-only
    events. It deserializes the envelope and dispatches to the handler.

    Best-effort processing: logs errors but never raises, to avoid
    failing user requests due to telemetry issues.

    Args:
        envelope_json: JSON-serialized TelemetryEnvelope.
    """
    try:
        # Deserialize envelope
        envelope_dict = json.loads(envelope_json)
        envelope = TelemetryEnvelope.model_validate(envelope_dict)

        # Process through handler
        handler = EnterpriseMetricHandler()
        handler.handle(envelope)

        logger.debug(
            "Successfully processed telemetry envelope: tenant_id=%s, event_id=%s, case=%s",
            envelope.tenant_id,
            envelope.event_id,
            envelope.case,
        )
    except Exception:
        # Best-effort: log and drop on error, never fail user request
        logger.warning(
            "Failed to process enterprise telemetry envelope, dropping event",
            exc_info=True,
        )
