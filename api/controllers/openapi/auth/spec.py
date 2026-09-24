"""`@endpoint` builds one at decoration time and attaches it as `view.__spec__`;
the router reads nothing else off the view. It lives in `auth/` so the
dependency runs `_contract.py` -> `auth/` and never back.

The catalog's view of the route rides along as `CatalogMeta`, so a route is
still described in one place while each reader has its own object.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum
from typing import Any

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
class Example:
    """One complete input for an op, shown by the CLI next to the schema."""

    title: str
    input: Mapping[str, Any]


@dataclass(frozen=True, slots=True, kw_only=True)
class CatalogMeta:
    """What the catalog (`_catalog.py`) says about a route; the router never reads it.

    `internal` hides the op from the CLI's default listing; `deprecated` marks it
    as kept for compatibility only. `examples` ride into the catalog as complete
    inputs; a catalog test checks each one against the op's input schema.
    """

    op: str
    kind: Kind
    summary: str
    query: type[BaseModel] | None = None
    body: type[BaseModel] | None = None
    internal: bool = False
    deprecated: bool = False
    examples: tuple[Example, ...] = ()


@dataclass(frozen=True, slots=True, kw_only=True)
class EndpointSpec:
    """`edition` is the endpoint-level gate — a 404 raised before any bearer
    is read, because the route is not exposed on this edition at all. It is
    not `ExternalSsoPipeline`'s own gate, which 403s a token kind after
    authentication.
    """

    requirements: tuple[Requirement, ...]
    catalog: CatalogMeta
    edition: frozenset[DeploymentEdition] | None = None
    account_context: bool = False

    def allows(self, edition: DeploymentEdition) -> bool:
        """Whether this deployment exposes the route at all. `edition is None`
        means every edition does. The router turns a `False` into a 404 and the
        catalog leaves the op out, so both read the gate from here.
        """
        return self.edition is None or edition in self.edition


def spec_of(view: Any) -> EndpointSpec | None:
    """The spec `@endpoint` attached to `view`, or None for anything else."""
    spec = view.__spec__ if hasattr(view, "__spec__") else None
    return spec if isinstance(spec, EndpointSpec) else None
