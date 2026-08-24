"""Unit tests for telemetry gateway contracts."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from enterprise.telemetry.contracts import CaseRoute, SignalType, TelemetryCase, TelemetryEnvelope


class TestTelemetryCase:
    """Tests for TelemetryCase enum."""

    def test_all_cases_defined(self) -> None:
        """Verify all 14 telemetry cases are defined."""
        expected_cases = {
            "WORKFLOW_RUN",
            "NODE_EXECUTION",
            "DRAFT_NODE_EXECUTION",
            "MESSAGE_RUN",
            "TOOL_EXECUTION",
            "MODERATION_CHECK",
            "SUGGESTED_QUESTION",
            "DATASET_RETRIEVAL",
            "GENERATE_NAME",
            "PROMPT_GENERATION",
            "APP_CREATED",
            "APP_UPDATED",
            "APP_DELETED",
            "FEEDBACK_CREATED",
        }
        actual_cases = {case.name for case in TelemetryCase}
        assert actual_cases == expected_cases

    def test_case_values(self) -> None:
        """Verify case enum values are correct."""
        assert TelemetryCase.WORKFLOW_RUN.value == "workflow_run"
        assert TelemetryCase.NODE_EXECUTION.value == "node_execution"
        assert TelemetryCase.DRAFT_NODE_EXECUTION.value == "draft_node_execution"
        assert TelemetryCase.MESSAGE_RUN.value == "message_run"
        assert TelemetryCase.TOOL_EXECUTION.value == "tool_execution"
        assert TelemetryCase.MODERATION_CHECK.value == "moderation_check"
        assert TelemetryCase.SUGGESTED_QUESTION.value == "suggested_question"
        assert TelemetryCase.DATASET_RETRIEVAL.value == "dataset_retrieval"
        assert TelemetryCase.GENERATE_NAME.value == "generate_name"
        assert TelemetryCase.PROMPT_GENERATION.value == "prompt_generation"
        assert TelemetryCase.APP_CREATED.value == "app_created"
        assert TelemetryCase.APP_UPDATED.value == "app_updated"
        assert TelemetryCase.APP_DELETED.value == "app_deleted"
        assert TelemetryCase.FEEDBACK_CREATED.value == "feedback_created"


class TestCaseRoute:
    """Tests for CaseRoute model."""

    def test_valid_trace_route(self) -> None:
        """Verify valid trace route creation."""
        route = CaseRoute(signal_type=SignalType.TRACE, ce_eligible=True)
        assert route.signal_type == SignalType.TRACE
        assert route.ce_eligible is True

    def test_valid_metric_log_route(self) -> None:
        """Verify valid metric_log route creation."""
        route = CaseRoute(signal_type=SignalType.METRIC_LOG, ce_eligible=False)
        assert route.signal_type == SignalType.METRIC_LOG
        assert route.ce_eligible is False

    def test_invalid_signal_type(self) -> None:
        """Verify invalid signal_type is rejected."""
        with pytest.raises(ValidationError):
            CaseRoute(signal_type="invalid", ce_eligible=True)


class TestTelemetryEnvelope:
    """Tests for TelemetryEnvelope model."""

    def test_valid_envelope_minimal(self) -> None:
        """Verify valid minimal envelope creation."""
        envelope = TelemetryEnvelope(
            case=TelemetryCase.WORKFLOW_RUN,
            tenant_id="tenant-123",
            event_id="event-456",
            payload={"key": "value"},
        )
        assert envelope.case == TelemetryCase.WORKFLOW_RUN
        assert envelope.tenant_id == "tenant-123"
        assert envelope.event_id == "event-456"
        assert envelope.payload == {"key": "value"}
        assert envelope.metadata is None

    def test_valid_envelope_full(self) -> None:
        """Verify valid envelope with all fields."""
        metadata = {"payload_ref": "telemetry/tenant-789/event-012.json"}
        envelope = TelemetryEnvelope(
            case=TelemetryCase.MESSAGE_RUN,
            tenant_id="tenant-789",
            event_id="event-012",
            payload={"message": "hello"},
            metadata=metadata,
        )
        assert envelope.case == TelemetryCase.MESSAGE_RUN
        assert envelope.tenant_id == "tenant-789"
        assert envelope.event_id == "event-012"
        assert envelope.payload == {"message": "hello"}
        assert envelope.metadata == metadata

    def test_missing_required_case(self) -> None:
        """Verify missing case field is rejected."""
        with pytest.raises(ValidationError):
            TelemetryEnvelope(
                tenant_id="tenant-123",
                event_id="event-456",
                payload={"key": "value"},
            )

    def test_missing_required_tenant_id(self) -> None:
        """Verify missing tenant_id field is rejected."""
        with pytest.raises(ValidationError):
            TelemetryEnvelope(
                case=TelemetryCase.WORKFLOW_RUN,
                event_id="event-456",
                payload={"key": "value"},
            )

    def test_missing_required_event_id(self) -> None:
        """Verify missing event_id field is rejected."""
        with pytest.raises(ValidationError):
            TelemetryEnvelope(
                case=TelemetryCase.WORKFLOW_RUN,
                tenant_id="tenant-123",
                payload={"key": "value"},
            )

    def test_missing_required_payload(self) -> None:
        """Verify missing payload field is rejected."""
        with pytest.raises(ValidationError):
            TelemetryEnvelope(
                case=TelemetryCase.WORKFLOW_RUN,
                tenant_id="tenant-123",
                event_id="event-456",
            )

    def test_metadata_none(self) -> None:
        """Verify metadata can be None."""
        envelope = TelemetryEnvelope(
            case=TelemetryCase.WORKFLOW_RUN,
            tenant_id="tenant-123",
            event_id="event-456",
            payload={"key": "value"},
            metadata=None,
        )
        assert envelope.metadata is None


class TestEventRoutingMetadata:
    """Verify event classes declare correct routing fields (replaces CASE_ROUTING table tests)."""

    def test_trace_enterprise_only_events(self) -> None:
        from core.telemetry.events import DraftNodeExecutionTraceEvent, PromptGenerationEvent

        for cls in (DraftNodeExecutionTraceEvent, PromptGenerationEvent):
            assert cls.signal_type is SignalType.TRACE  # type: ignore[attr-defined]
            assert cls.ce_eligible is False  # type: ignore[attr-defined]
            assert cls.trace_task_name is not None  # type: ignore[attr-defined]

    def test_metric_log_events(self) -> None:
        from core.telemetry.events import (
            AppCreatedEvent,
            AppDeletedEvent,
            AppUpdatedEvent,
            FeedbackCreatedEvent,
        )

        for cls in (AppCreatedEvent, AppUpdatedEvent, AppDeletedEvent, FeedbackCreatedEvent):
            assert cls.signal_type is SignalType.METRIC_LOG  # type: ignore[attr-defined]
            assert cls.ce_eligible is False  # type: ignore[attr-defined]
            assert cls.trace_task_name is None  # type: ignore[attr-defined]
