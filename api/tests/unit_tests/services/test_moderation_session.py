from concurrent.futures import ThreadPoolExecutor

import pytest

from services.moderation_service import ModerationRejectedError
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
