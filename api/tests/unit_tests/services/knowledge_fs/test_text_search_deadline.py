import time
from unittest.mock import patch

import pytest


def test_deadline_caps_legacy_callers_and_uses_monotonic_remaining_time() -> None:
    from services.knowledge_fs.text_search_deadline import TextSearchDeadline, TextSearchTimeoutError

    with (
        patch("services.knowledge_fs.text_search_deadline.time.time", return_value=1_000) as wall,
        patch("services.knowledge_fs.text_search_deadline.time.monotonic", return_value=100) as clock,
    ):
        assert TextSearchDeadline.from_epoch_ms(None).remaining() == 50
        assert TextSearchDeadline.from_epoch_ms(2_000_000).remaining() == 50
        budget = TextSearchDeadline.from_epoch_ms(1_005_000)
        assert budget.remaining() == 5
        wall.return_value = 1
        clock.return_value = 103
        assert budget.remaining() == 2
        clock.return_value = 105
        with pytest.raises(TextSearchTimeoutError):
            budget.remaining()
        with pytest.raises(TextSearchTimeoutError):
            TextSearchDeadline.from_epoch_ms(1)


def test_finished_deadline_does_not_leave_a_timer_on_the_next_request() -> None:
    import gevent

    from services.knowledge_fs.text_search_deadline import TextSearchDeadline

    with TextSearchDeadline.from_epoch_ms(int(time.time() * 1000) + 20).enforce():
        pass
    gevent.sleep(0.04)
