import math

import pytest

from libs.pagination import PaginatedResult


class TestPaginatedResultPages:
    def test_pages_is_zero_for_empty_result(self):
        # Parity with Flask-SQLAlchemy's Pagination.pages, which PaginatedResult
        # was introduced to replace as a drop-in (#38280): an empty result set
        # has zero pages, not one.
        result = PaginatedResult(items=[], total=0, page=1, per_page=20)
        assert result.pages == 0

    def test_has_next_is_false_for_empty_result(self):
        result = PaginatedResult(items=[], total=0, page=1, per_page=20)
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
    def test_pages_for_non_empty_result(self, total, per_page, expected_pages):
        result = PaginatedResult(items=[object()], total=total, page=1, per_page=per_page)
        assert result.pages == expected_pages == math.ceil(total / per_page)

    def test_pages_is_zero_when_per_page_is_zero(self):
        result = PaginatedResult(items=[], total=0, page=1, per_page=0)
        assert result.pages == 0


class TestPaginatedResultHasNext:
    def test_has_next_true_when_more_pages_remain(self):
        result = PaginatedResult(items=[object()], total=41, page=1, per_page=20)
        assert result.has_next is True

    def test_has_next_false_on_last_page(self):
        result = PaginatedResult(items=[object()], total=41, page=3, per_page=20)
        assert result.has_next is False


def test_paginated_result_is_iterable():
    items = [1, 2, 3]
    result = PaginatedResult(items=items, total=3, page=1, per_page=20)
    assert list(result) == items
