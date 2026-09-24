"""Framework-neutral data contracts for internal mail delivery."""

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True, slots=True)
class InnerMailMessage:
    recipients: tuple[str, ...]
    subject: str
    body: str
    substitutions: dict[str, Any] | None = None
