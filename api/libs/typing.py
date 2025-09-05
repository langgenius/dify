"""Type guards and typing utilities for the Dify application."""

from typing import TYPE_CHECKING, Any, TypeGuard

if TYPE_CHECKING:
    from sqlalchemy import Index, PrimaryKeyConstraint


def is_table_args_tuple(value: Any) -> TypeGuard[tuple["PrimaryKeyConstraint", "Index", ...]]:
    """Type guard for checking if a value is a valid __table_args__ tuple."""
    from sqlalchemy import Index, PrimaryKeyConstraint

    if not isinstance(value, tuple):
        return False

    if len(value) < 2:
        return False

    # Check first element is PrimaryKeyConstraint
    if not isinstance(value[0], PrimaryKeyConstraint):
        return False

    # Check remaining elements are Index objects
    return all(isinstance(item, Index) for item in value[1:])
