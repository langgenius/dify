from __future__ import annotations

import sqlalchemy as sa


def tenant_prefix_bounds(prefix: str) -> tuple[str, str | None]:
    prefix_value = int(prefix, 16)
    lower_bound = f"{prefix}0000000-0000-0000-0000-000000000000"
    if prefix_value == 15:
        return lower_bound, None
    upper_bound = f"{prefix_value + 1:x}0000000-0000-0000-0000-000000000000"
    return lower_bound, upper_bound


def tenant_prefix_condition(column, prefix: str):
    lower_bound, upper_bound = tenant_prefix_bounds(prefix)
    condition = column >= lower_bound
    if upper_bound is not None:
        condition = sa.and_(condition, column < upper_bound)
    return condition
