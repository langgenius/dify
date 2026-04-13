import pytest

from core.helper.trace_id_helper import extract_external_trace_id_from_args, get_external_trace_id, is_valid_trace_id


class DummyRequest:
    def __init__(self, headers=None, args=None, json=None, is_json=False):
        self.headers = headers or {}
        self.args = args or {}
        self.json = json
        self.is_json = is_json


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
