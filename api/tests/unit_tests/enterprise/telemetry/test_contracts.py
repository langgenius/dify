"""Unit tests for telemetry gateway contracts."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from enterprise.telemetry.contracts import CaseRoute, TelemetryCase, TelemetryEnvelope
from enterprise.telemetry.gateway import CASE_ROUTING


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
        route = CaseRoute(signal_type="trace", ce_eligible=True)
        assert route.signal_type == "trace"
        assert route.ce_eligible is True

    def test_valid_metric_log_route(self) -> None:
        """Verify valid metric_log route creation."""
        route = CaseRoute(signal_type="metric_log", ce_eligible=False)
        assert route.signal_type == "metric_log"
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
        assert envelope.payload_fallback is None
        assert envelope.metadata is None

    def test_valid_envelope_full(self) -> None:
        """Verify valid envelope with all fields."""
        metadata = {"source": "api"}
        fallback = b"fallback data"
        envelope = TelemetryEnvelope(
            case=TelemetryCase.MESSAGE_RUN,
            tenant_id="tenant-789",
            event_id="event-012",
            payload={"message": "hello"},
            payload_fallback=fallback,
            metadata=metadata,
        )
        assert envelope.case == TelemetryCase.MESSAGE_RUN
        assert envelope.tenant_id == "tenant-789"
        assert envelope.event_id == "event-012"
        assert envelope.payload == {"message": "hello"}
        assert envelope.payload_fallback == fallback
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

    def test_payload_fallback_within_limit(self) -> None:
        """Verify payload_fallback within 64KB limit is accepted."""
        fallback = b"x" * 65536
        envelope = TelemetryEnvelope(
            case=TelemetryCase.WORKFLOW_RUN,
            tenant_id="tenant-123",
            event_id="event-456",
            payload={"key": "value"},
            payload_fallback=fallback,
        )
        assert envelope.payload_fallback == fallback

    def test_payload_fallback_exceeds_limit(self) -> None:
        """Verify payload_fallback exceeding 64KB is rejected."""
        fallback = b"x" * 65537
        with pytest.raises(ValidationError) as exc_info:
            TelemetryEnvelope(
                case=TelemetryCase.WORKFLOW_RUN,
                tenant_id="tenant-123",
                event_id="event-456",
                payload={"key": "value"},
                payload_fallback=fallback,
            )
        assert "64KB" in str(exc_info.value)

    def test_payload_fallback_none(self) -> None:
        """Verify payload_fallback can be None."""
        envelope = TelemetryEnvelope(
            case=TelemetryCase.WORKFLOW_RUN,
            tenant_id="tenant-123",
            event_id="event-456",
            payload={"key": "value"},
            payload_fallback=None,
        )
        assert envelope.payload_fallback is None


class TestCaseRouting:
    """Tests for CASE_ROUTING table."""

    def test_all_cases_routed(self) -> None:
        """Verify all 14 cases have routing entries."""
        assert len(CASE_ROUTING) == 14
        for case in TelemetryCase:
            assert case in CASE_ROUTING

    def test_trace_ce_eligible_cases(self) -> None:
        """Verify trace cases with CE eligibility."""
        ce_eligible_trace_cases = {
            TelemetryCase.WORKFLOW_RUN,
            TelemetryCase.MESSAGE_RUN,
        }
        for case in ce_eligible_trace_cases:
            route = CASE_ROUTING[case]
            assert route.signal_type == "trace"
            assert route.ce_eligible is True

    def test_trace_enterprise_only_cases(self) -> None:
        """Verify trace cases that are enterprise-only."""
        enterprise_only_trace_cases = {
            TelemetryCase.NODE_EXECUTION,
            TelemetryCase.DRAFT_NODE_EXECUTION,
            TelemetryCase.PROMPT_GENERATION,
        }
        for case in enterprise_only_trace_cases:
            route = CASE_ROUTING[case]
            assert route.signal_type == "trace"
            assert route.ce_eligible is False

    def test_metric_log_cases(self) -> None:
        """Verify metric/log-only cases."""
        metric_log_cases = {
            TelemetryCase.APP_CREATED,
            TelemetryCase.APP_UPDATED,
            TelemetryCase.APP_DELETED,
            TelemetryCase.FEEDBACK_CREATED,
            TelemetryCase.TOOL_EXECUTION,
            TelemetryCase.MODERATION_CHECK,
            TelemetryCase.SUGGESTED_QUESTION,
            TelemetryCase.DATASET_RETRIEVAL,
            TelemetryCase.GENERATE_NAME,
        }
        for case in metric_log_cases:
            route = CASE_ROUTING[case]
            assert route.signal_type == "metric_log"
            assert route.ce_eligible is False

    def test_routing_table_completeness(self) -> None:
        """Verify routing table covers all cases with correct types."""
        trace_cases = {
            TelemetryCase.WORKFLOW_RUN,
            TelemetryCase.MESSAGE_RUN,
            TelemetryCase.NODE_EXECUTION,
            TelemetryCase.DRAFT_NODE_EXECUTION,
            TelemetryCase.PROMPT_GENERATION,
        }
        metric_log_cases = {
            TelemetryCase.APP_CREATED,
            TelemetryCase.APP_UPDATED,
            TelemetryCase.APP_DELETED,
            TelemetryCase.FEEDBACK_CREATED,
            TelemetryCase.TOOL_EXECUTION,
            TelemetryCase.MODERATION_CHECK,
            TelemetryCase.SUGGESTED_QUESTION,
            TelemetryCase.DATASET_RETRIEVAL,
            TelemetryCase.GENERATE_NAME,
        }

        all_cases = trace_cases | metric_log_cases
        assert len(all_cases) == 14
        assert all_cases == set(TelemetryCase)

        for case in trace_cases:
            assert CASE_ROUTING[case].signal_type == "trace"

        for case in metric_log_cases:
            assert CASE_ROUTING[case].signal_type == "metric_log"
