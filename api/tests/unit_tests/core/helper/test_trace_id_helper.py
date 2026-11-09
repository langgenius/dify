import re
from unittest import mock

import pytest
from opentelemetry.trace import NonRecordingSpan, SpanContext, use_span
from werkzeug.exceptions import BadRequest

from core.helper.trace_id_helper import (
    ParentTraceContext,
    extract_external_trace_id_from_args,
    extract_parent_trace_context_from_args,
    extract_trace_session_id_from_args,
    get_external_trace_id,
    get_trace_session_id,
    is_valid_trace_id,
)


def test_extract_trace_session_id_from_args_for_generator_extras():
    assert extract_trace_session_id_from_args({"trace_session_id": "session-1"}) == {
        "trace_session_id": "session-1",
    }


def test_extract_trace_session_id_from_args_missing_value_keeps_extras_clean():
    assert extract_trace_session_id_from_args({"inputs": {}}) == {}


class DummyRequest:
    def __init__(
        self,
        headers: dict[str, object] | None = None,
        args: dict[str, object] | None = None,
        json: dict[str, object] | None = None,
        is_json: bool = False,
    ) -> None:
        self.headers = headers or {}
        self.args = args or {}
        self.json = json
        self.is_json = is_json


class _Request:
    def __init__(
        self,
        *,
        headers: dict[str, object] | None = None,
        args: dict[str, object] | None = None,
        json: dict[str, object] | None = None,
        is_json: bool = True,
    ) -> None:
        self.headers = headers or {}
        self.args = args or {}
        self.json = json
        self.is_json = is_json


def test_get_trace_session_id_prefers_header_over_query_and_body() -> None:
    request = _Request(
        headers={"X-Trace-Session-Id": "  header-session  "},
        args={"trace_session_id": "query-session"},
        json={"trace_session_id": "body-session"},
    )

    assert get_trace_session_id(request) == "header-session"


def test_get_trace_session_id_prefers_query_over_body() -> None:
    request = _Request(
        args={"trace_session_id": "  query-session  "},
        json={"trace_session_id": "body-session"},
    )

    assert get_trace_session_id(request) == "query-session"


def test_get_trace_session_id_reads_body_when_no_higher_priority_input() -> None:
    request = _Request(json={"trace_session_id": "  body/session:123  "})

    assert get_trace_session_id(request) == "body/session:123"


def test_get_trace_session_id_ignores_invalid_lower_priority_value() -> None:
    request = _Request(
        headers={"X-Trace-Session-Id": "header-session"},
        json={"trace_session_id": "   "},
    )

    assert get_trace_session_id(request) == "header-session"


@pytest.mark.parametrize(
    "trace_session_request",
    [
        _Request(headers={"X-Trace-Session-Id": "   "}, json={"trace_session_id": "body-session"}),
        _Request(headers={"X-Trace-Session-Id": 123}),
        _Request(headers={"X-Trace-Session-Id": "x" * 201}),
    ],
)
def test_get_trace_session_id_rejects_invalid_highest_priority_input(trace_session_request: _Request) -> None:
    with pytest.raises(BadRequest) as exc_info:
        get_trace_session_id(trace_session_request)

    assert "trace_session_id" in str(exc_info.value)


def test_get_trace_session_id_does_not_read_trace_id_or_traceparent() -> None:
    request = _Request(
        headers={
            "X-Trace-Id": "trace-id",
            "traceparent": "00-5b8aa5a2d2c872e8321cf37308d69df2-051581bf3bb55c45-01",
        },
        args={"trace_id": "query-trace-id"},
        json={"trace_id": "body-trace-id"},
    )

    assert get_trace_session_id(request) is None


def test_extract_trace_session_id_from_args_returns_trimmed_value() -> None:
    args = {"trace_session_id": "  session-1  "}

    assert extract_trace_session_id_from_args(args) == {"trace_session_id": "session-1"}


def test_extract_trace_session_id_from_args_returns_empty_dict_when_missing() -> None:
    assert extract_trace_session_id_from_args({}) == {}


def test_extract_trace_session_id_from_args_returns_empty_dict_when_blank_after_trim() -> None:
    assert extract_trace_session_id_from_args({"trace_session_id": "   "}) == {}


class TestTraceIdHelper:
    """Test cases for trace_id_helper.py"""

    @pytest.mark.parametrize(
        ("trace_id", "expected"),
        [
            ("abc123", True),
            ("A-B_C-123", True),
            ("a" * 128, True),
            ("", False),
            ("a" * 129, False),
            ("abc!@#", False),
            ("空格", False),
            ("with space", False),
        ],
    )
    def test_is_valid_trace_id(self, trace_id: str, expected: bool) -> None:
        """Test trace_id validation for various cases"""
        assert is_valid_trace_id(trace_id) is expected

    def test_get_external_trace_id_from_header(self) -> None:
        """Should extract valid trace_id from header"""
        req = DummyRequest(headers={"X-Trace-Id": "abc123"})
        assert get_external_trace_id(req) == "abc123"

    def test_get_external_trace_id_from_args(self) -> None:
        """Should extract valid trace_id from args if header missing"""
        req = DummyRequest(args={"trace_id": "abc123"})
        assert get_external_trace_id(req) == "abc123"

    def test_get_external_trace_id_from_json(self) -> None:
        """Should extract valid trace_id from JSON body if header and args missing"""
        req = DummyRequest(is_json=True, json={"trace_id": "abc123"})
        assert get_external_trace_id(req) == "abc123"

    def test_get_external_trace_id_priority(self) -> None:
        """Header > args > json priority"""
        req = DummyRequest(
            headers={"X-Trace-Id": "header_id"},
            args={"trace_id": "args_id"},
            is_json=True,
            json={"trace_id": "json_id"},
        )
        assert get_external_trace_id(req) == "header_id"
        req2 = DummyRequest(args={"trace_id": "args_id"}, is_json=True, json={"trace_id": "json_id"})
        assert get_external_trace_id(req2) == "args_id"
        req3 = DummyRequest(is_json=True, json={"trace_id": "json_id"})
        assert get_external_trace_id(req3) == "json_id"

    @pytest.mark.parametrize(
        "req",
        [
            DummyRequest(headers={"X-Trace-Id": "!!!"}),
            DummyRequest(args={"trace_id": "!!!"}),
            DummyRequest(is_json=True, json={"trace_id": "!!!"}),
            DummyRequest(),
        ],
    )
    def test_get_external_trace_id_invalid(self, req: DummyRequest) -> None:
        """Should return None for invalid or missing trace_id"""
        assert get_external_trace_id(req) is None

    @pytest.mark.parametrize(
        ("args", "expected"),
        [
            ({"external_trace_id": "abc123"}, {"external_trace_id": "abc123"}),
            ({"other": "value"}, {}),
            ({}, {}),
        ],
    )
    def test_extract_external_trace_id_from_args(self, args: dict[str, object], expected: dict[str, object]) -> None:
        """Test extraction of external_trace_id from args mapping"""
        assert extract_external_trace_id_from_args(args) == expected

    @pytest.mark.parametrize(
        ("args", "expected"),
        [
            (
                {
                    "parent_trace_context": {
                        "parent_workflow_run_id": "workflow-run-1",
                        "parent_node_execution_id": "node-execution-1",
                    }
                },
                {
                    "parent_trace_context": ParentTraceContext(
                        parent_workflow_run_id="workflow-run-1",
                        parent_node_execution_id="node-execution-1",
                    )
                },
            ),
            (
                {
                    "parent_trace_context": {
                        "parent_workflow_run_id": "workflow-run-1",
                    }
                },
                {},
            ),
            (
                {
                    "parent_trace_context": {
                        "parent_node_execution_id": "node-execution-1",
                    }
                },
                {},
            ),
            (
                {
                    "parent_trace_context": {
                        "parent_workflow_run_id": 123,
                        "parent_node_execution_id": "node-execution-1",
                    }
                },
                {},
            ),
            (
                {
                    "parent_trace_context": {
                        "parent_workflow_run_id": "workflow-run-1",
                        "parent_node_execution_id": None,
                    }
                },
                {},
            ),
            ({}, {}),
        ],
    )
    def test_extract_parent_trace_context_from_args(self, args: dict[str, object], expected: dict[str, object]) -> None:
        """Test extraction of parent_trace_context from args mapping"""
        assert extract_parent_trace_context_from_args(args) == expected

    def test_extract_parent_trace_context_returns_typed_context(self) -> None:
        """Parent trace context is parsed into a Pydantic value object."""
        result = extract_parent_trace_context_from_args(
            {
                "parent_trace_context": {
                    "parent_workflow_run_id": "workflow-run-1",
                    "parent_node_execution_id": "node-execution-1",
                }
            }
        )

        assert result == {
            "parent_trace_context": ParentTraceContext(
                parent_workflow_run_id="workflow-run-1",
                parent_node_execution_id="node-execution-1",
            )
        }

    def test_extract_parent_trace_context_rejects_incomplete_typed_context(self) -> None:
        """Typed parent trace context follows the same completeness rule as raw mappings."""
        result = extract_parent_trace_context_from_args(
            {
                "parent_trace_context": ParentTraceContext(
                    parent_workflow_run_id="workflow-run-1",
                    parent_node_execution_id=None,
                )
            }
        )

        assert result == {}


"""Tests for trace helper functions."""


class TestGetSpanIdFromOtelContext:
    def test_returns_none_without_span(self):
        from core.helper.trace_id_helper import get_span_id_from_otel_context

        with mock.patch("opentelemetry.trace.get_current_span", return_value=None, autospec=True):
            result = get_span_id_from_otel_context()
            assert result is None

    def test_returns_span_id_when_available(self):
        from core.helper.trace_id_helper import get_span_id_from_otel_context

        span = NonRecordingSpan(SpanContext(trace_id=1, span_id=0x051581BF3BB55C45, is_remote=False))
        with use_span(span):
            result = get_span_id_from_otel_context()
            assert result == "051581bf3bb55c45"

    def test_returns_none_on_exception(self):
        from core.helper.trace_id_helper import get_span_id_from_otel_context

        with mock.patch("opentelemetry.trace.get_current_span", side_effect=Exception("Test error"), autospec=True):
            result = get_span_id_from_otel_context()
            assert result is None


class TestGenerateTraceparentHeader:
    def test_generates_valid_format(self):
        from core.helper.trace_id_helper import generate_traceparent_header

        with mock.patch("opentelemetry.trace.get_current_span", return_value=None, autospec=True):
            result = generate_traceparent_header()

            assert result is not None
            # Format: 00-{trace_id}-{span_id}-01
            parts = result.split("-")
            assert len(parts) == 4
            assert parts[0] == "00"  # version
            assert len(parts[1]) == 32  # trace_id (32 hex chars)
            assert len(parts[2]) == 16  # span_id (16 hex chars)
            assert parts[3] == "01"  # flags

    def test_uses_otel_context_when_available(self):
        from core.helper.trace_id_helper import generate_traceparent_header

        span = NonRecordingSpan(
            SpanContext(
                trace_id=0x5B8AA5A2D2C872E8321CF37308D69DF2,
                span_id=0x051581BF3BB55C45,
                is_remote=False,
            )
        )
        with use_span(span):
            result = generate_traceparent_header()
            assert result == "00-5b8aa5a2d2c872e8321cf37308d69df2-051581bf3bb55c45-01"

    def test_generates_hex_only_values(self):
        from core.helper.trace_id_helper import generate_traceparent_header

        with mock.patch("opentelemetry.trace.get_current_span", return_value=None, autospec=True):
            result = generate_traceparent_header()

            parts = result.split("-")
            # All parts should be valid hex
            assert re.match(r"^[0-9a-f]+$", parts[1])
            assert re.match(r"^[0-9a-f]+$", parts[2])


class TestParseTraceparentHeader:
    def test_parses_valid_traceparent(self):
        from core.helper.trace_id_helper import parse_traceparent_header

        traceparent = "00-5b8aa5a2d2c872e8321cf37308d69df2-051581bf3bb55c45-01"
        result = parse_traceparent_header(traceparent)

        assert result == "5b8aa5a2d2c872e8321cf37308d69df2"

    def test_returns_none_for_invalid_format(self):
        from core.helper.trace_id_helper import parse_traceparent_header

        # Wrong number of parts
        assert parse_traceparent_header("00-abc-def") is None
        # Wrong trace_id length
        assert parse_traceparent_header("00-abc-def-01") is None

    def test_returns_none_for_empty_string(self):
        from core.helper.trace_id_helper import parse_traceparent_header

        assert parse_traceparent_header("") is None
