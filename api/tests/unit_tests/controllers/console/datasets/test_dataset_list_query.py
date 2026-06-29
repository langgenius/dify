from __future__ import annotations

import pytest
from pydantic import ValidationError

from controllers.console.datasets.datasets import ConsoleDatasetListQuery


def test_dataset_list_query_defaults() -> None:
    query = ConsoleDatasetListQuery()
    assert query.page == 1
    assert query.limit == 20


def test_dataset_list_query_accepts_valid_pagination() -> None:
    query = ConsoleDatasetListQuery(page=3, limit=50)
    assert query.page == 3
    assert query.limit == 50


def test_dataset_list_query_rejects_non_positive_page() -> None:
    with pytest.raises(ValidationError):
        ConsoleDatasetListQuery(page=0)
    with pytest.raises(ValidationError):
        ConsoleDatasetListQuery(page=-1)


def test_dataset_list_query_rejects_non_positive_limit() -> None:
    with pytest.raises(ValidationError):
        ConsoleDatasetListQuery(limit=0)
    with pytest.raises(ValidationError):
        ConsoleDatasetListQuery(limit=-5)
