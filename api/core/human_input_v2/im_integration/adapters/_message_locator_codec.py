"""Private JSON and URL-safe Base64 codec for Provider-owned message locators."""

from __future__ import annotations

import base64
import re
from typing import Self

from pydantic import BaseModel

_URLSAFE_BASE64_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")


class _Base64JSONLocatorPayload(BaseModel):
    """Base model giving each private payload one canonical string codec."""

    def encode(self) -> str:
        serialized_payload = self.model_dump_json().encode("utf-8")
        return base64.urlsafe_b64encode(serialized_payload).rstrip(b"=").decode("ascii")

    @classmethod
    def decode(cls, value: str) -> Self:
        if not _URLSAFE_BASE64_PATTERN.fullmatch(value):
            raise ValueError("locator must be unpadded URL-safe Base64")
        if len(value) % 4 == 1:
            raise ValueError("locator has invalid Base64 length")
        padding = "=" * (-len(value) % 4)
        serialized_payload = base64.b64decode(
            value + padding,
            altchars=b"-_",
            validate=True,
        )
        return cls.model_validate_json(serialized_payload)


__all__ = ["_Base64JSONLocatorPayload"]
