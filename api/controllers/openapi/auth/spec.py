"""`@endpoint` builds one at decoration time and attaches it as `view.__spec__`;
the router reads nothing else off the view. It lives in `auth/` so the
dependency runs `_contract.py` -> `auth/` and never back.
"""

from __future__ import annotations

from dataclasses import dataclass

from controllers.openapi.auth.requirements import Requirement
from enums import DeploymentEdition


@dataclass(frozen=True, slots=True)
class EndpointSpec:
    """`edition` is the endpoint-level gate — a 404 raised before any bearer
    is read, because the route is not exposed on this edition at all. It is
    not `EditionCheck`, which 403s a token kind after authentication.

    `write` mirrors `with_session`'s write/read split: true (the default)
    commits the router's session on success and rolls it back on failure;
    false does neither, so a read-only route cannot persist a stray mutation.
    """

    requirements: tuple[Requirement, ...]
    edition: frozenset[DeploymentEdition] | None = None
    write: bool = True

    def __post_init__(self) -> None:
        """Coerce at construction, not at the first request: a list survives
        `__init__` untouched and only fails where `Pipeline.run` concatenates.
        """
        object.__setattr__(self, "requirements", tuple(self.requirements))
