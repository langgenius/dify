"""Report how much end-user feedback each Chatflow app has for retrieval tuning.

Boundary: a read-only operator report. It never exposes message or feedback text,
only counts and owner identifiers, so its output can leave the database safely.

Invariants:
- Only Chatflow (advanced-chat) apps appear, because retrieval tuning needs messages
  linked to a workflow run.
- Debugger messages never count, because they are not deployed traffic.
- Only messages created inside the half-open window [since, until) count, and their
  feedback counts regardless of when it was given or changed.
- Admin ratings stay separate from end-user ratings. Explore ratings are stored as
  admin, so they are reported but must not be read as end-user signal.
"""

from collections.abc import Iterator, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol


class RetrievalTuningReportError(Exception):
    """Base error for retrieval tuning reports."""


class InvalidReportWindowError(RetrievalTuningReportError):
    """The requested report window is empty or reversed."""


class InvalidReportPageSizeError(RetrievalTuningReportError):
    """The requested report page size is not positive."""


@dataclass(frozen=True, slots=True)
class AppFeedbackCounts:
    """Raw counts for one app; every count covers only in-window, non-debugger messages."""

    tenant_id: str
    app_id: str
    messages: int
    user_likes: int
    user_dislikes: int
    user_rated_with_workflow_run: int
    admin_likes: int
    admin_dislikes: int


@dataclass(frozen=True, slots=True)
class AppFeedbackCountsPage:
    """One page of apps.

    records omits scanned apps with no qualifying messages, so an empty page can
    still have a successor. next_after_app_id is None when the scan is complete.
    """

    records: Sequence[AppFeedbackCounts]
    next_after_app_id: str | None


@dataclass(frozen=True, slots=True)
class AppFeedbackVolumeRecord:
    """One report row.

    user_rating_rate is end-user ratings per message. messages is always positive,
    so the rate is always defined. user_rated_workflow_run_share is the share of
    end-user ratings whose message links to a workflow run; None means the app has
    no end-user ratings.
    """

    tenant_id: str
    app_id: str
    messages: int
    user_likes: int
    user_dislikes: int
    user_rating_rate: float
    user_rated_workflow_run_share: float | None
    admin_likes: int
    admin_dislikes: int


class FeedbackVolumeQuery(Protocol):
    def get_feedback_counts_page(
        self,
        *,
        since: datetime,
        until: datetime,
        tenant_id: str | None,
        after_app_id: str | None,
        limit: int,
    ) -> AppFeedbackCountsPage:
        """Return one page of Chatflow app counts, ordered by app id.

        Owner scope: tenant_id limits the scan to one tenant; None scans every tenant
        and is reserved for operators. Each call runs in one short read session and
        writes nothing. Requires a positive limit and naive UTC since < until. Counts
        are point-in-time per page, so concurrent writes can make pages inconsistent
        with one another, which this report tolerates. A message with both ratings from
        a concurrent feedback race counts once under each rating, because no database
        constraint prevents it. Raises only database errors.
        """
        ...


class FeedbackVolumeService:
    def __init__(self, *, query: FeedbackVolumeQuery) -> None:
        self._query: FeedbackVolumeQuery = query

    def report(
        self,
        *,
        since: datetime,
        until: datetime,
        tenant_id: str | None,
        page_size: int,
    ) -> Iterator[AppFeedbackVolumeRecord]:
        """Stream report rows for apps with qualifying messages, ordered by app id.

        Requires naive UTC since < until and a positive page_size; tenant_id None means
        every tenant. Invalid arguments raise immediately, before any query runs. The
        result is lazy and holds no database session between pages. It has no side
        effects, and a database failure while iterating propagates to the consumer.
        """
        if since >= until:
            raise InvalidReportWindowError(f"Report window start {since} must be before its end {until}")
        if page_size <= 0:
            raise InvalidReportPageSizeError(f"Report page size must be positive, got {page_size}")
        return self._iter_records(since=since, until=until, tenant_id=tenant_id, page_size=page_size)

    def _iter_records(
        self,
        *,
        since: datetime,
        until: datetime,
        tenant_id: str | None,
        page_size: int,
    ) -> Iterator[AppFeedbackVolumeRecord]:
        """Walk the app keyset until the query reports no successor page."""
        after_app_id: str | None = None
        has_more = True
        while has_more:
            page = self._query.get_feedback_counts_page(
                since=since,
                until=until,
                tenant_id=tenant_id,
                after_app_id=after_app_id,
                limit=page_size,
            )
            yield from (_to_volume_record(counts) for counts in page.records)
            after_app_id = page.next_after_app_id
            has_more = after_app_id is not None


def _to_volume_record(counts: AppFeedbackCounts) -> AppFeedbackVolumeRecord:
    """Derive rates from counts; requires counts.messages > 0, which the query guarantees."""
    user_rated = counts.user_likes + counts.user_dislikes
    return AppFeedbackVolumeRecord(
        tenant_id=counts.tenant_id,
        app_id=counts.app_id,
        messages=counts.messages,
        user_likes=counts.user_likes,
        user_dislikes=counts.user_dislikes,
        user_rating_rate=user_rated / counts.messages,
        user_rated_workflow_run_share=counts.user_rated_with_workflow_run / user_rated if user_rated else None,
        admin_likes=counts.admin_likes,
        admin_dislikes=counts.admin_dislikes,
    )
