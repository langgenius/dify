"""Framework-neutral capability of the legacy queued tracing wire boundary."""

from collections.abc import Mapping
from typing import Protocol, runtime_checkable


class LegacyTraceOwnershipUnavailableError(RuntimeError):
    """Ownership is unknown; another provider export is not authorized."""


@runtime_checkable
class LegacyTraceCapturePort(Protocol):
    def capture(self, *, app_id: str, event_id: str, trace_info_type: str | None, info: Mapping[str, object]) -> bool:
        """True claims the record; only explicit False permits legacy delivery."""
        ...

    def emit_enterprise(
        self, *, app_id: str, event_id: str, trace_info_type: str | None, info: Mapping[str, object]
    ) -> None:
        """Validate and emit through the current EE owner; uncertainty raises."""
        ...
