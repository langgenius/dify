"""Zero-side-effect Agent Stub constants shared across client-safe modules."""

from __future__ import annotations

from typing import Final


AGENT_STUB_DRIVE_BASE_ENV_VAR: Final[str] = "DIFY_AGENT_STUB_DRIVE_BASE"
DEFAULT_AGENT_STUB_DRIVE_BASE: Final[str] = "/mnt/drive"


__all__ = [
    "AGENT_STUB_DRIVE_BASE_ENV_VAR",
    "DEFAULT_AGENT_STUB_DRIVE_BASE",
]
