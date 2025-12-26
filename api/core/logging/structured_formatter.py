"""Structured JSON log formatter for Dify."""

import logging
import traceback
from datetime import UTC, datetime
from typing import Any

import orjson

from configs import dify_config


class StructuredJSONFormatter(logging.Formatter):
    """
    JSON log formatter following the specified schema:
    {
      "ts": "ISO 8601 UTC",
      "severity": "INFO|ERROR|WARN|DEBUG",
      "service": "service name",
      "caller": "file:line",
      "trace_id": "hex 32",
      "span_id": "hex 16",
      "identity": { "tenant_id", "user_id", "user_type" },
      "message": "log message",
      "attributes": { ... },
      "stack_trace": "..."
    }
    """

    SEVERITY_MAP: dict[int, str] = {
        logging.DEBUG: "DEBUG",
        logging.INFO: "INFO",
        logging.WARNING: "WARN",
        logging.ERROR: "ERROR",
        logging.CRITICAL: "ERROR",
    }

    def __init__(self, service_name: str | None = None):
        super().__init__()
        self._service_name = service_name or dify_config.APPLICATION_NAME

    def format(self, record: logging.LogRecord) -> str:
        log_dict = self._build_log_dict(record)
        try:
            return orjson.dumps(log_dict).decode("utf-8")
        except TypeError:
            # Fallback: convert non-serializable objects to string
            import json

            return json.dumps(log_dict, default=str, ensure_ascii=False)

    def _build_log_dict(self, record: logging.LogRecord) -> dict[str, Any]:
        # Core fields
        log_dict: dict[str, Any] = {
            "ts": datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "severity": self.SEVERITY_MAP.get(record.levelno, "INFO"),
            "service": self._service_name,
            "caller": f"{record.filename}:{record.lineno}",
            "message": record.getMessage(),
        }

        # Trace context (from TraceContextFilter)
        trace_id = getattr(record, "trace_id", "")
        span_id = getattr(record, "span_id", "")

        if trace_id:
            log_dict["trace_id"] = trace_id
        if span_id:
            log_dict["span_id"] = span_id

        # Identity context (from IdentityContextFilter)
        identity = self._extract_identity(record)
        if identity:
            log_dict["identity"] = identity

        # Dynamic attributes
        attributes = getattr(record, "attributes", None)
        if attributes:
            log_dict["attributes"] = attributes

        # Stack trace for errors with exceptions
        if record.exc_info and record.levelno >= logging.ERROR:
            log_dict["stack_trace"] = self._format_exception(record.exc_info)

        return log_dict

    def _extract_identity(self, record: logging.LogRecord) -> dict[str, str] | None:
        tenant_id = getattr(record, "tenant_id", None)
        user_id = getattr(record, "user_id", None)
        user_type = getattr(record, "user_type", None)

        if not any([tenant_id, user_id, user_type]):
            return None

        identity: dict[str, str] = {}
        if tenant_id:
            identity["tenant_id"] = tenant_id
        if user_id:
            identity["user_id"] = user_id
        if user_type:
            identity["user_type"] = user_type
        return identity

    def _format_exception(self, exc_info: tuple[Any, ...]) -> str:
        if exc_info and exc_info[0] is not None:
            return "".join(traceback.format_exception(*exc_info))
        return ""
