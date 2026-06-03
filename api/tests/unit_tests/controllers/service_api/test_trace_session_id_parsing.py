import pytest
from werkzeug.exceptions import BadRequest

from core.helper.trace_id_helper import get_trace_session_id


class _Request:
    def __init__(self, *, headers=None, args=None, json=None, is_json=True):
        self.headers = headers or {}
        self.args = args or {}
        self.json = json
        self.is_json = is_json


def test_trace_session_id_header_query_body_priority_matches_service_api_contract():
    req = _Request(
        headers={"X-Trace-Session-Id": "header"},
        args={"trace_session_id": "query"},
        json={"trace_session_id": "body"},
    )

    assert get_trace_session_id(req) == "header"


def test_trace_session_id_invalid_highest_priority_raises_bad_request():
    req = _Request(
        headers={"X-Trace-Session-Id": "   "},
        args={"trace_session_id": "query"},
        json={"trace_session_id": "body"},
    )

    with pytest.raises(BadRequest):
        get_trace_session_id(req)
