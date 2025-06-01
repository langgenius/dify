from werkzeug import Request
from werkzeug.datastructures import Headers
from werkzeug.test import EnvironBuilder

from core.plugin.impl.oauth import OAuthHandler


def test_oauth_convert_request_to_raw_data():
    oauth_handler = OAuthHandler()
    builder = EnvironBuilder(
        method="GET",
        path="/test",
        headers=Headers({"Content-Type": "application/json"}),
    )
    request = Request(builder.get_environ())
    raw_request_bytes = oauth_handler._convert_request_to_raw_data(request)

    assert b"GET /test HTTP/1.1" in raw_request_bytes
    assert b"Content-Type: application/json" in raw_request_bytes
    assert b"\r\n\r\n" in raw_request_bytes
