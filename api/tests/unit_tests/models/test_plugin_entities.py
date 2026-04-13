import binascii
from collections.abc import Mapping
from typing import Any

from core.plugin.entities.request import TriggerDispatchResponse


def test_trigger_dispatch_response():
    raw_http_response = b'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{"message": "Hello, world!"}'

    data: Mapping[str, Any] = {
        "user_id": "123",
        "events": ["event1", "event2"],
        "response": binascii.hexlify(raw_http_response).decode(),
        "payload": {"key": "value"},
    }

    response = TriggerDispatchResponse(**data)

    assert response.response.status_code == 200
    assert response.response.headers["Content-Type"] == "application/json"
    assert response.response.get_data(as_text=True) == '{"message": "Hello, world!"}'
