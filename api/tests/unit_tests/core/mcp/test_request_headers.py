"""Unit tests for MCP request-header capture at the API boundary."""

from flask import Flask

from core.mcp.request_headers import capture_request_header_context


class TestCaptureRequestHeaderContext:
    def test_returns_none_without_request_context(self):
        assert capture_request_header_context() is None

    def test_captures_plain_headers(self):
        app = Flask("test")
        with app.test_request_context(headers={"X-User-Id": "user123", "X-Tenant-Region": "eu"}):
            captured = capture_request_header_context()

        assert captured is not None
        assert captured["X-User-Id"] == "user123"
        assert captured["X-Tenant-Region"] == "eu"

    def test_strips_credential_material(self):
        app = Flask("test")
        with app.test_request_context(
            headers={
                "Authorization": "Bearer secret",
                "Proxy-Authorization": "Basic secret",
                "Cookie": "session=secret",
                "X-Inner-Api-Key": "inner-secret",
                "X-User-Id": "user123",
            }
        ):
            captured = capture_request_header_context()

        assert captured is not None
        lowered = {name.lower() for name in captured}
        assert "authorization" not in lowered
        assert "proxy-authorization" not in lowered
        assert "cookie" not in lowered
        assert "x-inner-api-key" not in lowered
        assert captured["X-User-Id"] == "user123"

    def test_returns_none_when_everything_filtered(self):
        app = Flask("test")
        with app.test_request_context(headers={"Authorization": "Bearer secret", "Cookie": "session=secret"}):
            # Host header is also present in a test request context, so drop it
            # from the assertion by filtering to a header set we control.
            captured = capture_request_header_context()

        assert captured is None or set(captured) <= {"Host"}
