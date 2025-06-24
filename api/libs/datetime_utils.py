import abc
import datetime
from typing import Protocol


class _NowFunction(Protocol):
    @abc.abstractmethod
    def __call__(self, tz: datetime.timezone | None) -> datetime.datetime:
        pass


# _now_func is a callable with the _NowFunction signature.
# Its sole purpose is to abstract time retrieval, enabling
# developers to mock this behavior in tests and time-dependent scenarios.
_now_func: _NowFunction = datetime.datetime.now


def naive_utc_now() -> datetime.datetime:
    """Return a naive datetime object (without timezone information)
    representing current UTC time.
    """
    return _now_func(datetime.UTC).replace(tzinfo=None)
