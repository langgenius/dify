from collections.abc import Iterator
from datetime import datetime

import pytest

from services.retrieval_tuning.feedback_volume import (
    AppFeedbackCounts,
    AppFeedbackCountsPage,
    AppFeedbackVolumeRecord,
    FeedbackVolumeService,
    InvalidReportPageSizeError,
    InvalidReportWindowError,
)

_SINCE = datetime(2026, 8, 1)
_UNTIL = datetime(2026, 10, 1)


class _PagedQuery:
    """In-memory port implementation that records its calls and serves pages by keyset cursor."""

    def __init__(self, pages: dict[str | None, AppFeedbackCountsPage]) -> None:
        self.pages = pages
        self.calls: list[tuple[datetime, datetime, str | None, str | None, int]] = []

    def get_feedback_counts_page(
        self, *, since: datetime, until: datetime, tenant_id: str | None, after_app_id: str | None, limit: int
    ) -> AppFeedbackCountsPage:
        self.calls.append((since, until, tenant_id, after_app_id, limit))
        return self.pages[after_app_id]


def _counts(
    app_id: str, *, likes: int = 0, dislikes: int = 0, linked: int = 0, messages: int = 10
) -> AppFeedbackCounts:
    return AppFeedbackCounts(
        tenant_id="tenant",
        app_id=app_id,
        messages=messages,
        user_likes=likes,
        user_dislikes=dislikes,
        user_rated_with_workflow_run=linked,
        admin_likes=0,
        admin_dislikes=0,
    )


def _report(query: _PagedQuery) -> Iterator[AppFeedbackVolumeRecord]:
    return FeedbackVolumeService(query=query).report(since=_SINCE, until=_UNTIL, tenant_id=None, page_size=2)


def test_report_derives_rates_from_counts() -> None:
    query = _PagedQuery(
        {None: AppFeedbackCountsPage(records=[_counts("a", likes=3, dislikes=1, linked=2)], next_after_app_id=None)}
    )

    assert list(_report(query)) == [
        AppFeedbackVolumeRecord(
            tenant_id="tenant",
            app_id="a",
            messages=10,
            user_likes=3,
            user_dislikes=1,
            user_rating_rate=0.4,
            user_rated_workflow_run_share=0.5,
            admin_likes=0,
            admin_dislikes=0,
        )
    ]


def test_report_leaves_run_share_undefined_without_user_ratings() -> None:
    query = _PagedQuery({None: AppFeedbackCountsPage(records=[_counts("a")], next_after_app_id=None)})

    record = next(_report(query))

    assert record.user_rating_rate == 0
    assert record.user_rated_workflow_run_share is None


def test_report_continues_past_empty_pages_until_the_scan_completes() -> None:
    query = _PagedQuery(
        {
            None: AppFeedbackCountsPage(records=[], next_after_app_id="b"),
            "b": AppFeedbackCountsPage(records=[_counts("c")], next_after_app_id=None),
        }
    )

    assert [record.app_id for record in _report(query)] == ["c"]
    assert query.calls == [(_SINCE, _UNTIL, None, None, 2), (_SINCE, _UNTIL, None, "b", 2)]


@pytest.mark.parametrize("until", [_SINCE, datetime(2026, 7, 1)])
def test_report_rejects_an_empty_or_reversed_window_before_querying(until: datetime) -> None:
    query = _PagedQuery({})

    with pytest.raises(InvalidReportWindowError):
        FeedbackVolumeService(query=query).report(since=_SINCE, until=until, tenant_id=None, page_size=2)

    assert query.calls == []


def test_report_rejects_a_non_positive_page_size_before_querying() -> None:
    query = _PagedQuery({})

    with pytest.raises(InvalidReportPageSizeError):
        FeedbackVolumeService(query=query).report(since=_SINCE, until=_UNTIL, tenant_id=None, page_size=0)

    assert query.calls == []
