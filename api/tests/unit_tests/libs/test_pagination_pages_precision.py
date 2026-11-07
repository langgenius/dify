"""Regression tests: PaginatedResult.pages must use exact integer arithmetic."""

import pytest

from libs.pagination import PaginatedResult

_EMPTY_ITEMS: list[object] = []


class TestPagesExistingContract:
    """Small totals keep the exact ceil(total / per_page) result."""

    @pytest.mark.parametrize(
        ("total", "per_page", "expected_pages"),
        [
            (0, 20, 0),
            (1, 20, 1),
            (20, 20, 1),
            (21, 20, 2),
            (40, 20, 2),
            (41, 20, 3),
            (7, 3, 3),
            (9, 3, 3),
        ],
    )
    def test_pages_for_small_values(self, total: int, per_page: int, expected_pages: int) -> None:
        result = PaginatedResult(items=_EMPTY_ITEMS, total=total, page=1, per_page=per_page)
        assert result.pages == expected_pages

    def test_pages_is_zero_when_per_page_is_zero(self) -> None:
        result = PaginatedResult(items=_EMPTY_ITEMS, total=100, page=1, per_page=0)
        assert result.pages == 0

    def test_has_next_uses_pages(self) -> None:
        assert PaginatedResult(items=_EMPTY_ITEMS, total=41, page=1, per_page=20).has_next is True
        assert PaginatedResult(items=_EMPTY_ITEMS, total=41, page=3, per_page=20).has_next is False


class TestPagesLargeTotals:
    """`pages` must be exact for any integer total.

    `math.ceil(total / per_page)` converts to float first, so totals above
    2**53 can be rounded and report the wrong number of pages.
    """

    @pytest.mark.parametrize(
        ("total", "per_page"),
        [
            (10**18 + 1, 3),
            (2**53 + 1, 2),
            (10**18 + 2, 5),
            (10**19 + 1, 11),
            (10**17 + 1, 6),
            (2**60 + 1, 7),
        ],
    )
    def test_pages_exact_for_large_totals(self, total: int, per_page: int) -> None:
        result = PaginatedResult(items=_EMPTY_ITEMS, total=total, page=1, per_page=per_page)
        expected = (total + per_page - 1) // per_page
        assert result.pages == expected
