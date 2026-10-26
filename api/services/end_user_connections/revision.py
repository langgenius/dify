"""Opaque connection contracts pin publication and installed plugin artifacts."""

import hashlib
import json
from collections.abc import Iterable, Mapping
from typing import Annotated, Any, Protocol
from uuid import UUID

from pydantic import Field

ConnectionRevision = Annotated[
    str,
    Field(pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{64}$"),
]


def connection_revision(workflow_id: str, plugin_unique_identifiers: Iterable[str]) -> str:
    payload = json.dumps([workflow_id, sorted(set(plugin_unique_identifiers))], separators=(",", ":"))
    return f"{workflow_id}:{hashlib.sha256(payload.encode()).hexdigest()}"


def revision_workflow_id(revision: str) -> UUID:
    """The embedded ID is a reference; publication and plugin checks remain mandatory."""
    return UUID(revision.split(":", 1)[0])


class ConnectionRevisions(Protocol):
    def resolve(self, tenant_id: str, workflow_id: str, graph: Mapping[str, Any]) -> str: ...
