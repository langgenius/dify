import pytest
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


class DummyRequest:
    def __init__(self, headers=None, args=None, json=None, is_json=False):
        self.headers = headers or {}
        self.args = args or {}
        self.json = json
        self.is_json = is_json


class _Request:
    def __init__(self, *, headers=None, args=None, json=None, is_json=True):
        self.headers = headers or {}
        self.args = args or {}
        self.json = json
        self.is_json = is_json


def test_get_trace_session_id_prefers_header_over_query_and_body():
    request = _Request(
        headers={"X-Trace-Session-Id": "  header-session  "},
        args={"trace_session_id": "query-session"},
        json={"trace_session_id": "body-session"},
    )

    assert get_trace_session_id(request) == "header-session"


def test_get_trace_session_id_prefers_query_over_body():
    request = _Request(
        args={"trace_session_id": "  query-session  "},
        json={"trace_session_id": "body-session"},
    )

    assert get_trace_session_id(request) == "query-session"


def test_get_trace_session_id_reads_body_when_no_higher_priority_input():
    request = _Request(json={"trace_session_id": "  body/session:123  "})

    assert get_trace_session_id(request) == "body/session:123"


def test_get_trace_session_id_ignores_invalid_lower_priority_value():
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
def test_get_trace_session_id_rejects_invalid_highest_priority_input(trace_session_request):
    with pytest.raises(BadRequest) as exc_info:
        get_trace_session_id(trace_session_request)

    assert "trace_session_id" in str(exc_info.value)


def test_get_trace_session_id_does_not_read_trace_id_or_traceparent():
    request = _Request(
        headers={
            "X-Trace-Id": "trace-id",
            "traceparent": "00-5b8aa5a2d2c872e8321cf37308d69df2-051581bf3bb55c45-01",
        },
        args={"trace_id": "query-trace-id"},
        json={"trace_id": "body-trace-id"},
    )

    assert get_trace_session_id(request) is None


def test_extract_trace_session_id_from_args_returns_trimmed_value():
    args = {"trace_session_id": "  session-1  "}

    assert extract_trace_session_id_from_args(args) == {"trace_session_id": "session-1"}


def test_extract_trace_session_id_from_args_returns_empty_dict_when_missing():
    assert extract_trace_session_id_from_args({}) == {}


def test_extract_trace_session_id_from_args_returns_empty_dict_when_blank_after_trim():
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
    def test_is_valid_trace_id(self, trace_id, expected):
        """Test trace_id validation for various cases"""
        assert is_valid_trace_id(trace_id) is expected

    def test_get_external_trace_id_from_header(self):
        """Should extract valid trace_id from header"""
        req = DummyRequest(headers={"X-Trace-Id": "abc123"})
        assert get_external_trace_id(req) == "abc123"

    def test_get_external_trace_id_from_args(self):
        """Should extract valid trace_id from args if header missing"""
        req = DummyRequest(args={"trace_id": "abc123"})
        assert get_external_trace_id(req) == "abc123"

    def test_get_external_trace_id_from_json(self):
        """Should extract valid trace_id from JSON body if header and args missing"""
        req = DummyRequest(is_json=True, json={"trace_id": "abc123"})
        assert get_external_trace_id(req) == "abc123"

    def test_get_external_trace_id_priority(self):
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
    def test_get_external_trace_id_invalid(self, req):
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
    def test_extract_external_trace_id_from_args(self, args, expected):
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
    def test_extract_parent_trace_context_from_args(self, args, expected):
        """Test extraction of parent_trace_context from args mapping"""
        assert extract_parent_trace_context_from_args(args) == expected

    def test_extract_parent_trace_context_returns_typed_context(self):
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

    def test_extract_parent_trace_context_rejects_incomplete_typed_context(self):
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
