from concurrent.futures import ThreadPoolExecutor

import pytest

from services.moderation_service import ModerationRejectedError, ModerationUnavailableError
from services.moderation_session import ModerationSession


def test_sessions_require_an_admitted_tenant() -> None:
    with pytest.raises(ValueError, match="tenant scope"):
        ModerationSession("", "app-1")


def test_producers_publish_failures_to_one_terminal_consumer() -> None:
    session = ModerationSession("tenant-1", "app-1")
    errors = [ModerationRejectedError("input", f"Rejected {index}") for index in range(12)]
    with ThreadPoolExecutor(max_workers=4) as executor:
        list(executor.map(session.record_rejection, errors))
    for error in errors:
        assert session.rejected_phase(str(error)) == "input"
    assert session.rejected_phase("Unrelated") is None


def test_unavailability_preserves_identity_and_never_becomes_a_rejection() -> None:
    session = ModerationSession("tenant-1", "app-1")
    error = ModerationUnavailableError("Unavailable")
    session.record_unavailable(error)
    assert session.unavailable_error("Unavailable") is error
    assert session.unavailable_error("Run failed: Unavailable") is None
    assert session.rejected_phase("Unavailable") is None
    assert ModerationSession("tenant-1", "app-1").unavailable_error("Unavailable") is None


def test_failure_types_and_phases_remain_distinct() -> None:
    session = ModerationSession("tenant-1", "app-1")
    session.record_rejection(ModerationRejectedError("input", "Input rejected"))
    session.record_rejection(ModerationRejectedError("output", "Output rejected"))
    error = ModerationUnavailableError("Unavailable")
    session.record_unavailable(error)
    assert session.rejected_phase("Input rejected") == "input"
    assert session.rejected_phase("Output rejected") == "output"
    assert session.unavailable_error("Unavailable") is error
