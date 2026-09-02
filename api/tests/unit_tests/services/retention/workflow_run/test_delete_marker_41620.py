"""Regression tests for #41620.

``_delete_marker`` previously did one ``delete_object`` and walked away;
a transport timeout on the delete call left the bundle reported as
failed even when the remote delete had already succeeded. The fix
treats the post-delete marker state (verified via ``object_exists()``)
as the success criterion, with bounded retries for transient transport
errors and fail-closed behavior when the marker is still on the
server after the budget is exhausted.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from libs.archive_storage import ArchiveStorageError
from services.retention.workflow_run.bundle_archive_maintenance import (
    WorkflowRunBundleArchiveMaintenance,
    _is_retryable_archive_error,
)


def _make_storage(exists_sequence: list[bool]) -> MagicMock:
    """Storage stub whose ``object_exists`` returns successive values."""
    storage = MagicMock()
    storage.object_exists.side_effect = exists_sequence
    return storage


def _retryable_error() -> ArchiveStorageError:
    """A retryable ArchiveStorageError (5xx, wrapped ClientError)."""
    return _chained_error(code="ServiceUnavailable", message="transient")


def _non_retryable_error() -> ArchiveStorageError:
    """A non-retryable ArchiveStorageError (4xx, wrapped ClientError)."""
    return _chained_error(code="AccessDenied", message="nope")


def _chained_error(*, code: str | None, message: str) -> ArchiveStorageError:
    """Build an ``ArchiveStorageError`` with a real (non-MagicMock) cause.

    ``__cause__`` must be a ``BaseException`` instance, so we wrap a real
    fake ``botocore`` exception rather than a ``MagicMock``. Using a
    try/except + ``raise X from Y`` keeps the call site a single
    expression (Python 3.12 forbids ``raise`` in expression context).
    """
    if code is None:
        cause: Exception = _FakeBotoCoreError()
    else:
        cause = _FakeClientError(code)
    try:
        raise ArchiveStorageError(message) from cause
    except ArchiveStorageError as err:
        return err


class _FakeClientError(Exception):
    """Stand-in for ``botocore.exceptions.ClientError`` with a ``.response``."""

    def __init__(self, code: str) -> None:
        super().__init__(f"client-error:{code}")
        self.response = {"Error": {"Code": code}}


class _FakeBotoCoreError(Exception):
    """Stand-in for ``botocore.exceptions.BotoCoreError`` (no ``.response``)."""

    def __init__(self) -> None:
        super().__init__("boto-core-error")


class TestIsRetryableArchiveError:
    def test_5xx_codes_are_retryable(self):
        for code in (
            "InternalError",
            "RequestTimeout",
            "ServiceUnavailable",
            "SlowDown",
            "ThrottlingException",
            "TooManyRequests",
            "TransientError",
        ):
            err = _chained_error(code=code, message=code)
            assert _is_retryable_archive_error(err), code

    def test_4xx_codes_are_not_retryable(self):
        for code in ("AccessDenied", "NoSuchKey", "InvalidArgument"):
            err = _chained_error(code=code, message=code)
            assert not _is_retryable_archive_error(err), code

    def test_botocore_error_without_response_is_retryable(self):
        # BotoCoreError covers connection / timeout / SSL — these are
        # transient by nature.
        err = _chained_error(code=None, message="boto-core-error")
        assert _is_retryable_archive_error(err)

    def test_error_without_cause_is_not_retryable(self):
        # Without a wrapped exception we have no signal that the
        # failure is transient. Fail closed.
        assert not _is_retryable_archive_error(ArchiveStorageError("bare"))


class TestDeleteMarker:
    def test_marker_already_absent_is_a_noop(self):
        """If the marker is already gone, ``_delete_marker`` must not
        call ``delete_object`` and must return success without retrying."""
        storage = _make_storage(exists_sequence=[False])

        WorkflowRunBundleArchiveMaintenance._delete_marker(storage, "prefix", "marker.json")

        storage.delete_object.assert_not_called()
        storage.object_exists.assert_called_once()

    def test_delete_succeeds_and_marker_removed(self):
        """The pre-delete check sees the marker; ``delete_object`` is
        called; the post-delete HEAD confirms absence; the method
        returns success and does not retry."""
        storage = _make_storage(exists_sequence=[True, False])

        with patch("time.sleep") as sleep:
            WorkflowRunBundleArchiveMaintenance._delete_marker(storage, "prefix", "marker.json")

        storage.delete_object.assert_called_once_with("prefix/marker.json")
        assert storage.object_exists.call_count == 2
        sleep.assert_not_called()

    def test_retryable_error_then_success(self):
        """A retryable ``ArchiveStorageError`` from ``delete_object`` is
        retried, and the next call succeeds."""
        storage = MagicMock()
        # Two pre-checks (both see the marker) and one post-check (the
        # marker is gone after the second delete).
        storage.object_exists.side_effect = [True, True, False]
        # First delete call raises a retryable error; the retry succeeds.
        storage.delete_object.side_effect = [_retryable_error(), None]

        with patch("time.sleep") as sleep:
            WorkflowRunBundleArchiveMaintenance._delete_marker(storage, "prefix", "marker.json")

        assert storage.delete_object.call_count == 2
        # The first retry's backoff fires once.
        sleep.assert_called_once()

    def test_retryable_error_then_marker_still_present_then_success(self):
        """A retryable error followed by a successful delete whose
        post-delete HEAD still sees the marker (eventual consistency)
        is retried; the second delete+HEAD finally confirms absence."""
        storage = MagicMock()
        # pre-check True, retry #1 post-delete True, retry #2 post-delete False
        storage.object_exists.side_effect = [True, True, False]
        # First delete: error. Second delete: success.
        storage.delete_object.side_effect = [_retryable_error(), None]

        with patch("time.sleep"):
            WorkflowRunBundleArchiveMaintenance._delete_marker(storage, "prefix", "marker.json")

        assert storage.delete_object.call_count == 2
        # The object_exists check fired 3 times: pre-check, post-delete
        # after retry #1, post-delete after retry #2.
        assert storage.object_exists.call_count == 3

    def test_non_retryable_error_fails_closed_immediately(self):
        """A non-retryable 4xx (e.g. AccessDenied) is not retried."""
        storage = MagicMock()
        storage.object_exists.return_value = True
        storage.delete_object.side_effect = _non_retryable_error()

        with patch("time.sleep") as sleep:
            with pytest.raises(ArchiveStorageError):
                WorkflowRunBundleArchiveMaintenance._delete_marker(storage, "prefix", "marker.json")

        storage.delete_object.assert_called_once()
        sleep.assert_not_called()

    def test_marker_still_present_after_budget_is_exhausted_fails_closed(self):
        """When the marker is still on the server after every attempt,
        the method must raise (fail-closed) so the bundle is not
        marked succeeded with a stale transition marker present."""
        storage = MagicMock()
        storage.object_exists.return_value = True
        # First call: retryable. Subsequent: success. But the HEAD
        # always sees the marker still there.
        storage.delete_object.side_effect = [_retryable_error()] + [None] * 10
        # Pre-check True, every post-delete HEAD also True.
        storage.object_exists.side_effect = [True] * 20

        with patch("time.sleep"):
            with pytest.raises(ArchiveStorageError) as exc_info:
                WorkflowRunBundleArchiveMaintenance._delete_marker(storage, "prefix", "marker.json")

        assert "refusing to advance the bundle" in str(exc_info.value)
        # We never returned — the budget is bounded.
        assert storage.delete_object.call_count == 5

    def test_non_retryable_post_delete_head_error_fails_closed(self):
        """A non-retryable error on the post-delete HEAD (not the
        delete itself) must not be retried."""
        storage = MagicMock()
        storage.object_exists.return_value = True
        # First object_exists: pre-check, True.
        # Second object_exists: post-delete HEAD, raises.
        storage.object_exists.side_effect = [True, _non_retryable_error()]

        with patch("time.sleep") as sleep:
            with pytest.raises(ArchiveStorageError):
                WorkflowRunBundleArchiveMaintenance._delete_marker(storage, "prefix", "marker.json")

        sleep.assert_not_called()
