from libs.exception import BaseHTTPException


class _DummyError(BaseHTTPException):
    error_code = "dummy"
    description = "dummy description"
    code = 400


class TestBaseHTTPException:
    def test_override_error_code(self):
        err = _DummyError("detail", error_code="used_up")
        assert err.data
        assert err.data["code"] == "used_up"
        assert err.data["message"] == "detail"
        assert err.data["status"] == 400

    def test_no_override_uses_default(self):
        err = _DummyError("detail")
        assert err.data
        assert err.data["code"] == "dummy"
