import re
import sys
from collections.abc import Mapping
from typing import Any

from flask import Blueprint, Flask, current_app, got_request_exception
from flask_restx import Api
from werkzeug.exceptions import HTTPException
from werkzeug.http import HTTP_STATUS_CODES

from configs import dify_config
from core.errors.error import AppInvokeQuotaExceededError
from libs.token import build_force_logout_cookie_headers


def http_status_message(code):
    return HTTP_STATUS_CODES.get(code, "")


def register_external_error_handlers(api: Api):
    @api.errorhandler(HTTPException)
    def handle_http_exception(e: HTTPException):
        got_request_exception.send(current_app, exception=e)

        # If Werkzeug already prepared a Response, just use it.
        if e.response is not None:
            return e.response

        status_code = getattr(e, "code", 500) or 500

        # Build a safe, dict-like payload
        default_data = {
            "code": re.sub(r"(?<!^)(?=[A-Z])", "_", type(e).__name__).lower(),
            "message": getattr(e, "description", http_status_message(status_code)),
            "status": status_code,
        }
        if default_data["message"] == "Failed to decode JSON object: Expecting value: line 1 column 1 (char 0)":
            default_data["message"] = "Invalid JSON payload received or JSON payload is empty."

        # Use headers on the exception if present; otherwise none.
        headers = {}
        exc_headers = getattr(e, "headers", None)
        if exc_headers:
            headers.update(exc_headers)

        # Payload per status
        if status_code == 406 and api.default_mediatype is None:
            data = {"code": "not_acceptable", "message": default_data["message"], "status": status_code}
            return data, status_code, headers
        elif status_code == 400:
            msg = default_data["message"]
            if isinstance(msg, Mapping) and msg:
                # Convert param errors like {"field": "reason"} into a friendly shape
                param_key, param_value = next(iter(msg.items()))
                data = {
                    "code": "invalid_param",
                    "message": str(param_value),
                    "params": param_key,
                    "status": status_code,
                }
            else:
                data = {**default_data}
                data.setdefault("code", "unknown")
            return data, status_code, headers
        else:
            data = {**default_data}
            data.setdefault("code", "unknown")
            # If you need WWW-Authenticate for 401, add it to headers
            if status_code == 401:
                headers["WWW-Authenticate"] = 'Bearer realm="api"'
                # Check if this is a forced logout error - clear cookies
                error_code = getattr(e, "error_code", None)
                if error_code == "unauthorized_and_force_logout":
                    # Add Set-Cookie headers to clear auth cookies
                    headers["Set-Cookie"] = build_force_logout_cookie_headers()
            return data, status_code, headers

    _ = handle_http_exception

    @api.errorhandler(ValueError)
    def handle_value_error(e: ValueError):
        got_request_exception.send(current_app, exception=e)
        status_code = 400
        data = {"code": "invalid_param", "message": str(e), "status": status_code}
        return data, status_code

    _ = handle_value_error

    @api.errorhandler(AppInvokeQuotaExceededError)
    def handle_quota_exceeded(e: AppInvokeQuotaExceededError):
        got_request_exception.send(current_app, exception=e)
        status_code = 429
        data = {"code": "too_many_requests", "message": str(e), "status": status_code}
        return data, status_code

    _ = handle_quota_exceeded

    @api.errorhandler(Exception)
    def handle_general_exception(e: Exception):
        got_request_exception.send(current_app, exception=e)

        status_code = 500
        data: dict[str, Any] = getattr(e, "data", {"message": http_status_message(status_code)})

        # 🔒 Normalize non-mapping data (e.g., if someone set e.data = Response)
        if not isinstance(data, dict):
            data = {"message": str(e)}

        data.setdefault("code", "unknown")
        data.setdefault("status", status_code)

        # Log stack
        exc_info: Any = sys.exc_info()
        if exc_info[1] is None:
            exc_info = (None, None, None)
        current_app.log_exception(exc_info)

        return data, status_code

    _ = handle_general_exception


class ExternalApi(Api):
    _authorizations = {
        "Bearer": {
            "type": "apiKey",
            "in": "header",
            "name": "Authorization",
            "description": "Type: Bearer {your-api-key}",
        }
    }

    def __init__(self, app: Blueprint | Flask, *args, **kwargs):
        kwargs.setdefault("authorizations", self._authorizations)
        kwargs.setdefault("security", "Bearer")
        kwargs["add_specs"] = dify_config.SWAGGER_UI_ENABLED
        kwargs["doc"] = dify_config.SWAGGER_UI_PATH if dify_config.SWAGGER_UI_ENABLED else False

        # manual separate call on construction and init_app to ensure configs in kwargs effective
        super().__init__(app=None, *args, **kwargs)
        self.init_app(app, **kwargs)
        register_external_error_handlers(self)
