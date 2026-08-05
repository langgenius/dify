from unittest.mock import patch

import pytest

from tasks.refresh_billing_vector_space_task import (
    refresh_billing_vector_space_task,
    schedule_billing_vector_space_refresh,
)


def test_refresh_invalidates_vector_space_cache():
    with (
        patch("tasks.refresh_billing_vector_space_task.dify_config.BILLING_ENABLED", True),
        patch(
            "tasks.refresh_billing_vector_space_task.BillingService.invalidate_vector_space_cache"
        ) as invalidate_cache,
    ):
        refresh_billing_vector_space_task.run("tenant-1")

    invalidate_cache.assert_called_once_with("tenant-1")


def test_refresh_failure_schedules_retry():
    error = RuntimeError("billing unavailable")

    with (
        patch("tasks.refresh_billing_vector_space_task.dify_config.BILLING_ENABLED", True),
        patch(
            "tasks.refresh_billing_vector_space_task.BillingService.invalidate_vector_space_cache",
            side_effect=error,
        ),
        patch.object(refresh_billing_vector_space_task, "retry", side_effect=RuntimeError("retry scheduled")) as retry,
        pytest.raises(RuntimeError, match="retry scheduled"),
    ):
        refresh_billing_vector_space_task.run("tenant-1")

    retry.assert_called_once_with(exc=error, countdown=30)


def test_dispatch_failure_does_not_propagate():
    with (
        patch("tasks.refresh_billing_vector_space_task.dify_config.BILLING_ENABLED", True),
        patch.object(refresh_billing_vector_space_task, "delay", side_effect=RuntimeError("broker unavailable")),
    ):
        schedule_billing_vector_space_refresh("tenant-1")
