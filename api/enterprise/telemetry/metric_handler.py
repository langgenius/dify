"""Enterprise metric/log event handler.

This module processes metric and log telemetry events after they've been
dequeued from the enterprise_telemetry Celery queue. It handles case routing,
idempotency checking, and payload rehydration.
"""

from __future__ import annotations

import logging
from typing import Any

from enterprise.telemetry.contracts import TelemetryCase, TelemetryEnvelope
from extensions.ext_redis import redis_client

logger = logging.getLogger(__name__)


class EnterpriseMetricHandler:
    """Handler for enterprise metric and log telemetry events.

    Processes envelopes from the enterprise_telemetry queue, routing each
    case to the appropriate handler method. Implements idempotency checking
    and payload rehydration with fallback.
    """

    def _increment_diagnostic_counter(self, counter_name: str, labels: dict[str, str] | None = None) -> None:
        """Increment a diagnostic counter for operational monitoring.

        Args:
            counter_name: Name of the counter (e.g., 'processed_total', 'deduped_total').
            labels: Optional labels for the counter.
        """
        try:
            from extensions.ext_enterprise_telemetry import get_enterprise_exporter

            exporter = get_enterprise_exporter()
            if not exporter:
                return

            full_counter_name = f"enterprise_telemetry.handler.{counter_name}"
            logger.debug(
                "Diagnostic counter: %s, labels=%s",
                full_counter_name,
                labels or {},
            )
        except Exception:
            logger.debug("Failed to increment diagnostic counter: %s", counter_name, exc_info=True)

    def handle(self, envelope: TelemetryEnvelope) -> None:
        """Main entry point for processing telemetry envelopes.

        Args:
            envelope: The telemetry envelope to process.
        """
        # Check for duplicate events
        if self._is_duplicate(envelope):
            logger.debug(
                "Skipping duplicate event: tenant_id=%s, event_id=%s",
                envelope.tenant_id,
                envelope.event_id,
            )
            self._increment_diagnostic_counter("deduped_total")
            return

        # Route to appropriate handler based on case
        case = envelope.case
        if case == TelemetryCase.APP_CREATED:
            self._on_app_created(envelope)
            self._increment_diagnostic_counter("processed_total", {"case": "app_created"})
        elif case == TelemetryCase.APP_UPDATED:
            self._on_app_updated(envelope)
            self._increment_diagnostic_counter("processed_total", {"case": "app_updated"})
        elif case == TelemetryCase.APP_DELETED:
            self._on_app_deleted(envelope)
            self._increment_diagnostic_counter("processed_total", {"case": "app_deleted"})
        elif case == TelemetryCase.FEEDBACK_CREATED:
            self._on_feedback_created(envelope)
            self._increment_diagnostic_counter("processed_total", {"case": "feedback_created"})
        elif case == TelemetryCase.MESSAGE_RUN:
            self._on_message_run(envelope)
            self._increment_diagnostic_counter("processed_total", {"case": "message_run"})
        elif case == TelemetryCase.TOOL_EXECUTION:
            self._on_tool_execution(envelope)
            self._increment_diagnostic_counter("processed_total", {"case": "tool_execution"})
        elif case == TelemetryCase.MODERATION_CHECK:
            self._on_moderation_check(envelope)
            self._increment_diagnostic_counter("processed_total", {"case": "moderation_check"})
        elif case == TelemetryCase.SUGGESTED_QUESTION:
            self._on_suggested_question(envelope)
            self._increment_diagnostic_counter("processed_total", {"case": "suggested_question"})
        elif case == TelemetryCase.DATASET_RETRIEVAL:
            self._on_dataset_retrieval(envelope)
            self._increment_diagnostic_counter("processed_total", {"case": "dataset_retrieval"})
        elif case == TelemetryCase.GENERATE_NAME:
            self._on_generate_name(envelope)
            self._increment_diagnostic_counter("processed_total", {"case": "generate_name"})
        elif case == TelemetryCase.PROMPT_GENERATION:
            self._on_prompt_generation(envelope)
            self._increment_diagnostic_counter("processed_total", {"case": "prompt_generation"})
        else:
            logger.warning(
                "Unknown telemetry case: %s (tenant_id=%s, event_id=%s)",
                case,
                envelope.tenant_id,
                envelope.event_id,
            )

    def _is_duplicate(self, envelope: TelemetryEnvelope) -> bool:
        """Check if this event has already been processed.

        Uses Redis with TTL for deduplication. Returns True if duplicate,
        False if first time seeing this event.

        Args:
            envelope: The telemetry envelope to check.

        Returns:
            True if this event_id has been seen before, False otherwise.
        """
        dedup_key = f"telemetry:dedup:{envelope.tenant_id}:{envelope.event_id}"

        try:
            # Atomic set-if-not-exists with 1h TTL
            # Returns True if key was set (first time), None if already exists (duplicate)
            was_set = redis_client.set(dedup_key, b"1", nx=True, ex=3600)
            return was_set is None
        except Exception:
            # Fail open: if Redis is unavailable, process the event
            # (prefer occasional duplicate over lost data)
            logger.warning(
                "Redis unavailable for deduplication check, processing event anyway: %s",
                envelope.event_id,
                exc_info=True,
            )
            return False

    def _rehydrate(self, envelope: TelemetryEnvelope) -> dict[str, Any]:
        """Rehydrate payload from reference or fallback.

        Attempts to resolve payload_ref to full data. If that fails,
        falls back to payload_fallback. If both fail, emits a degraded
        event marker.

        Args:
            envelope: The telemetry envelope containing payload data.

        Returns:
            The rehydrated payload dictionary.
        """
        # For now, payload is directly in the envelope
        # Future: implement payload_ref resolution from storage
        payload = envelope.payload

        if not payload and envelope.payload_fallback:
            import pickle

            try:
                payload = pickle.loads(envelope.payload_fallback)  # noqa: S301
                logger.debug("Used payload_fallback for event_id=%s", envelope.event_id)
            except Exception:
                logger.warning(
                    "Failed to deserialize payload_fallback for event_id=%s",
                    envelope.event_id,
                    exc_info=True,
                )

        if not payload:
            # Both ref and fallback failed - emit degraded event
            logger.error(
                "Payload rehydration failed for event_id=%s, tenant_id=%s, case=%s",
                envelope.event_id,
                envelope.tenant_id,
                envelope.case,
            )
            # Emit degraded event marker
            from enterprise.telemetry.entities import EnterpriseTelemetryEvent
            from enterprise.telemetry.telemetry_log import emit_metric_only_event

            emit_metric_only_event(
                event_name=EnterpriseTelemetryEvent.REHYDRATION_FAILED,
                attributes={
                    "dify.tenant_id": envelope.tenant_id,
                    "dify.event_id": envelope.event_id,
                    "dify.case": envelope.case,
                    "rehydration_failed": True,
                },
                tenant_id=envelope.tenant_id,
            )
            self._increment_diagnostic_counter("rehydration_failed_total")
            return {}

        return payload

    # Stub methods for each metric/log case
    # These will be implemented in later tasks with actual emission logic

    def _on_app_created(self, envelope: TelemetryEnvelope) -> None:
        """Handle app created event."""
        from enterprise.telemetry.entities import EnterpriseTelemetryCounter, EnterpriseTelemetryEvent
        from enterprise.telemetry.telemetry_log import emit_metric_only_event
        from extensions.ext_enterprise_telemetry import get_enterprise_exporter

        exporter = get_enterprise_exporter()
        if not exporter:
            logger.debug("No exporter available for APP_CREATED: event_id=%s", envelope.event_id)
            return

        payload = self._rehydrate(envelope)
        if not payload:
            return

        attrs = {
            "dify.app.id": payload.get("app_id"),
            "dify.tenant_id": envelope.tenant_id,
            "dify.event.id": envelope.event_id,
            "dify.app.mode": payload.get("mode"),
        }

        emit_metric_only_event(
            event_name=EnterpriseTelemetryEvent.APP_CREATED,
            attributes=attrs,
            tenant_id=envelope.tenant_id,
        )
        exporter.increment_counter(
            EnterpriseTelemetryCounter.APP_CREATED,
            1,
            {
                "tenant_id": envelope.tenant_id,
                "app_id": str(payload.get("app_id", "")),
                "mode": str(payload.get("mode", "")),
            },
        )

    def _on_app_updated(self, envelope: TelemetryEnvelope) -> None:
        """Handle app updated event."""
        from enterprise.telemetry.entities import EnterpriseTelemetryCounter, EnterpriseTelemetryEvent
        from enterprise.telemetry.telemetry_log import emit_metric_only_event
        from extensions.ext_enterprise_telemetry import get_enterprise_exporter

        exporter = get_enterprise_exporter()
        if not exporter:
            logger.debug("No exporter available for APP_UPDATED: event_id=%s", envelope.event_id)
            return

        payload = self._rehydrate(envelope)
        if not payload:
            return

        attrs = {
            "dify.app.id": payload.get("app_id"),
            "dify.tenant_id": envelope.tenant_id,
            "dify.event.id": envelope.event_id,
        }

        emit_metric_only_event(
            event_name=EnterpriseTelemetryEvent.APP_UPDATED,
            attributes=attrs,
            tenant_id=envelope.tenant_id,
        )
        exporter.increment_counter(
            EnterpriseTelemetryCounter.APP_UPDATED,
            1,
            {
                "tenant_id": envelope.tenant_id,
                "app_id": str(payload.get("app_id", "")),
            },
        )

    def _on_app_deleted(self, envelope: TelemetryEnvelope) -> None:
        """Handle app deleted event."""
        from enterprise.telemetry.entities import EnterpriseTelemetryCounter, EnterpriseTelemetryEvent
        from enterprise.telemetry.telemetry_log import emit_metric_only_event
        from extensions.ext_enterprise_telemetry import get_enterprise_exporter

        exporter = get_enterprise_exporter()
        if not exporter:
            logger.debug("No exporter available for APP_DELETED: event_id=%s", envelope.event_id)
            return

        payload = self._rehydrate(envelope)
        if not payload:
            return

        attrs = {
            "dify.app.id": payload.get("app_id"),
            "dify.tenant_id": envelope.tenant_id,
            "dify.event.id": envelope.event_id,
        }

        emit_metric_only_event(
            event_name=EnterpriseTelemetryEvent.APP_DELETED,
            attributes=attrs,
            tenant_id=envelope.tenant_id,
        )
        exporter.increment_counter(
            EnterpriseTelemetryCounter.APP_DELETED,
            1,
            {
                "tenant_id": envelope.tenant_id,
                "app_id": str(payload.get("app_id", "")),
            },
        )

    def _on_feedback_created(self, envelope: TelemetryEnvelope) -> None:
        """Handle feedback created event."""
        from enterprise.telemetry.entities import EnterpriseTelemetryCounter, EnterpriseTelemetryEvent
        from enterprise.telemetry.telemetry_log import emit_metric_only_event
        from extensions.ext_enterprise_telemetry import get_enterprise_exporter

        exporter = get_enterprise_exporter()
        if not exporter:
            logger.debug("No exporter available for FEEDBACK_CREATED: event_id=%s", envelope.event_id)
            return

        payload = self._rehydrate(envelope)
        if not payload:
            return

        include_content = exporter.include_content
        attrs: dict = {
            "dify.message.id": payload.get("message_id"),
            "dify.tenant_id": envelope.tenant_id,
            "dify.event.id": envelope.event_id,
            "dify.app_id": payload.get("app_id"),
            "dify.conversation.id": payload.get("conversation_id"),
            "gen_ai.user.id": payload.get("from_end_user_id") or payload.get("from_account_id"),
            "dify.feedback.rating": payload.get("rating"),
            "dify.feedback.from_source": payload.get("from_source"),
        }
        if include_content:
            attrs["dify.feedback.content"] = payload.get("content")

        user_id = payload.get("from_end_user_id") or payload.get("from_account_id")
        emit_metric_only_event(
            event_name=EnterpriseTelemetryEvent.FEEDBACK_CREATED,
            attributes=attrs,
            tenant_id=envelope.tenant_id,
            user_id=str(user_id or ""),
        )
        exporter.increment_counter(
            EnterpriseTelemetryCounter.FEEDBACK,
            1,
            {
                "tenant_id": envelope.tenant_id,
                "app_id": str(payload.get("app_id", "")),
                "rating": str(payload.get("rating", "")),
            },
        )

    def _on_message_run(self, envelope: TelemetryEnvelope) -> None:
        """Handle message run event (stub)."""
        logger.debug("Processing MESSAGE_RUN: event_id=%s", envelope.event_id)

    def _on_tool_execution(self, envelope: TelemetryEnvelope) -> None:
        """Handle tool execution event (stub)."""
        logger.debug("Processing TOOL_EXECUTION: event_id=%s", envelope.event_id)

    def _on_moderation_check(self, envelope: TelemetryEnvelope) -> None:
        """Handle moderation check event (stub)."""
        logger.debug("Processing MODERATION_CHECK: event_id=%s", envelope.event_id)

    def _on_suggested_question(self, envelope: TelemetryEnvelope) -> None:
        """Handle suggested question event (stub)."""
        logger.debug("Processing SUGGESTED_QUESTION: event_id=%s", envelope.event_id)

    def _on_dataset_retrieval(self, envelope: TelemetryEnvelope) -> None:
        """Handle dataset retrieval event (stub)."""
        logger.debug("Processing DATASET_RETRIEVAL: event_id=%s", envelope.event_id)

    def _on_generate_name(self, envelope: TelemetryEnvelope) -> None:
        """Handle generate name event (stub)."""
        logger.debug("Processing GENERATE_NAME: event_id=%s", envelope.event_id)

    def _on_prompt_generation(self, envelope: TelemetryEnvelope) -> None:
        """Handle prompt generation event (stub)."""
        logger.debug("Processing PROMPT_GENERATION: event_id=%s", envelope.event_id)
