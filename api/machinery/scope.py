"""Identifier scopes that admission grants pass into application services.

An ``IdScope`` is either ``UNRESTRICTED`` (the grant adds no restriction to that
domain) or a ``frozenset`` of permitted IDs, where an empty set denies every
object. The marker is a distinct value so "no restriction" can never be confused
with an absent or forgotten value.
"""

from enum import Enum
from typing import Final, Literal


class Unrestricted(Enum):
    """Single-member marker type for a domain a grant leaves unrestricted."""

    UNRESTRICTED = "unrestricted"


UNRESTRICTED: Final = Unrestricted.UNRESTRICTED

type IdScope = frozenset[str] | Literal[Unrestricted.UNRESTRICTED]


def scope_admits(scope: IdScope, object_id: str) -> bool:
    """Return whether ``scope`` permits ``object_id`` (narrowing the grant only, never widening permissions)."""
    return scope is UNRESTRICTED or object_id in scope
