import json

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

    assert b"GET /test? HTTP/1.1" in raw_request_bytes
    assert b"Content-Type: application/json" in raw_request_bytes
    assert b"\r\n\r\n" in raw_request_bytes


def test_oauth_convert_request_to_raw_data_with_query_params():
    oauth_handler = OAuthHandler()
    builder = EnvironBuilder(
        method="GET",
        path="/test",
        query_string="code=abc123&state=xyz789",
        headers=Headers({"Content-Type": "application/json"}),
    )
    request = Request(builder.get_environ())
    raw_request_bytes = oauth_handler._convert_request_to_raw_data(request)

    assert b"GET /test?code=abc123&state=xyz789 HTTP/1.1" in raw_request_bytes
    assert b"Content-Type: application/json" in raw_request_bytes
    assert b"\r\n\r\n" in raw_request_bytes


def test_oauth_convert_request_to_raw_data_with_post_body():
    oauth_handler = OAuthHandler()
    builder = EnvironBuilder(
        method="POST",
        path="/test",
        data="param1=value1&param2=value2",
        headers=Headers({"Content-Type": "application/x-www-form-urlencoded"}),
    )
    request = Request(builder.get_environ())
    raw_request_bytes = oauth_handler._convert_request_to_raw_data(request)

    assert b"POST /test? HTTP/1.1" in raw_request_bytes
    assert b"Content-Type: application/x-www-form-urlencoded" in raw_request_bytes
    assert b"\r\n\r\n" in raw_request_bytes
    assert b"param1=value1&param2=value2" in raw_request_bytes


def test_oauth_convert_request_to_raw_data_with_json_body():
    oauth_handler = OAuthHandler()
    json_data = {"code": "abc123", "state": "xyz789", "grant_type": "authorization_code"}
    builder = EnvironBuilder(
        method="POST",
        path="/test",
        data=json.dumps(json_data),
        headers=Headers({"Content-Type": "application/json"}),
    )
    request = Request(builder.get_environ())
    raw_request_bytes = oauth_handler._convert_request_to_raw_data(request)

    assert b"POST /test? HTTP/1.1" in raw_request_bytes
    assert b"Content-Type: application/json" in raw_request_bytes
    assert b"\r\n\r\n" in raw_request_bytes
    assert b'"code": "abc123"' in raw_request_bytes
    assert b'"state": "xyz789"' in raw_request_bytes
    assert b'"grant_type": "authorization_code"' in raw_request_bytes
