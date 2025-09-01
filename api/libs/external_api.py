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


def http_status_message(code):
    return HTTP_STATUS_CODES.get(code, "")


def register_external_error_handlers(api: Api) -> None:
    @api.errorhandler(HTTPException)
    def handle_http_exception(e: HTTPException):
        got_request_exception.send(current_app, exception=e)

        # If Werkzeug already prepared a Response, just use it.
        if getattr(e, "response", None) is not None:
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
            return data, status_code, headers

    @api.errorhandler(ValueError)
    def handle_value_error(e: ValueError):
        got_request_exception.send(current_app, exception=e)
        status_code = 400
        data = {"code": "invalid_param", "message": str(e), "status": status_code}
        return data, status_code

    @api.errorhandler(AppInvokeQuotaExceededError)
    def handle_quota_exceeded(e: AppInvokeQuotaExceededError):
        got_request_exception.send(current_app, exception=e)
        status_code = 429
        data = {"code": "too_many_requests", "message": str(e), "status": status_code}
        return data, status_code

    @api.errorhandler(Exception)
    def handle_general_request_error(e: Exception):
        # Check if this is an MCPRequestError
        if hasattr(e, "error_code") and hasattr(e, "message"):
            # Import here to avoid circular import
            from controllers.mcp.mcp import MCPRequestError
            from core.mcp import types as mcp_types

            if isinstance(e, MCPRequestError):
                got_request_exception.send(current_app, exception=e)

                # Map MCP error codes to HTTP status codes
                error_code = e.error_code
                if error_code in (mcp_types.INVALID_REQUEST, mcp_types.INVALID_PARAMS):
                    status_code = 400
                elif error_code == mcp_types.METHOD_NOT_FOUND:
                    status_code = 404
                elif error_code == mcp_types.INTERNAL_ERROR:
                    status_code = 500
                elif error_code == mcp_types.PARSE_ERROR:
                    status_code = 400
                else:
                    # Default to 500 for unknown MCP error codes
                    status_code = 500

                data = {
                    "code": "mcp_request_error",
                    "message": e.message,
                    "mcp_error_code": error_code,
                    "status": status_code,
                }
                return data, status_code

        # If not MCPRequestError, continue to general exception handling
        got_request_exception.send(current_app, exception=e)

        status_code = 500
        data: dict[str, Any] = getattr(e, "data", {"message": http_status_message(status_code)})

        # 🔒 Normalize non-mapping data (e.g., if someone set e.data = Response)
        if not isinstance(data, Mapping):
            data = {"message": str(e)}

        data.setdefault("code", "unknown")
        data.setdefault("status", status_code)

        # Log stack
        exc_info: Any = sys.exc_info()
        if exc_info[1] is None:
            exc_info = None
        current_app.log_exception(exc_info)

        return data, status_code


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
        super().__init__(app=None, *args, **kwargs)  # type: ignore
        self.init_app(app, **kwargs)
        register_external_error_handlers(self)
