from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Generic, TypeVar

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session, scoped_session

T = TypeVar("T")


@dataclass
class PaginatedResult(Generic[T]):
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
        if self.per_page == 0:
            return 0
        return max(1, math.ceil(self.total / self.per_page))

    @property
    def has_next(self) -> bool:
        return self.page < self.pages

    def __iter__(self):
        return iter(self.items)


def paginate_query(
    stmt: Select,
    *,
    page: int = 1,
    per_page: int = 20,
    max_per_page: int | None = None,
    session: Session | scoped_session | None = None,
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
        The session to use.  Falls back to ``db.session`` when omitted.
    """
    if session is None:
        from extensions.ext_database import db

        session = db.session

    if max_per_page is not None:
        per_page = min(per_page, max_per_page)

    page = max(1, page)
    per_page = max(1, per_page)

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
