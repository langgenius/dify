import re
from collections.abc import Mapping
from typing import Any, Protocol, override

from flask import Blueprint, Flask, current_app, got_request_exception, request
from flask_restx import Api
from werkzeug.exceptions import HTTPException
from werkzeug.http import HTTP_STATUS_CODES

from configs import dify_config
from core.errors.error import AppInvokeQuotaExceededError
from libs.flask_restx_compat import patch_swagger_for_inline_nested_dicts
from libs.token import build_force_logout_cookie_headers


def http_status_message(code):
    return HTTP_STATUS_CODES.get(code, "")


class ErrorBodyFormatter(Protocol):
    """Last-touch hook over an error body before it goes on the wire."""

    def finalize(self, e: Exception, data: dict[str, Any], status_code: int) -> dict[str, Any]: ...


def register_external_error_handlers(api: Api, body_formatter: ErrorBodyFormatter | None = None):
    def _finalize(e: Exception, data: dict[str, Any], status_code: int) -> dict[str, Any]:
        if body_formatter is None:
            return data
        return body_formatter.finalize(e, data, status_code)

    def handle_http_exception(e: HTTPException):
        got_request_exception.send(current_app, exception=e)

        # If Werkzeug already prepared a Response, just use it. This bypasses
        # body_formatter entirely — surfaces with a formatter must not raise
        # exceptions carrying a pre-built response.
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
            return _finalize(e, data, status_code), status_code, headers
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
            return _finalize(e, data, status_code), status_code, headers
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
            return _finalize(e, data, status_code), status_code, headers

    def handle_value_error(e: ValueError):
        got_request_exception.send(current_app, exception=e)
        current_app.logger.exception("value_error in request handler")
        status_code = 400
        data = {"code": "invalid_param", "message": str(e), "status": status_code}
        return _finalize(e, data, status_code), status_code

    def handle_quota_exceeded(e: AppInvokeQuotaExceededError):
        got_request_exception.send(current_app, exception=e)
        status_code = 429
        data = {"code": "too_many_requests", "message": str(e), "status": status_code}
        return _finalize(e, data, status_code), status_code

    def handle_general_exception(e: Exception):
        got_request_exception.send(current_app, exception=e)

        status_code = 500
        data: dict[str, Any] = getattr(e, "data", {"message": http_status_message(status_code)})

        # 🔒 Normalize non-mapping data (e.g., if someone set e.data = Response)
        if not isinstance(data, dict):
            data = {"message": str(e)}

        data.setdefault("code", "unknown")
        data.setdefault("status", status_code)

        # Note: Exception logging is handled by Flask/Flask-RESTX framework automatically
        # Explicit log_exception call removed to avoid duplicate log entries

        return _finalize(e, data, status_code), status_code

    api.errorhandler(HTTPException)(handle_http_exception)
    api.errorhandler(ValueError)(handle_value_error)
    api.errorhandler(AppInvokeQuotaExceededError)(handle_quota_exceeded)
    api.errorhandler(Exception)(handle_general_exception)


class ExternalApi(Api):
    _authorizations = {
        "Bearer": {
            "type": "apiKey",
            "in": "header",
            "name": "Authorization",
            "description": "Type: Bearer {your-api-key}",
        }
    }

    def __init__(self, app: Blueprint | Flask, *args, error_body_formatter: ErrorBodyFormatter | None = None, **kwargs):
        self._error_body_formatter = error_body_formatter
        patch_swagger_for_inline_nested_dicts()
        kwargs.setdefault("authorizations", self._authorizations)
        kwargs.setdefault("security", "Bearer")
        kwargs["add_specs"] = dify_config.SWAGGER_UI_ENABLED
        kwargs["doc"] = dify_config.SWAGGER_UI_PATH if dify_config.SWAGGER_UI_ENABLED else False
        if error_body_formatter is not None:
            kwargs.setdefault("catch_all_404s", True)
            # the overrides below patch private flask-restx methods; fail at
            # startup (not at the first 404) if an upgrade removes them
            for private_hook in ("_should_use_fr_error_handler", "_help_on_404"):
                if not callable(getattr(Api, private_hook, None)):
                    raise RuntimeError(f"flask-restx no longer exposes {private_hook}; update ExternalApi overrides")

        # manual separate call on construction and init_app to ensure configs in kwargs effective
        super().__init__(app=None, *args, **kwargs)
        self.init_app(app, **kwargs)
        register_external_error_handlers(self, body_formatter=error_body_formatter)

    @override
    def _should_use_fr_error_handler(self):
        # catch_all_404s makes flask-restx claim NotFound for ANY app path
        # (it wraps the app-level handle_exception), so scope the claim to
        # this blueprint's url prefix; other surfaces keep their own 404s.
        if self._error_body_formatter is not None and not self._request_under_own_prefix():
            return False
        return super()._should_use_fr_error_handler()

    def _request_under_own_prefix(self) -> bool:
        prefix = self.blueprint.url_prefix if self.blueprint is not None else None
        if not prefix:
            return True
        return request.path == prefix or request.path.startswith(prefix.rstrip("/") + "/")

    @override
    def _help_on_404(self, message: str | None = None) -> str | None:
        # flask-restx appends route suggestions post-handler; with a canonical
        # formatter installed, that would corrupt the contract and enumerate
        # routes to unauthenticated callers.
        if self._error_body_formatter is not None:
            return message
        return super()._help_on_404(message)
