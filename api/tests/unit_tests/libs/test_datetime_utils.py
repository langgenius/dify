import datetime

import pytest

from libs.datetime_utils import naive_utc_now


def test_naive_utc_now(monkeypatch: pytest.MonkeyPatch):
    tz_aware_utc_now = datetime.datetime.now(tz=datetime.UTC)

    def _now_func(tz: datetime.timezone | None) -> datetime.datetime:
        return tz_aware_utc_now.astimezone(tz)

    monkeypatch.setattr("libs.datetime_utils._now_func", _now_func)

    naive_datetime = naive_utc_now()

    assert naive_datetime.tzinfo is None
    assert naive_datetime.date() == tz_aware_utc_now.date()
    naive_time = naive_datetime.time()
    utc_time = tz_aware_utc_now.time()
    assert naive_time == utc_time
