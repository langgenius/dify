"""Discover installed trace providers through ``dify.trace_providers`` entry points.

Neither an unknown nor an uninstalled provider ever raises into a business
request: callers translate both errors.
"""

import functools
from importlib.metadata import EntryPoint, entry_points
from typing import Any, override

from dify_trace_sdk.provider import TraceProvider

from services.tracing.errors import TraceProviderUnavailableError, UnknownTraceProviderError
from services.tracing.providers import SUPPORTED_PROVIDERS, TraceProviderCatalog

ENTRY_POINT_GROUP = "dify.trace_providers"


@functools.cache
def _entry_points() -> dict[str, EntryPoint]:
    return {entry_point.name: entry_point for entry_point in entry_points(group=ENTRY_POINT_GROUP)}


@functools.cache
def _load(provider_id: str) -> type[TraceProvider[Any]]:
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


class EntryPointTraceProviderCatalog(TraceProviderCatalog):
    """Installed packages are fixed for the process, so each provider is loaded once."""

    @override
    def resolve(self, provider_id: str) -> type[TraceProvider[Any]]:
        if provider_id not in SUPPORTED_PROVIDERS:
            raise UnknownTraceProviderError(provider_id)
        return _load(provider_id)
