"""Shared retry and terminal-failure rules for knowledge index mutation tasks."""

from unittest.mock import patch

import pytest
from celery import Task
from celery.exceptions import Ignore, Reject, Retry
from redis.exceptions import RedisError

import tasks.indexing_task_retry as retry_module
from services.knowledge.indexing.locks import KnowledgeIndexingLockBusyError
from tasks.add_document_to_index_task import add_document_to_index_task
from tasks.indexing_task_retry import (
    LOCK_BUSY_RETRY_MAX_SECONDS,
    clear_document_indexing_cache,
    clear_segment_indexing_cache,
    is_final_attempt,
    is_terminal_failure,
    lock_busy_countdown,
    resolve_documents_after_terminal_failure,
)

_RETRYABLE = (KnowledgeIndexingLockBusyError, RedisError)


class _FailingRedis:
    def __init__(self) -> None:
        self.names: list[str] = []

    def delete(self, *names: str) -> object:
        self.names.extend(names)
        raise RedisError("redis unavailable")


def _at_retries(task: "Task[..., None]", retries: int) -> "Task[..., None]":
    task.push_request(retries=retries)
    return task


@pytest.mark.parametrize(
    ("retries", "max_retries", "expected"),
    [(0, 3, False), (2, 3, False), (3, 3, True), (4, 3, True), (1000, None, False)],
)
def test_final_attempt_matches_celery_refusal_of_the_next_retry(
    retries: int, max_retries: int | None, expected: bool
) -> None:
    task = _at_retries(add_document_to_index_task, retries)
    try:
        assert is_final_attempt(task, max_retries=max_retries) is expected
    finally:
        task.pop_request()


@pytest.mark.parametrize(
    ("error", "retries", "expected"),
    [
        (KnowledgeIndexingLockBusyError("busy"), 0, False),
        (KnowledgeIndexingLockBusyError("busy"), 3, True),
        (ValueError("not retryable"), 0, True),
        # Celery control flow is never a failure, even on the last attempt.
        (Retry(), 3, False),
        (Ignore(), 3, False),
        (Reject(), 3, False),
    ],
)
def test_terminal_failure_is_a_non_retryable_error_or_an_exhausted_retry(
    error: Exception, retries: int, expected: bool
) -> None:
    task = _at_retries(add_document_to_index_task, retries)
    try:
        assert is_terminal_failure(task, error, retryable=_RETRYABLE, max_retries=3) is expected
    finally:
        task.pop_request()


def test_lock_busy_countdown_backs_off_exponentially_up_to_its_cap() -> None:
    countdowns: list[int] = []
    for retries in (0, 1, 2, 5, 6, 400):
        task = _at_retries(add_document_to_index_task, retries)
        try:
            countdowns.append(lock_busy_countdown(task))
        finally:
            task.pop_request()

    assert countdowns == [1, 2, 4, 32, LOCK_BUSY_RETRY_MAX_SECONDS, LOCK_BUSY_RETRY_MAX_SECONDS]


def test_cache_clearing_is_best_effort_and_attempts_every_key() -> None:
    redis = _FailingRedis()

    clear_document_indexing_cache(redis, "document-1")
    clear_segment_indexing_cache(redis, ["segment-1", "segment-2"])

    assert redis.names == [
        "document_document-1_indexing",
        "segment_segment-1_indexing",
        "segment_segment-2_indexing",
    ]


def test_terminal_resolution_skips_missing_documents_and_never_raises() -> None:
    def unexpected(_document: object) -> bool:
        raise AssertionError("a missing document must not be inspected")

    assert (
        resolve_documents_after_terminal_failure(
            ["missing-document"],
            still_owned=unexpected,
            resolve=lambda _document: None,
        )
        == ()
    )

    # A persistence failure is logged; the caller must still be able to re-raise its own error.
    with patch.object(retry_module.session_factory, "create_session", side_effect=RuntimeError("database unavailable")):
        assert (
            resolve_documents_after_terminal_failure(
                ["document-1"],
                still_owned=lambda _document: True,
                resolve=lambda _document: None,
            )
            == ()
        )
