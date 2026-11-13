from __future__ import annotations

from collections.abc import Mapping
from typing import Any


class DslError(Exception):
    """Blocking DSL import error with stable machine-readable context."""

    def __init__(
        self,
        message: str,
        *,
        code: str,
        path: str | None = None,
        kind: str | None = None,
        details: Mapping[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.path = path
        self.kind = kind
        self.details = dict(details or {})
