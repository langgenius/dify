"""Small value objects whose semantics are shared across context boundaries."""

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class EmailAddress:
    """Canonical email identity used for matching and task-scoped email grants.

    The PRD defines equality as lower-casing the complete address and comparing it
    exactly. Protocol adapters remain responsible for full RFC-level validation;
    this value object protects the canonical identity rule inside the domain.
    """

    value: str

    def __post_init__(self) -> None:
        if (
            not self.value
            or "@" not in self.value
            or any(character.isspace() for character in self.value)
        ):
            raise ValueError("email address must be a non-empty canonical address")
        object.__setattr__(self, "value", self.value.lower())

    def __str__(self) -> str:
        return self.value
