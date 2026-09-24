from __future__ import annotations

import math
from dataclasses import dataclass

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session


@dataclass
class PaginatedResult[T]:
    """Minimal pagination container backed by plain SQLAlchemy queries.

    Drop-in replacement for Flask-SQLAlchemy's ``db.paginate`` return value.
    Only the attributes actually consumed across the codebase are exposed:
    ``items``, ``total``, ``page``, ``per_page``, ``pages``, ``has_next``.
    """

    items: list[T]
    total: int
    page: int
    per_page: int

    @property
    def pages(self) -> int:
        if self.total == 0 or self.per_page == 0:
            return 0
        return math.ceil(self.total / self.per_page)

    @property
    def has_next(self) -> bool:
        return self.page < self.pages

    def __iter__(self):
        return iter(self.items)


def clamp_pagination(page: int, per_page: int, max_per_page: int | None = None) -> tuple[int, int]:
    """Return the ``(page, per_page)`` a paginated query will actually use.

    Callers that report ``has_more`` next to a page of rows have to derive it
    from the same numbers the query ran with. Computing it from the requested
    values instead lets a request for ``limit=0`` be served one row while the
    response claims a page size of zero, which makes ``page * limit < total``
    true for every page and gives the client a pager that never ends.
    """
    if max_per_page is not None:
        per_page = min(per_page, max_per_page)
    return max(1, page), max(1, per_page)


def paginate_query(
    stmt: Select,
    *,
    session: Session,
    page: int = 1,
    per_page: int = 20,
    max_per_page: int | None = None,
) -> PaginatedResult:
    """Execute *stmt* as a paginated query using plain SQLAlchemy.

    Parameters
    ----------
    stmt:
        A SQLAlchemy ``select()`` statement.
    page:
        1-based page number.
    per_page:
        Number of items per page.
    max_per_page:
        Hard ceiling for *per_page*; ``None`` means no cap.
    session:
        SQLAlchemy session used to execute the count and page queries.
    """
    page, per_page = clamp_pagination(page, per_page, max_per_page)

    # total count — wrap in a scalar subquery so arbitrary selects work
    count_stmt = select(func.count()).select_from(stmt.subquery())
    total: int = session.scalar(count_stmt) or 0  # type: ignore[assignment]

    # fetch the page
    offset = (page - 1) * per_page
    page_stmt = stmt.limit(per_page).offset(offset)
    items = list(session.scalars(page_stmt).all())

    return PaginatedResult(
        items=items,
        total=total,
        page=page,
        per_page=per_page,
    )
