from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from threading import Event, Lock

import pytest

from services.knowledge_fs.buffered_upload_admission import KnowledgeFSBufferedUploadAdmission


def test_admission_rejects_invalid_limits_and_reservations() -> None:
    with pytest.raises(ValueError, match="max_concurrency"):
        KnowledgeFSBufferedUploadAdmission(max_concurrency=0, max_reserved_bytes=1)
    with pytest.raises(ValueError, match="max_reserved_bytes"):
        KnowledgeFSBufferedUploadAdmission(max_concurrency=1, max_reserved_bytes=0)

    admission = KnowledgeFSBufferedUploadAdmission(max_concurrency=1, max_reserved_bytes=10)
    with pytest.raises(ValueError, match="reserved_bytes"):
        with admission.admit(reserved_bytes=0):
            pass


def test_oversized_reservation_runs_exclusively_instead_of_failing_or_deadlocking() -> None:
    admission = KnowledgeFSBufferedUploadAdmission(max_concurrency=2, max_reserved_bytes=10)

    with admission.admit(reserved_bytes=11):
        snapshot = admission.snapshot()
        assert snapshot.active_count == 1
        assert snapshot.reserved_bytes == 11

    assert admission.snapshot().active_count == 0
    assert admission.snapshot().reserved_bytes == 0


def test_admission_bounds_concurrency_and_aggregate_reserved_bytes() -> None:
    admission = KnowledgeFSBufferedUploadAdmission(max_concurrency=2, max_reserved_bytes=10)
    release = Event()
    two_entered = Event()
    lock = Lock()
    active_count = 0
    peak_count = 0
    peak_reserved_bytes = 0

    def run_upload() -> None:
        nonlocal active_count, peak_count, peak_reserved_bytes
        with admission.admit(reserved_bytes=5):
            with lock:
                active_count += 1
                peak_count = max(peak_count, active_count)
                peak_reserved_bytes = max(peak_reserved_bytes, active_count * 5)
                if active_count == 2:
                    two_entered.set()
            assert release.wait(timeout=2)
            with lock:
                active_count -= 1

    with ThreadPoolExecutor(max_workers=3) as executor:
        futures = [executor.submit(run_upload) for _ in range(3)]
        assert two_entered.wait(timeout=2)
        assert admission.snapshot().active_count == 2
        assert admission.snapshot().reserved_bytes == 10
        release.set()
        for future in futures:
            future.result(timeout=2)

    assert peak_count == 2
    assert peak_reserved_bytes == 10
    assert admission.snapshot().active_count == 0
    assert admission.snapshot().reserved_bytes == 0


def test_admission_releases_capacity_when_the_upload_fails() -> None:
    admission = KnowledgeFSBufferedUploadAdmission(max_concurrency=1, max_reserved_bytes=10)

    with pytest.raises(RuntimeError, match="upload failed"):
        with admission.admit(reserved_bytes=10):
            raise RuntimeError("upload failed")

    with admission.admit(reserved_bytes=10):
        assert admission.snapshot().active_count == 1
        assert admission.snapshot().reserved_bytes == 10

    assert admission.snapshot().active_count == 0
    assert admission.snapshot().reserved_bytes == 0
