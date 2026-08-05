"""Framework-neutral errors raised by API machinery.

They deliberately do not carry Flask responses, Werkzeug exceptions, HTTP
status codes, or surface-specific wire models.
"""

from typing import NamedTuple


class ErrorDetail(NamedTuple):
    type: str
    location: tuple[str | int, ...]
    message: str


class MachineryError(Exception):
    """Base class for failures owned by API machinery."""

    code: str = "machinery_error"
