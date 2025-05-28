import re
import sys
from typing import Any

from flask import current_app, got_request_exception
from flask_restful import Api, http_status_message
from werkzeug.datastructures import Headers
from werkzeug.exceptions import HTTPException

from core.errors.error import AppInvokeQuotaExceededError


class ExternalApi(Api):
    def handle_error(self, e):
        """Error handler for the API transforms a raised exception into a Flask
        response, with the appropriate HTTP status code and body.

        :param e: the raised Exception object
        :type e: Exception

        """
        got_request_exception.send(current_app, exception=e)

        headers = Headers()
        if isinstance(e, HTTPException):
            if e.response is not None:
                resp = e.get_response()
                return resp

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
        elif isinstance(e, ValueError):
            status_code = 400
            default_data = {
                "code": "invalid_param",
                "message": str(e),
                "status": status_code,
            }
        elif isinstance(e, AppInvokeQuotaExceededError):
            status_code = 429
            default_data = {
                "code": "too_many_requests",
                "message": str(e),
                "status": status_code,
            }
        else:
            status_code = 500
            default_data = {
                "message": http_status_message(status_code),
            }

        # Werkzeug exceptions generate a content-length header which is added
        # to the response in addition to the actual content-length header
        # https://github.com/flask-restful/flask-restful/issues/534
        remove_headers = ("Content-Length",)

        for header in remove_headers:
            headers.pop(header, None)

        data = getattr(e, "data", default_data)

        error_cls_name = type(e).__name__
        if error_cls_name in self.errors:
            custom_data = self.errors.get(error_cls_name, {})
            custom_data = custom_data.copy()
            status_code = custom_data.get("status", 500)

            if "message" in custom_data:
                custom_data["message"] = custom_data["message"].format(
                    message=str(e.description if hasattr(e, "description") else e)
                )
            data.update(custom_data)

        # record the exception in the logs when we have a server error of status code: 500
        if status_code and status_code >= 500:
            exc_info: Any = sys.exc_info()
            if exc_info[1] is None:
                exc_info = None
            current_app.log_exception(exc_info)

        if status_code == 406 and self.default_mediatype is None:
            # if we are handling NotAcceptable (406), make sure that
            # make_response uses a representation we support as the
            # default mediatype (so that make_response doesn't throw
            # another NotAcceptable error).
            supported_mediatypes = list(self.representations.keys())  # only supported application/json
            fallback_mediatype = supported_mediatypes[0] if supported_mediatypes else "text/plain"
            data = {"code": "not_acceptable", "message": data.get("message")}
            resp = self.make_response(data, status_code, headers, fallback_mediatype=fallback_mediatype)
        elif status_code == 400:
            if isinstance(data.get("message"), dict):
                param_key, param_value = list(data.get("message", {}).items())[0]
                data = {"code": "invalid_param", "message": param_value, "params": param_key}
            else:
                if "code" not in data:
                    data["code"] = "unknown"

            resp = self.make_response(data, status_code, headers)
        else:
            if "code" not in data:
                data["code"] = "unknown"

            resp = self.make_response(data, status_code, headers)

        if status_code == 401:
            resp = self.unauthorized(resp)
        return resp
