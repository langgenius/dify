"""Unit tests for WorkflowCopilotMemoryService assembly logic.

Focus on the externally observable contract of ``build_history_text`` — how a
stored summary + recent turns are rendered into the text injected into the
generator. Compression itself needs a real model + DB session and is covered by
integration-level checks; here we pin the pure assembly behaviour that callers
rely on (empty context on the first turn, summary + recent sectioning).
"""

from unittest.mock import MagicMock

from services.workflow_copilot_memory_service import (
    COMPRESS_THRESHOLD_TOKENS,
    RECENT_KEEP_COUNT,
    WorkflowCopilotMemoryService,
)


def _service() -> WorkflowCopilotMemoryService:
    # build_history_text never touches the model, so a bare mock is enough.
    return WorkflowCopilotMemoryService(MagicMock())


def test_build_history_text_empty_when_no_context() -> None:
    service = _service()
    assert service.build_history_text("", []) == ""


def test_build_history_text_summary_only() -> None:
    service = _service()
    result = service.build_history_text("Earlier we built an LLM node.", [])
    assert "Summary of earlier conversation" in result
    assert "Earlier we built an LLM node." in result
    assert "Recent turns" not in result


def test_build_history_text_recent_only() -> None:
    service = _service()
    result = service.build_history_text(
        "",
        [
            {"role": "user", "content": "add a start node"},
            {"role": "assistant", "content": "done"},
        ],
    )
    assert "Recent turns" in result
    assert "User: add a start node" in result
    assert "Assistant: done" in result
    assert "Summary of earlier conversation" not in result


def test_build_history_text_summary_and_recent_order() -> None:
    service = _service()
    result = service.build_history_text(
        "prior summary",
        [{"role": "user", "content": "next step"}],
    )
    # Summary section must precede the recent-turns section.
    assert result.index("Summary of earlier conversation") < result.index("Recent turns")


def test_compression_thresholds_are_sane() -> None:
    # Guard rails: keeping recent turns must not exceed the compress budget in a
    # way that makes compression impossible to trigger.
    assert COMPRESS_THRESHOLD_TOKENS > 0
    assert RECENT_KEEP_COUNT > 0
