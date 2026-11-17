"""Make a SQLite engine store datetimes the way MySQL ``DATETIME`` columns do."""

import re
from collections.abc import Generator
from contextlib import contextmanager
from datetime import datetime, timedelta

from sqlalchemy import Engine, event

_SQLITE_DATETIME = re.compile(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}")
_SQLITE_DATETIME_FORMAT = "%Y-%m-%d %H:%M:%S.%f"


def _round_to_second(value: object) -> object:
    if not isinstance(value, str) or _SQLITE_DATETIME.fullmatch(value) is None:
        return value
    rounded = (datetime.strptime(value, _SQLITE_DATETIME_FORMAT) + timedelta(microseconds=500_000)).replace(
        microsecond=0
    )
    return rounded.strftime(_SQLITE_DATETIME_FORMAT)


@contextmanager
def second_precision_datetimes(engine: Engine) -> Generator[None]:
    """Round every datetime bound on ``engine`` to whole seconds, as MySQL does on write.

    SQLite keeps microseconds, which hides code that compares an in-memory
    microsecond timestamp with the value a second-precision column returns.
    """

    def round_parameters(
        _connection: object,
        _cursor: object,
        statement: str,
        parameters: object,
        _context: object,
        executemany: bool,
    ) -> tuple[str, object]:
        if executemany and isinstance(parameters, (list, tuple)):
            return statement, [tuple(_round_to_second(value) for value in row) for row in parameters]
        if isinstance(parameters, (list, tuple)):
            return statement, tuple(_round_to_second(value) for value in parameters)
        return statement, parameters

    event.listen(engine, "before_cursor_execute", round_parameters, retval=True)
    try:
        yield
    finally:
        event.remove(engine, "before_cursor_execute", round_parameters)
