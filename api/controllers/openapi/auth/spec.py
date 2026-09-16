"""`@endpoint` builds one at decoration time and attaches it as `view.__spec__`;
the router reads nothing else off the view. It lives in `auth/` so the
dependency runs `_contract.py` -> `auth/` and never back.

Catalog fields ride on the same object so a route is described in one place.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from pydantic import BaseModel

from controllers.openapi.auth.requirements import Requirement
from enums import DeploymentEdition


class Kind(StrEnum):
    """Response body kinds. Frozen protocol names; the CLI has one handler per value."""

    OBJECT = "object"
    LIST = "list"
    SSE = "sse"
    TEXT = "text"
    FILE = "file"


@dataclass(frozen=True, slots=True, kw_only=True)
class EndpointSpec:
    """`edition` is the endpoint-level gate — a 404 raised before any bearer
    is read, because the route is not exposed on this edition at all. It is
    not `ExternalSsoPipeline`'s own gate, which 403s a token kind after
    authentication.

    `op`, `kind`, `summary`, `query`, `body`, `internal`, `deprecated` feed the
    catalog (`_catalog.py`); the router does not read them.
    """

    requirements: tuple[Requirement, ...]
    edition: frozenset[DeploymentEdition] | None = None
    op: str
    kind: Kind
    summary: str
    query: type[BaseModel] | None = None
    body: type[BaseModel] | None = None
    internal: bool = False
    deprecated: bool = False
