"""Unit tests for core.workflow.nodes.agent.think_tags.

Covers the ``<think>`` normalisation helpers that repair reasoning-model output
when a tool call interrupts generation before ``</think>`` is emitted. The tests
pin the scanning rules directly: nested opens split into separate blocks,
duplicate consecutive opens collapse, whitespace alone does not count as
content, and the stream state machine only closes a block on demand.
"""

import pytest

from core.workflow.nodes.agent.think_tags import (
    THINK_CLOSE,
    THINK_OPEN,
    ThinkStreamState,
    close_unclosed_think_tags,
    has_unclosed_think,
    normalize_think_chunk,
)

# =========================================================
# has_unclosed_think
# =========================================================


def test_has_unclosed_think_returns_false_for_empty_text() -> None:
    assert has_unclosed_think("") is False


def test_has_unclosed_think_returns_false_without_tags() -> None:
    assert has_unclosed_think("plain answer") is False


def test_has_unclosed_think_returns_true_for_open_tag() -> None:
    assert has_unclosed_think(f"{THINK_OPEN}reasoning") is True


def test_has_unclosed_think_returns_false_for_balanced_tags() -> None:
    assert has_unclosed_think(f"{THINK_OPEN}reasoning{THINK_CLOSE}answer") is False


def test_has_unclosed_think_returns_true_after_second_open() -> None:
    text = f"{THINK_OPEN}a{THINK_CLOSE}{THINK_OPEN}b"

    assert has_unclosed_think(text) is True


def test_has_unclosed_think_ignores_non_whitespace_content_after_close() -> None:
    assert has_unclosed_think(f"{THINK_OPEN}a{THINK_CLOSE}answer") is False


def test_has_unclosed_think_is_case_sensitive() -> None:
    assert has_unclosed_think("<THINK>reasoning") is False


# =========================================================
# close_unclosed_think_tags
# =========================================================


def test_close_unclosed_think_tags_keeps_empty_text() -> None:
    assert close_unclosed_think_tags("") == ""


def test_close_unclosed_think_tags_keeps_balanced_text() -> None:
    text = f"{THINK_OPEN}reasoning{THINK_CLOSE}answer"

    assert close_unclosed_think_tags(text) == text


def test_close_unclosed_think_tags_appends_missing_close() -> None:
    assert close_unclosed_think_tags(f"{THINK_OPEN}reasoning") == f"{THINK_OPEN}reasoning{THINK_CLOSE}"


def test_close_unclosed_think_tags_splits_nested_open_with_content() -> None:
    assert close_unclosed_think_tags(f"{THINK_OPEN}a{THINK_OPEN}b") == (
        f"{THINK_OPEN}a{THINK_CLOSE}{THINK_OPEN}b{THINK_CLOSE}"
    )


def test_close_unclosed_think_tags_collapses_consecutive_opens() -> None:
    assert close_unclosed_think_tags(f"{THINK_OPEN}{THINK_OPEN}reasoning") == (f"{THINK_OPEN}reasoning{THINK_CLOSE}")


def test_close_unclosed_think_tags_keeps_whitespace_only_block_collapsed() -> None:
    assert close_unclosed_think_tags(f"{THINK_OPEN}  {THINK_OPEN}reasoning") == (
        f"{THINK_OPEN}  reasoning{THINK_CLOSE}"
    )


def test_close_unclosed_think_tags_keeps_stray_close_tag() -> None:
    assert close_unclosed_think_tags(f"answer{THINK_CLOSE}") == f"answer{THINK_CLOSE}"


def test_close_unclosed_think_tags_keeps_surrounding_text() -> None:
    assert close_unclosed_think_tags(f"before{THINK_OPEN}reasoning") == (f"before{THINK_OPEN}reasoning{THINK_CLOSE}")


# =========================================================
# normalize_think_chunk
# =========================================================


def test_normalize_chunk_does_not_close_at_chunk_end() -> None:
    text, inside, content_since_open = normalize_think_chunk(f"{THINK_OPEN}reasoning", inside=False)

    assert text == f"{THINK_OPEN}reasoning"
    assert inside is True
    assert content_since_open is True


def test_normalize_chunk_tracks_inside_state_from_previous_chunk() -> None:
    text, inside, content_since_open = normalize_think_chunk(f"more{THINK_CLOSE}answer", inside=True)

    assert text == f"more{THINK_CLOSE}answer"
    assert inside is False
    assert content_since_open is False


def test_normalize_chunk_splits_nested_open_when_previous_chunk_has_content() -> None:
    text, inside, content_since_open = normalize_think_chunk(f"{THINK_OPEN}next", inside=True, content_since_open=True)

    assert text == f"{THINK_CLOSE}{THINK_OPEN}next"
    assert inside is True
    assert content_since_open is True


def test_normalize_chunk_drops_nested_open_without_content() -> None:
    text, inside, content_since_open = normalize_think_chunk(f"{THINK_OPEN}next", inside=True, content_since_open=False)

    assert text == "next"
    assert inside is True
    assert content_since_open is True


def test_normalize_chunk_keeps_whitespace_content_flag() -> None:
    text, inside, content_since_open = normalize_think_chunk(" \n", inside=True)

    assert text == " \n"
    assert inside is True
    assert content_since_open is False


# =========================================================
# ThinkStreamState
# =========================================================


def test_stream_state_accumulates_repaired_chunks() -> None:
    state = ThinkStreamState()

    first = state.feed_text(f"{THINK_OPEN}a")
    second = state.feed_text(f"b{THINK_CLOSE}answer")

    assert first == f"{THINK_OPEN}a"
    assert second == f"b{THINK_CLOSE}answer"
    assert state.text == f"{THINK_OPEN}ab{THINK_CLOSE}answer"
    assert state.inside is False


def test_stream_state_close_if_open_is_noop_when_closed() -> None:
    state = ThinkStreamState()
    state.feed_text("answer")

    assert state.close_if_open() is None
    assert state.text == "answer"


def test_stream_state_close_if_open_appends_close_once() -> None:
    state = ThinkStreamState()
    state.feed_text(f"{THINK_OPEN}reasoning")

    assert state.close_if_open() == THINK_CLOSE
    assert state.text == f"{THINK_OPEN}reasoning{THINK_CLOSE}"
    assert state.inside is False
    assert state.close_if_open() is None


@pytest.mark.parametrize("text", [f"{THINK_OPEN}", f"{THINK_OPEN}\n", f"{THINK_OPEN}  {THINK_OPEN}"])
def test_stream_state_closes_any_open_block(text: str) -> None:
    state = ThinkStreamState()
    state.feed_text(text)

    assert state.close_if_open() == THINK_CLOSE
    assert state.text.endswith(THINK_CLOSE)
