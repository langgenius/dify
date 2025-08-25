import re
import sys
from typing import Any

from flask import current_app, got_request_exception
from flask_restx import Api
from werkzeug.datastructures import Headers
from werkzeug.exceptions import HTTPException
from werkzeug.http import HTTP_STATUS_CODES

from core.errors.error import AppInvokeQuotaExceededError


def http_status_message(code):
    """Maps an HTTP status code to the textual status"""
    return HTTP_STATUS_CODES.get(code, "")


def register_external_error_handlers(api: Api) -> None:
    """Register error handlers for the API using decorators.

    :param api: The Flask-RestX Api instance
    """

    @api.errorhandler(HTTPException)
    def handle_http_exception(e: HTTPException):
        """Handle HTTP exceptions."""
        got_request_exception.send(current_app, exception=e)

        if e.response is not None:
            return e.get_response()

        headers = Headers()
        status_code = e.code
        default_data = {
            "code": re.sub(r"(?<!^)(?=[A-Z])", "_", type(e).__name__).lower(),
            "message": getattr(e, "description", http_status_message(status_code)),
            "status": status_code,
        }

        if (
            default_data["message"]
            and default_data["message"] == "Failed to decode JSON object: Expecting value: line 1 column 1 (char 0)"
        ):
            default_data["message"] = "Invalid JSON payload received or JSON payload is empty."

        headers = e.get_response().headers

        # Handle specific status codes
        if status_code == 406 and api.default_mediatype is None:
            supported_mediatypes = list(api.representations.keys())
            fallback_mediatype = supported_mediatypes[0] if supported_mediatypes else "text/plain"
            data = {"code": "not_acceptable", "message": default_data.get("message")}
            resp = api.make_response(data, status_code, headers, fallback_mediatype=fallback_mediatype)
        elif status_code == 400:
            if isinstance(default_data.get("message"), dict):
                param_key, param_value = list(default_data.get("message", {}).items())[0]
                data = {"code": "invalid_param", "message": param_value, "params": param_key}
            else:
                data = default_data
                if "code" not in data:
                    data["code"] = "unknown"
            resp = api.make_response(data, status_code, headers)
        else:
            data = default_data
            if "code" not in data:
                data["code"] = "unknown"
            resp = api.make_response(data, status_code, headers)

        if status_code == 401:
            resp = api.unauthorized(resp)

        # Remove duplicate Content-Length header
        remove_headers = ("Content-Length",)
        for header in remove_headers:
            headers.pop(header, None)

        return resp

    @api.errorhandler(ValueError)
    def handle_value_error(e: ValueError):
        """Handle ValueError exceptions."""
        got_request_exception.send(current_app, exception=e)

        status_code = 400
        data = {
            "code": "invalid_param",
            "message": str(e),
            "status": status_code,
        }
        return api.make_response(data, status_code)

    @api.errorhandler(AppInvokeQuotaExceededError)
    def handle_quota_exceeded(e: AppInvokeQuotaExceededError):
        """Handle AppInvokeQuotaExceededError exceptions."""
        got_request_exception.send(current_app, exception=e)

        status_code = 429
        data = {
            "code": "too_many_requests",
            "message": str(e),
            "status": status_code,
        }
        return api.make_response(data, status_code)

    @api.errorhandler(Exception)
    def handle_general_exception(e: Exception):
        """Handle general exceptions."""
        got_request_exception.send(current_app, exception=e)

        headers = Headers()
        status_code = 500
        default_data = {
            "message": http_status_message(status_code),
        }

        data = getattr(e, "data", default_data)

        # Log server errors
        exc_info: Any = sys.exc_info()
        if exc_info[1] is None:
            exc_info = None
        current_app.log_exception(exc_info)

        if "code" not in data:
            data["code"] = "unknown"

        # Remove duplicate Content-Length header
        remove_headers = ("Content-Length",)
        for header in remove_headers:
            headers.pop(header, None)

        return api.make_response(data, status_code, headers)


class ExternalApi(Api):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        register_external_error_handlers(self)
