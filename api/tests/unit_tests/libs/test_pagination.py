import math

import pytest
from sqlalchemy import Column, Connection, Integer, MetaData, Select, Table, create_engine, event, select
from sqlalchemy.orm import Session

from libs.pagination import PaginatedResult, clamp_pagination, paginate_query


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
        """Whatever the cap says, a page size of zero is the input that breaks the caller."""
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


class TestPaginateQueryCountSQL:
    """paginate_query builds the count from a subquery of the page statement.

    The count's subquery must not carry the statement's ORDER BY: sorting cannot
    change a total, but keeping it forces the database to sort every matching
    wide row before aggregating (issue #45734: multi-minute COUNTs and a
    critical read-IOPS alarm on an 8.5M-conversation table).
    """

    @staticmethod
    def _capture(stmt: Select[tuple[object, ...]]) -> tuple[list[str], PaginatedResult[object]]:
        """Run paginate_query on SQLite and return the SQL it executed."""
        executed: list[str] = []

        def _record_sql(
            conn: Connection,
            cursor: object,
            statement: str,
            parameters: object,
            context: object,
            executemany: bool,
        ) -> None:
            del conn, cursor, parameters, context, executemany
            executed.append(" ".join(statement.split()))

        engine = create_engine("sqlite://")
        metadata = MetaData()
        Table("convos", metadata, Column("id", Integer, primary_key=True), Column("created_at", Integer))
        metadata.create_all(engine)

        event.listen(engine, "before_cursor_execute", _record_sql)
        try:
            with Session(engine) as session:
                result = paginate_query(stmt, session=session, page=1, per_page=5)
        finally:
            event.remove(engine, "before_cursor_execute", _record_sql)
        return executed, result

    def test_count_has_no_order_by_while_page_keeps_it(self) -> None:
        metadata = MetaData()
        table = Table("convos", metadata, Column("id", Integer, primary_key=True), Column("created_at", Integer))

        stmt = select(table).where(table.c.created_at > 10).order_by(table.c.created_at.desc())

        executed, _ = self._capture(stmt)
        count_sql = next(sql for sql in executed if sql.upper().startswith("SELECT COUNT"))
        page_sql = next(sql for sql in executed if sql.upper().startswith("SELECT CONVOS"))

        assert "ORDER BY" not in count_sql.upper(), f"count must not sort: {count_sql}"
        assert "ORDER BY" in page_sql.upper(), f"page must keep its ordering: {page_sql}"

    def test_count_still_counts_all_rows(self) -> None:
        """The order_by(None) rewrite must not change the count semantics."""
        engine = create_engine("sqlite://")
        metadata = MetaData()
        table = Table("convos", metadata, Column("id", Integer, primary_key=True), Column("created_at", Integer))
        metadata.create_all(engine)
        with engine.begin() as conn:
            conn.execute(table.insert().values([{"id": 1, "created_at": 5}, {"id": 2, "created_at": 3}]))

        stmt = select(table).order_by(table.c.created_at.desc())

        with Session(engine) as session:
            result = paginate_query(stmt, session=session, page=1, per_page=1)

        assert result.total == 2
        assert len(result.items) == 1
