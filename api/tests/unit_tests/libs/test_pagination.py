import math
from collections.abc import Iterator

import pytest
from sqlalchemy import Integer, Select, create_engine, event, select
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import DeclarativeBase, Mapped, ORMExecuteState, Session, mapped_column

from libs.pagination import PaginatedResult, clamp_pagination, paginate_query


class _PaginationTestBase(DeclarativeBase):
    pass


class _CountTestRow(_PaginationTestBase):
    __tablename__ = "_count_order_by_test"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)


@pytest.fixture
def pagination_session() -> Iterator[tuple[Session, list[str]]]:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    statements: list[str] = []
    try:
        _PaginationTestBase.metadata.create_all(engine)
        with Session(engine) as session:
            session.add_all(_CountTestRow(id=row_id) for row_id in range(1, 6))
            session.commit()

            @event.listens_for(session, "do_orm_execute")
            def capture_statement(state: ORMExecuteState) -> None:
                statement = state.statement
                assert isinstance(statement, Select)
                statements.append(str(statement.compile(dialect=postgresql.dialect())).upper())

            yield session, statements
    finally:
        engine.dispose()


class TestPaginatedResultPages:
    def test_pages_is_zero_for_empty_result(self) -> None:
        # Parity with Flask-SQLAlchemy's Pagination.pages, which PaginatedResult
        # was introduced to replace as a drop-in (#38280): an empty result set
        # has zero pages, not one.
        result = PaginatedResult(items=list[object](), total=0, page=1, per_page=20)
        assert result.pages == 0

    def test_has_next_is_false_for_empty_result(self) -> None:
        result = PaginatedResult(items=list[object](), total=0, page=1, per_page=20)
        assert result.has_next is False

    @pytest.mark.parametrize(
        ("total", "per_page", "expected_pages"),
        [
            (1, 20, 1),
            (20, 20, 1),
            (21, 20, 2),
            (40, 20, 2),
            (41, 20, 3),
        ],
    )
    def test_pages_for_non_empty_result(self, total: int, per_page: int, expected_pages: int) -> None:
        result = PaginatedResult(items=[object()], total=total, page=1, per_page=per_page)
        assert result.pages == expected_pages == math.ceil(total / per_page)

    def test_pages_is_zero_when_per_page_is_zero(self) -> None:
        result = PaginatedResult(items=list[object](), total=0, page=1, per_page=0)
        assert result.pages == 0


class TestPaginatedResultHasNext:
    def test_has_next_true_when_more_pages_remain(self) -> None:
        result = PaginatedResult(items=[object()], total=41, page=1, per_page=20)
        assert result.has_next is True

    def test_has_next_false_on_last_page(self) -> None:
        result = PaginatedResult(items=[object()], total=41, page=3, per_page=20)
        assert result.has_next is False


def test_paginated_result_is_iterable() -> None:
    items = [1, 2, 3]
    result = PaginatedResult(items=items, total=3, page=1, per_page=20)
    assert list(result) == items


class TestClampPagination:
    """The numbers a caller reports `has_more` with must be the ones the query ran with.

    `paginate_query` floors both at 1. A caller that kept the requested values instead
    could report a page size the query never used, and `page * per_page < total` is then
    true for every page, which is a pager with no end (#41876).
    """

    @pytest.mark.parametrize("per_page", [0, -1, -100])
    def test_per_page_below_one_is_floored(self, per_page: int) -> None:
        assert clamp_pagination(1, per_page) == (1, 1)

    @pytest.mark.parametrize("page", [0, -1, -100])
    def test_page_below_one_is_floored(self, page: int) -> None:
        assert clamp_pagination(page, 20) == (1, 20)

    def test_max_per_page_caps_before_the_floor(self) -> None:
        assert clamp_pagination(3, 500, 100) == (3, 100)

    def test_the_floor_wins_over_a_cap_below_one(self) -> None:
        """whatever the cap says, a page size of zero is the input that breaks the caller."""
        assert clamp_pagination(1, 20, 0) == (1, 1)

    def test_no_cap_leaves_a_large_per_page_alone(self) -> None:
        assert clamp_pagination(3, 500) == (3, 500)

    def test_valid_values_pass_through(self) -> None:
        assert clamp_pagination(2, 20, 100) == (2, 20)

    def test_a_full_last_page_is_still_the_last_page(self) -> None:
        """The other guess this replaces: `len(items) == per_page`.

        Forty rows at twenty per page means page two is exactly full and also last.
        Reading fullness as evidence of a next page costs the caller a round trip that
        comes back empty.
        """
        page, size = clamp_pagination(2, 20, 100)
        result = PaginatedResult(items=[object()] * size, total=40, page=page, per_page=size)
        assert len(result.items) == size
        assert (page * size < 40) is result.has_next is False

    @pytest.mark.parametrize("per_page", [0, -1])
    def test_clamped_values_agree_with_has_next(self, per_page: int) -> None:
        """What the helper returns has to make the caller's arithmetic match the truth."""
        total = 7
        page, size = clamp_pagination(total, per_page, 100)
        result = PaginatedResult(items=[object()], total=total, page=page, per_page=size)
        assert (page * size < total) is result.has_next is False


class TestPaginateQueryCount:
    """The count subquery must not carry the statement's ORDER BY.

    A retained ORDER BY forces PostgreSQL to sort the entire match set inside
    COUNT(*) — on large tables that saturates read IOPS for a value the
    ordering cannot change (#45734).
    """

    def test_count_strips_order_by_from_the_wrapped_statement(
        self, pagination_session: tuple[Session, list[str]]
    ) -> None:
        session, statements = pagination_session
        stmt = select(_CountTestRow).where(_CountTestRow.id > 2).order_by(_CountTestRow.id.desc())
        result = paginate_query(stmt, session=session, page=1, per_page=2)

        count_sql, _ = statements
        assert "ORDER BY" not in count_sql
        assert result.total == 3

    def test_count_preserves_caller_limit_and_offset(self, pagination_session: tuple[Session, list[str]]) -> None:
        session, statements = pagination_session
        stmt = select(_CountTestRow).order_by(_CountTestRow.id.desc()).limit(4).offset(2)
        result = paginate_query(stmt, session=session, page=1, per_page=10)

        count_sql, _ = statements
        assert "LIMIT" in count_sql
        assert "OFFSET" in count_sql
        assert result.total == 3

    def test_page_query_retains_order_by(self, pagination_session: tuple[Session, list[str]]) -> None:
        session, statements = pagination_session
        stmt = select(_CountTestRow).order_by(_CountTestRow.id.desc())
        result = paginate_query(stmt, session=session, page=2, per_page=2)

        _, page_sql = statements
        assert "ORDER BY" in page_sql
        assert [row.id for row in result.items] == [3, 2]
