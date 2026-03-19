import datetime
import re
from unittest.mock import MagicMock, patch

import click
import pytest

from commands import clean_expired_messages


def _mock_service() -> MagicMock:
    service = MagicMock()
    service.run.return_value = {
        "batches": 1,
        "total_messages": 10,
        "filtered_messages": 5,
        "total_deleted": 5,
    }
    return service


def test_absolute_mode_calls_from_time_range():
    policy = object()
    service = _mock_service()
    start_from = datetime.datetime(2024, 1, 1, 0, 0, 0)
    end_before = datetime.datetime(2024, 2, 1, 0, 0, 0)

    with (
        patch("commands.retention.create_message_clean_policy", return_value=policy),
        patch("commands.retention.MessagesCleanService.from_time_range", return_value=service) as mock_from_time_range,
        patch("commands.retention.MessagesCleanService.from_days") as mock_from_days,
    ):
        clean_expired_messages.callback(
            batch_size=200,
            graceful_period=21,
            start_from=start_from,
            end_before=end_before,
            from_days_ago=None,
            before_days=None,
            dry_run=True,
        )

    mock_from_time_range.assert_called_once_with(
        policy=policy,
        start_from=start_from,
        end_before=end_before,
        batch_size=200,
        dry_run=True,
        task_label="custom",
    )
    mock_from_days.assert_not_called()


def test_relative_mode_before_days_only_calls_from_days():
    policy = object()
    service = _mock_service()

    with (
        patch("commands.retention.create_message_clean_policy", return_value=policy),
        patch("commands.retention.MessagesCleanService.from_days", return_value=service) as mock_from_days,
        patch("commands.retention.MessagesCleanService.from_time_range") as mock_from_time_range,
    ):
        clean_expired_messages.callback(
            batch_size=500,
            graceful_period=14,
            start_from=None,
            end_before=None,
            from_days_ago=None,
            before_days=30,
            dry_run=False,
        )

    mock_from_days.assert_called_once_with(
        policy=policy,
        days=30,
        batch_size=500,
        dry_run=False,
        task_label="before-30",
    )
    mock_from_time_range.assert_not_called()


def test_relative_mode_with_from_days_ago_calls_from_time_range():
    policy = object()
    service = _mock_service()
    fixed_now = datetime.datetime(2024, 8, 20, 12, 0, 0)

    with (
        patch("commands.retention.create_message_clean_policy", return_value=policy),
        patch("commands.retention.MessagesCleanService.from_time_range", return_value=service) as mock_from_time_range,
        patch("commands.retention.MessagesCleanService.from_days") as mock_from_days,
        patch("commands.retention.naive_utc_now", return_value=fixed_now),
    ):
        clean_expired_messages.callback(
            batch_size=1000,
            graceful_period=21,
            start_from=None,
            end_before=None,
            from_days_ago=60,
            before_days=30,
            dry_run=False,
        )

    mock_from_time_range.assert_called_once_with(
        policy=policy,
        start_from=fixed_now - datetime.timedelta(days=60),
        end_before=fixed_now - datetime.timedelta(days=30),
        batch_size=1000,
        dry_run=False,
        task_label="60to30",
    )
    mock_from_days.assert_not_called()


@pytest.mark.parametrize(
    ("kwargs", "message"),
    [
        (
            {
                "start_from": datetime.datetime(2024, 1, 1),
                "end_before": datetime.datetime(2024, 2, 1),
                "from_days_ago": None,
                "before_days": 30,
            },
            "mutually exclusive",
        ),
        (
            {
                "start_from": datetime.datetime(2024, 1, 1),
                "end_before": None,
                "from_days_ago": None,
                "before_days": None,
            },
            "Both --start-from and --end-before are required",
        ),
        (
            {
                "start_from": None,
                "end_before": None,
                "from_days_ago": 10,
                "before_days": None,
            },
            "--from-days-ago must be used together with --before-days",
        ),
        (
            {
                "start_from": None,
                "end_before": None,
                "from_days_ago": None,
                "before_days": -1,
            },
            "--before-days must be >= 0",
        ),
        (
            {
                "start_from": None,
                "end_before": None,
                "from_days_ago": 30,
                "before_days": 30,
            },
            "--from-days-ago must be greater than --before-days",
        ),
        (
            {
                "start_from": None,
                "end_before": None,
                "from_days_ago": None,
                "before_days": None,
            },
            "You must provide either (--start-from,--end-before) or (--before-days [--from-days-ago])",
        ),
    ],
)
def test_invalid_inputs_raise_usage_error(kwargs: dict, message: str):
    with pytest.raises(click.UsageError, match=re.escape(message)):
        clean_expired_messages.callback(
            batch_size=1000,
            graceful_period=21,
            start_from=kwargs["start_from"],
            end_before=kwargs["end_before"],
            from_days_ago=kwargs["from_days_ago"],
            before_days=kwargs["before_days"],
            dry_run=False,
        )
