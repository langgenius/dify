"""Canonical type and codec for provider-owned message locators."""

from __future__ import annotations

import base64
import re
from typing import NewType, Self

from pydantic import BaseModel

# Opaque, persistable locator for one exact provider message.
#
# Callers may store, compare, and return this value to a compatible adapter,
# but must not parse, alter, or synthesize it.
#
# The value is a plain, versioned serialization of provider-private locator
# facts. It may cross process boundaries and survive adapter recreation.
# Keep this value within a trusted application boundary; it must not cross
# a security boundary.
# "Opaque" constrains caller behavior; it does not imply encryption, signing,
# cryptographic authenticity, or authorization.
MessageLocator = NewType("MessageLocator", str)

_URLSAFE_BASE64_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")


class _Base64JSONLocatorPayload(BaseModel):
    """Base model giving each private payload one canonical string codec."""

    def encode(self) -> MessageLocator:
        serialized_payload = self.model_dump_json().encode("utf-8")
        encoded_payload = base64.urlsafe_b64encode(serialized_payload).rstrip(b"=").decode("ascii")
        return MessageLocator(encoded_payload)

    @classmethod
    def decode(cls, value: MessageLocator | str) -> Self:
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


__all__ = ["MessageLocator", "_Base64JSONLocatorPayload"]
