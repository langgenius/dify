from concurrent.futures import ThreadPoolExecutor

import pytest

from services.moderation_service import ModerationRejectedError, ModerationUnavailableError
from services.moderation_session import ModerationSession


def test_sessions_require_an_admitted_tenant() -> None:
    with pytest.raises(ValueError, match="tenant scope"):
        ModerationSession("", "app-1")


def test_exact_decisions_are_shared_across_threads_but_not_phases() -> None:
    session = ModerationSession("tenant-1", "app-1")
    calls: list[str] = []

    def check() -> None:
        calls.append("checked")

    def request(_: int) -> None:
        session.check("same content", "input", check)

    with ThreadPoolExecutor(max_workers=4) as executor:
        list(executor.map(request, range(12)))
    assert calls == ["checked"]
    session.check("same content", "output", check)
    assert calls == ["checked", "checked"]


def test_rejections_are_reused_but_unavailable_checks_are_not_cached() -> None:
    session = ModerationSession("tenant-1", "app-1")
    attempts: list[str] = []

    def reject() -> None:
        attempts.append("rejected")
        raise ModerationRejectedError("output", "Blocked")

    def unavailable() -> None:
        attempts.append("unavailable")
        raise RuntimeError("Unavailable")

    for _attempt in range(2):
        with pytest.raises(ModerationRejectedError, match="Blocked"):
            session.check("blocked", "output", reject)
        with pytest.raises(RuntimeError, match="Unavailable"):
            session.check("safe", "output", unavailable)
    assert attempts == ["rejected", "unavailable", "unavailable"]
    assert session.rejected_phase("Blocked") == "output"
    assert session.rejected_phase("Unrelated failure") is None


def test_approved_output_is_an_exact_stream_prefix_not_a_substring_or_composition() -> None:
    session = ModerationSession("tenant-1", "app-1")
    stream = object()
    session.record_output(stream, "safe")
    session.record_output(stream, " answer")
    session.record_output(object(), "other")

    assert session.approved_output("safe")
    assert session.approved_output("safe answer")
    assert not session.approved_output("answer")
    assert not session.approved_output("safe answerother")
    assert not session.approved_output("unsafe")
    assert not ModerationSession("tenant-2", "app-1").approved_output("safe")


def test_recorded_unavailability_is_not_an_approval_or_a_cached_verdict() -> None:
    session = ModerationSession("tenant-1", "app-1")
    error = ModerationUnavailableError("Unavailable")
    session.record_unavailable(error)

    assert session.unavailable_error("Unavailable") is error
    assert session.unavailable_error("Run failed: Unavailable") is None
    assert ModerationSession("tenant-1", "app-1").unavailable_error("Unavailable") is None
    assert session.rejected_phase("Unavailable") is None
    assert session.cached_verdict("unchecked", "input") is None
    session.check("unchecked", "input", lambda: None)
    assert session.cached_verdict("unchecked", "input") is False


def test_cached_verdicts_do_not_approve_unknown_or_failed_checks() -> None:
    session = ModerationSession("tenant-1", "app-1")
    session.check("approved", "input", lambda: None)
    assert session.cached_verdict("approved", "input") is False
    assert session.cached_verdict("approved", "output") is None
    assert session.cached_verdict("unknown", "input") is None

    def reject() -> None:
        raise ModerationRejectedError("output", "Blocked")

    with pytest.raises(ModerationRejectedError):
        session.check("blocked", "output", reject)
    assert session.cached_verdict("blocked", "output") is True
    assert session.cached_verdict("blocked", "input") is None

    def unavailable() -> None:
        raise RuntimeError("Unavailable")

    with pytest.raises(RuntimeError):
        session.check("unchecked", "output", unavailable)
    assert session.cached_verdict("unchecked", "output") is None
    session.record_output(object(), "safe answer")
    assert session.cached_verdict("safe", "output") is False
    assert session.cached_verdict("answer", "output") is None
