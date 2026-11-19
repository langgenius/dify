"""Deterministic identifiers.

The same Dify record always maps to the same trace and span identifiers, so a
redelivered trace carries the identifiers of its first delivery and separately
sent units (a tool call, its message) join the same tree without coordination.
"""

import hashlib
import re
from uuid import UUID, uuid5

_HEX32 = re.compile(r"[0-9a-f]{32}")


def trace_id_for(logical_id: str) -> str:
    """Return the trace ID for a Dify record ID or caller-supplied trace ID.

    UUIDs and 32-hex values keep their value, so a message ID or a caller's
    ``X-Trace-Id`` stays recognizable in the destination. Other values are hashed.
    """
    candidate = logical_id.replace("-", "").lower()
    if _HEX32.fullmatch(candidate) and int(candidate, 16):
        return candidate
    digest = hashlib.sha256(f"dify-trace:{logical_id}".encode()).hexdigest()[:32]
    return digest if int(digest, 16) else "0" * 31 + "1"


def span_id_for(logical_id: str) -> str:
    """Return the span ID for a Dify record ID (message, workflow run, node execution, ...)."""
    digest = hashlib.sha256(f"dify-application-span:{logical_id}".encode()).hexdigest()[:16]
    return digest if int(digest, 16) else "0" * 15 + "1"


def trace_uuid(trace_id: str) -> UUID:
    """The trace ID as a UUID, for destinations whose identifiers are UUIDs."""
    return UUID(hex=trace_id)


def span_uuid(trace_id: str, span_id: str) -> UUID:
    """A span ID as a UUID that is unique within its trace."""
    return uuid5(trace_uuid(trace_id), span_id)
