from __future__ import annotations

import pytest
from flask import Flask, request
from werkzeug.exceptions import BadRequest

from controllers.common.workflow_event_cursor import get_workflow_event_replay_cursor


def test_last_event_id_takes_precedence_over_query_cursor(app: Flask) -> None:
    with app.test_request_context("/events?cursor=10-0", headers={"Last-Event-ID": "20-0"}):
        assert get_workflow_event_replay_cursor(request) == "20-0"


def test_query_cursor_is_supported_as_fallback(app: Flask) -> None:
    with app.test_request_context("/events?cursor=10-0"):
        assert get_workflow_event_replay_cursor(request) == "10-0"


def test_invalid_cursor_is_rejected_before_streaming_response_starts(app: Flask) -> None:
    with app.test_request_context("/events?cursor=not-a-stream-id"):
        with pytest.raises(BadRequest, match="event cursor must be a Redis Stream ID"):
            get_workflow_event_replay_cursor(request)


@pytest.mark.parametrize(
    "cursor",
    [
        f"{'9' * 5000}-0",
        "18446744073709551616-0",
        "0-18446744073709551616",
    ],
)
def test_out_of_range_cursor_is_rejected_as_bad_request(app: Flask, cursor: str) -> None:
    with app.test_request_context("/events", headers={"Last-Event-ID": cursor}):
        with pytest.raises(BadRequest, match="unsigned 64-bit"):
            get_workflow_event_replay_cursor(request)


def test_max_unsigned_64_bit_cursor_is_supported(app: Flask) -> None:
    max_component = "18446744073709551615"
    with app.test_request_context("/events", headers={"Last-Event-ID": f"{max_component}-{max_component}"}):
        assert get_workflow_event_replay_cursor(request) == f"{max_component}-{max_component}"
