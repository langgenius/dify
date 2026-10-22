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
from typing import Any, Literal

from pydantic import BaseModel

from controllers.openapi.auth.requirements import Requirement
from enums import DeploymentEdition

type AdmissionContext = Literal["orm", "workspace", "app"]


class Kind(StrEnum):
    """Response body kinds. Frozen protocol names; the CLI has one handler per value."""

    OBJECT = "object"
    LIST = "list"
    SSE = "sse"
    TEXT = "text"
    FILE = "file"


class Effect(StrEnum):
    """What running an op does to the server. Frozen protocol names, published in the catalog.

    Each member owns the HTTP methods that imply it; an op overrides that default
    through `endpoint(effect=...)` when its method understates what it does.
    """

    methods: frozenset[str]

    READ = ("read", frozenset({"GET"}))
    WRITE = ("write", frozenset({"POST", "PUT", "PATCH"}))
    DESTRUCTIVE = ("destructive", frozenset({"DELETE"}))

    def __new__(cls, value: str, methods: frozenset[str]) -> Effect:
        obj = str.__new__(cls, value)
        obj._value_ = value
        obj.methods = methods
        return obj

    @classmethod
    def for_method(cls, method: str) -> Effect:
        for effect in cls:
            if method.upper() in effect.methods:
                return effect
        raise ValueError(f"no effect for HTTP method {method!r}")


@dataclass(frozen=True, slots=True, kw_only=True)
class Example:
    """One complete input for an op, shown by the CLI next to the schema."""

    title: str
    input: Mapping[str, Any]


@dataclass(frozen=True, slots=True, kw_only=True)
class CatalogMeta:
    """What the catalog (`_catalog.py`) says about a route; the router never reads it.

    `internal` hides the op from the CLI's default listing; `deprecated` marks it
    as kept for compatibility only. `effect` overrides the effect the op's HTTP
    method implies; leave it unset when the method already says it. `examples`
    ride into the catalog as complete inputs; a catalog test checks each one against
    the op's input schema.
    """

    op: str
    kind: Kind
    summary: str
    query: type[BaseModel] | None = None
    body: type[BaseModel] | None = None
    internal: bool = False
    deprecated: bool = False
    effect: Effect | None = None
    examples: tuple[Example, ...] = ()


@dataclass(frozen=True, slots=True, kw_only=True)
class EndpointSpec:
    """`edition` is the endpoint-level gate — a 404 raised before any bearer
    is read, because the route is not exposed on this edition at all. It is
    not `ExternalSsoPipeline`'s own gate, which 403s a token kind after
    authentication.

    `context` selects the handler's `ctx` argument and admission Session lifetime.
    `"orm"` keeps the Session open for the handler; all other values commit and
    close it before the handler runs. `None` omits the `ctx` argument; admission
    requirements still run for every endpoint.
    """

    requirements: tuple[Requirement, ...]
    catalog: CatalogMeta
    edition: frozenset[DeploymentEdition] | None = None
    context: AdmissionContext | None = "orm"

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
