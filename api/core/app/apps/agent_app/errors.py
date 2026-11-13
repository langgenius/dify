"""Agent App setup failures and traversal of causal runtime diagnostics."""

from collections.abc import Iterator


def iter_error_causes(error: BaseException) -> Iterator[BaseException]:
    """Yield the outer exception followed by its explicit causes, stopping before a cycle."""
    current: BaseException | None = error
    seen: set[int] = set()
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        yield current
        current = current.__cause__


class AgentAppGeneratorError(ValueError):
    """Raised when an Agent App turn cannot be set up."""


class AgentAppNotPublishedError(AgentAppGeneratorError):
    """Raised when a public Agent App runtime is requested before publish."""
