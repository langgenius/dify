from __future__ import annotations

import abc
import datetime
from typing import Protocol


class _NowFunction(Protocol):
    @abc.abstractmethod
    def __call__(self, tz: datetime.timezone | None) -> datetime.datetime:
        """Return the current time for the requested timezone."""
        ...


_now_func: _NowFunction = datetime.datetime.now


def naive_utc_now() -> datetime.datetime:
    """Return the current UTC time as a naive datetime."""
    return _now_func(datetime.UTC).replace(tzinfo=None)
