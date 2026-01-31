import asyncio
import inspect
import json
import logging
import time

import werkzeug.http
from quart import g, has_request_context, request

from configs import dify_config
from core.helper.trace_id_helper import get_trace_id_from_otel_context
from dify_app import DifyApp

logger = logging.getLogger(__name__)


def _is_content_type_json(content_type: str) -> bool:
    if not content_type:
        return False
    content_type_no_option, _ = werkzeug.http.parse_options_header(content_type)
    return content_type_no_option.lower() == "application/json"


def _log_request_started() -> None:
    """Log the start of a request."""
    # Record start time for access logging
    g.__request_started_ts = time.perf_counter()

    if not logger.isEnabledFor(logging.DEBUG):
        return

    if not (_is_content_type_json(request.content_type) and request.data):
        logger.debug("Received Request %s -> %s", request.method, request.path)
        return
    try:
        json_data = json.loads(request.data)
    except (TypeError, ValueError):
        logger.exception("Failed to parse JSON request")
        return
    formatted_json = json.dumps(json_data, ensure_ascii=False, indent=2)
    logger.debug(
        "Received Request %s -> %s, Request Body:\n%s",
        request.method,
        request.path,
        formatted_json,
    )


def _log_request_finished(response) -> None:
    """Log the end of a request.

    Safe to call with or without an active Quart request context.
    """
    if response is None:
        return

    # Always emit a compact access line at INFO with trace_id so it can be grepped
    has_ctx = has_request_context()
    start_ts = getattr(g, "__request_started_ts", None) if has_ctx else None
    duration_ms = None
    if start_ts is not None:
        duration_ms = round((time.perf_counter() - start_ts) * 1000, 3)

    # Request attributes are available only when a request context exists
    if has_ctx:
        req_method = request.method
        req_path = request.path
    else:
        req_method = "-"
        req_path = "-"

    trace_id = get_trace_id_from_otel_context() or response.headers.get("X-Trace-Id") or ""
    logger.info(
        "%s %s %s %s %s",
        req_method,
        req_path,
        getattr(response, "status_code", "-"),
        duration_ms if duration_ms is not None else "-",
        trace_id,
    )

    if not logger.isEnabledFor(logging.DEBUG):
        return

    if not _is_content_type_json(response.content_type):
        logger.debug("Response %s %s", response.status, response.content_type)
        return

    response_data = response.get_data(as_text=True)
    if inspect.isawaitable(response_data):
        try:
            asyncio.get_running_loop()
        except RuntimeError:
            response_data = asyncio.run(response_data)
    try:
        json_data = json.loads(response_data)
    except (TypeError, ValueError):
        logger.exception("Failed to parse JSON response")
        return
    formatted_json = json.dumps(json_data, ensure_ascii=False, indent=2)
    logger.debug(
        "Response %s %s, Response Body:\n%s",
        response.status,
        response.content_type,
        formatted_json,
    )


def init_app(app: DifyApp):
    """Initialize the request logging extension."""
    if not dify_config.ENABLE_REQUEST_LOGGING:
        return
    app.before_request(_log_request_started)

    def _after_request(response):  # pyright: ignore[reportUnusedFunction]
        _log_request_finished(response)
        return response

    app.after_request(_after_request)
