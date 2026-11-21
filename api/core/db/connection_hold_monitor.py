"""Report pooled database connections that stay checked out.

Code that keeps a connection while it waits on a model, a vector store or another thread works at
low concurrency and stalls every request in the process once the pool is empty. The pool's own
timeout error names the request that could not get a connection, never the ones holding them.
This monitor records where each connection was checked out and logs the holders.
"""

import inspect
import logging
import threading
import time
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from types import FrameType

from sqlalchemy import event
from sqlalchemy.pool import Pool

logger = logging.getLogger(__name__)

_APPLICATION_ROOT = Path(__file__).resolve().parents[2]
_THIS_FILE = str(Path(__file__).resolve())
_REPORTED_HOLDER_SITES = 5


@dataclass(frozen=True, slots=True)
class ConnectionHold:
    """One connection that is currently checked out of the pool."""

    site: str
    """The innermost application frame at checkout, as ``path:line in function``."""

    caller: str | None
    """The application frame that called ``site``, when there is one."""

    since: float
    """Clock reading at checkout."""


def _application_frames(frame: FrameType | None, limit: int) -> list[str]:
    """Return up to ``limit`` application frames, innermost first, skipping libraries and this module."""
    root = str(_APPLICATION_ROOT)
    found: list[str] = []
    while frame is not None and len(found) < limit:
        filename = frame.f_code.co_filename
        if filename.startswith(root) and filename != _THIS_FILE and "site-packages" not in filename:
            relative = filename[len(root) + 1 :]
            found.append(f"{relative}:{frame.f_lineno} in {frame.f_code.co_name}")
        frame = frame.f_back
    return found


class ConnectionHoldMonitor:
    """Track checked-out connections of one pool and log the ones that are held.

    Two reports, both warnings:

    - on check-in, a connection that was out for at least ``warn_after_seconds``;
    - on check-out, the holders of every connection once ``capacity`` connections are out.

    Each report is limited to one per ``report_interval_seconds`` (per checkout site for the first,
    for the pool for the second); the next one says how many were left out.
    Postcondition of ``install``: every connection checked out of ``pool`` afterwards is counted in
    ``holds()`` until it is checked in or detached.
    """

    def __init__(
        self,
        *,
        warn_after_seconds: float,
        capacity: int | None = None,
        report_interval_seconds: float = 10.0,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._warn_after_seconds = warn_after_seconds
        self._capacity = capacity
        self._report_interval_seconds = report_interval_seconds
        self._clock = clock
        self._lock = threading.Lock()
        self._holds: dict[int, ConnectionHold] = {}
        self._last_hold_report: dict[str, float] = {}
        self._suppressed_hold_reports: Counter[str] = Counter()
        self._last_saturation_report: float | None = None
        self._suppressed_saturation_reports = 0

    def install(self, pool: Pool) -> None:
        event.listen(pool, "checkout", self._on_checkout)
        event.listen(pool, "checkin", self._on_checkin)
        event.listen(pool, "detach", self._on_checkin)

    def holds(self) -> list[ConnectionHold]:
        """Connections that are checked out right now, oldest first."""
        with self._lock:
            return sorted(self._holds.values(), key=lambda hold: hold.since)

    def describe_holders(self) -> str:
        """Group the current holders by checkout site: count, site, and how long the oldest has been out."""
        now = self._clock()
        holds = self.holds()
        counts = Counter(hold.site for hold in holds)
        oldest: dict[str, ConnectionHold] = {}
        for hold in holds:
            oldest.setdefault(hold.site, hold)
        parts = []
        for site, count in counts.most_common(_REPORTED_HOLDER_SITES):
            hold = oldest[site]
            called_from = f", called from {hold.caller}" if hold.caller else ""
            parts.append(f"{count} x {site}{called_from} (oldest {now - hold.since:.1f} s)")
        others = len(counts) - _REPORTED_HOLDER_SITES
        if others > 0:
            parts.append(f"{others} other site{'s' if others > 1 else ''}")
        return "; ".join(parts) or "none"

    def _on_checkout(self, dbapi_connection: object, connection_record: object, connection_proxy: object) -> None:
        frames = _application_frames(inspect.currentframe(), 2)
        hold = ConnectionHold(
            site=frames[0] if frames else "outside the application",
            caller=frames[1] if len(frames) > 1 else None,
            since=self._clock(),
        )
        with self._lock:
            self._holds[id(connection_record)] = hold
            checked_out = len(self._holds)
            suppressed = self._take_saturation_report(hold.since)
        if suppressed is not None:
            logger.warning(
                "Database connection pool is fully checked out (%d of %d), %d earlier reports left out. Holders: %s",
                checked_out,
                self._capacity,
                suppressed,
                self.describe_holders(),
            )

    def _take_saturation_report(self, now: float) -> int | None:
        """Return the number of suppressed reports when a saturation report is due, else ``None``."""
        if self._capacity is None or len(self._holds) < self._capacity:
            return None
        last = self._last_saturation_report
        if last is not None and now - last < self._report_interval_seconds:
            self._suppressed_saturation_reports += 1
            return None
        self._last_saturation_report = now
        suppressed, self._suppressed_saturation_reports = self._suppressed_saturation_reports, 0
        return suppressed

    def _on_checkin(self, dbapi_connection: object, connection_record: object) -> None:
        now = self._clock()
        with self._lock:
            hold = self._holds.pop(id(connection_record), None)
            if hold is None or now - hold.since < self._warn_after_seconds:
                return
            last = self._last_hold_report.get(hold.site)
            if last is not None and now - last < self._report_interval_seconds:
                self._suppressed_hold_reports[hold.site] += 1
                return
            self._last_hold_report[hold.site] = now
            suppressed = self._suppressed_hold_reports.pop(hold.site, 0)
        logger.warning(
            "Database connection held for %.1f s (limit %.1f s), checked out at %s%s, %d similar reports left out",
            now - hold.since,
            self._warn_after_seconds,
            hold.site,
            f", called from {hold.caller}" if hold.caller else "",
            suppressed,
        )
