"""Stable canonical bytes for the versioned hosted-credit migration protocol."""

import hashlib
import json
from typing import Any


def canonical_hash(value: Any) -> str:
    """Hash the protocol's constrained canonical JSON (money is never a float)."""

    def check(item: Any) -> None:
        if isinstance(item, float) or item is None:
            raise ValueError("canonical payload cannot contain float or null")
        if isinstance(item, dict):
            for key, child in item.items():
                if not isinstance(key, str) or not key.isascii():
                    raise ValueError("canonical object keys must be ASCII strings")
                check(child)
        elif isinstance(item, list):
            for child in item:
                check(child)

    check(value)
    return (
        "sha256:"
        + hashlib.sha256(
            json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode()
        ).hexdigest()
    )
