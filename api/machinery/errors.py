"""Framework-neutral errors raised by API machinery.

They deliberately do not carry Flask responses, Werkzeug exceptions, HTTP
status codes, or surface-specific wire models.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import ClassVar


@dataclass(frozen=True, slots=True)
class ErrorDetail:
    """Structured, transport-neutral context for one machinery error."""

    type: str
    location: tuple[str | int, ...]
    message: str


class MachineryError(Exception):
    """Base class for failures owned by API machinery.

    ``error_code`` is a stable semantic identifier, not an HTTP status code.
    Transport adapters decide whether and how a concrete error is exposed.
    """

    error_code: ClassVar[str] = "machinery_error"
    default_message: ClassVar[str] = "API machinery operation failed."

    def __init__(self, message: str | None = None, *, details: Sequence[ErrorDetail] = ()) -> None:
        self.message = message or self.default_message
        self.details = tuple(details)
        super().__init__(self.message)


class AdmissionConfigurationError(MachineryError):
    """Raised when an admission declaration contains incompatible requirements."""

    error_code = "invalid_admission_configuration"
    default_message = "Admission configuration is invalid."


class ActiveWorkspaceRequiredError(MachineryError):
    """Raised when an admitted use case requires an active workspace but none was resolved."""

    error_code = "active_workspace_required"
    default_message = "Admission did not resolve an active workspace."
