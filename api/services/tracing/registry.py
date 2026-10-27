"""Discover installed trace providers through ``dify.trace_providers`` entry points.

Dify supports a fixed set of provider IDs; a distribution may install any
subset of their packages. An unknown ID is a client error, a known but
uninstalled one is a deployment fact. Neither ever raises into a business
request: callers translate both.
"""

import functools
from importlib.metadata import EntryPoint, entry_points
from typing import Any

from dify_trace_sdk.provider import TraceProvider

ENTRY_POINT_GROUP = "dify.trace_providers"

SUPPORTED_PROVIDERS = (
    "langfuse",
    "langsmith",
    "opik",
    "weave",
    "arize",
    "phoenix",
    "aliyun",
    "mlflow",
    "databricks",
    "tencent",
)


class UnknownTraceProviderError(Exception):
    def __init__(self, provider_id: str) -> None:
        super().__init__(f"Unknown tracing provider: {provider_id}")


class TraceProviderUnavailableError(Exception):
    def __init__(self, provider_id: str) -> None:
        super().__init__(f"Tracing provider {provider_id} is not installed in this deployment")


@functools.cache
def _entry_points() -> dict[str, EntryPoint]:
    return {entry_point.name: entry_point for entry_point in entry_points(group=ENTRY_POINT_GROUP)}


@functools.cache
def provider_class(provider_id: str) -> type[TraceProvider[Any]]:
    if provider_id not in SUPPORTED_PROVIDERS:
        raise UnknownTraceProviderError(provider_id)
    entry_point = _entry_points().get(provider_id)
    if entry_point is None:
        raise TraceProviderUnavailableError(provider_id)
    try:
        loaded = entry_point.load()
    except ImportError:
        raise TraceProviderUnavailableError(provider_id) from None
    if not isinstance(loaded, type) or not issubclass(loaded, TraceProvider) or loaded.id != provider_id:
        raise TraceProviderUnavailableError(provider_id)
    return loaded


def installed_providers() -> tuple[str, ...]:
    """Supported providers whose packages load in this deployment, in display order."""
    installed: list[str] = []
    for provider_id in SUPPORTED_PROVIDERS:
        try:
            provider_class(provider_id)
        except TraceProviderUnavailableError:
            continue
        installed.append(provider_id)
    return tuple(installed)
