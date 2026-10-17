"""Dispatch a completed application trace without exposing destination credentials.

An accepted export acknowledges ingestion, not query availability. Completed spans
must not be exported again after acceptance; some providers do not deduplicate IDs.
The durable task owner decides whether an uncertain transport outcome is retried.
"""

from collections.abc import Mapping
from dataclasses import dataclass, field
from importlib import import_module
from typing import Any, Literal
from urllib.parse import urlsplit

from core.ops.exceptions import RetryableTraceDispatchError, TraceProviderNotInstalledError
from core.ops.unified_trace.entities import CanonicalTrace


@dataclass(frozen=True)
class TraceExportResult:
    trace_id: str
    trace_url: str | None = None
    span_urls: dict[str, str] = field(default_factory=dict)
    status: Literal["accepted"] = "accepted"


class TraceExportRejectedError(RuntimeError):
    """A terminal export rejection, containing no credential or response body."""


class TraceExportUncertainError(RetryableTraceDispatchError):
    """The transport failed without proving whether ingestion accepted the data."""

    acceptance_unknown = True


def frozen_project_url(provider: str, config: Mapping[str, Any]) -> str | None:
    """Read only persisted destination metadata, without credentials or vendor I/O."""
    # These adapters expose a platform console, not the run's destination project.
    if provider in {"aliyun", "tencent"}:
        return None
    value = config.get("project_url")
    if (
        not isinstance(value, str)
        or not value
        or any(ord(char) <= 32 or ord(char) == 127 for char in value)
        or "\\" in value
    ):
        return None
    try:
        parsed = urlsplit(value)
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
        ):
            return None
        _ = parsed.port
    except ValueError:
        return None
    return value


_MODULES = {
    "langfuse": "dify_trace_langfuse.agent_trace",
    "langsmith": "dify_trace_langsmith.agent_trace",
    "phoenix": "dify_trace_arize_phoenix.agent_trace",
    "arize": "dify_trace_arize_phoenix.agent_trace",
    "opik": "dify_trace_opik.agent_trace",
    "weave": "dify_trace_weave.agent_trace",
    "mlflow": "dify_trace_mlflow.agent_trace",
    "databricks": "dify_trace_mlflow.agent_trace",
    "aliyun": "dify_trace_aliyun.agent_trace",
    "tencent": "dify_trace_tencent.agent_trace",
}


def provider_capabilities(provider: str) -> dict[str, bool | str]:
    """Describe implemented mappings, independently of installation/account tests."""
    if provider not in _MODULES:
        raise ValueError("Unsupported tracing provider")
    return {
        "provider": provider,
        "agent_spans": True,
        "session": True,
        "native_usage": True,
        "native_cost": provider in {"langfuse", "langsmith", "opik", "mlflow", "databricks"},
        "trace_url": provider in {"langfuse", "langsmith", "weave", "mlflow", "databricks"},
        "span_url": provider in {"langfuse", "langsmith", "weave"},
        "export_ack": "accepted",
    }


def export_trace(provider: str, config: Mapping[str, Any], trace: CanonicalTrace) -> TraceExportResult:
    """Export one complete tree to the caller's already-authorized destination."""
    module_name = _MODULES.get(provider)
    if module_name is None:
        raise TraceExportRejectedError("Unsupported tracing provider")
    if trace.external_parent is not None or trace.required_parent_context_id is not None:
        raise TraceExportRejectedError("Application trace export requires a complete resolved tree")
    if any(span.end_time is None for span in trace.spans):
        raise TraceExportRejectedError("Application trace export requires completed spans")
    try:
        module = import_module(module_name)
        return module.export_trace(provider, config, trace)
    except (TraceExportRejectedError, RetryableTraceDispatchError):
        raise
    except ImportError as error:
        raise TraceProviderNotInstalledError(provider, error.name or module_name) from None
    except Exception:
        # Vendor exceptions can contain full requests, headers, and endpoint secrets.
        raise TraceExportRejectedError(f"{provider} trace export failed") from None
