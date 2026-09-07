"""Normalize unclosed ``<think>`` tags in agent/workflow text streams.

Reasoning models (GLM, DeepSeek, etc.) wrap chain-of-thought in ``<think>``
tags. A tool call often interrupts generation before ``</think>`` is emitted,
so a later ``<think>`` or the final answer stays nested in the still-open tag
and the UI renders the reply as thinking. See https://github.com/langgenius/dify/issues/41558
"""

from __future__ import annotations

THINK_OPEN = "<think>"
THINK_CLOSE = "</think>"


def has_unclosed_think(text: str) -> bool:
    """Return True when a ``<think>`` is still open in ``text``."""
    _, inside, _ = _walk(text, inside=False, content_since_open=False, close_at_end=False)
    return inside


def close_unclosed_think_tags(text: str) -> str:
    """Insert missing ``</think>`` before a nested open tag and at end of text."""
    repaired, _, _ = _walk(text, inside=False, content_since_open=False, close_at_end=True)
    return repaired


def normalize_think_chunk(
    chunk: str,
    *,
    inside: bool,
    content_since_open: bool = False,
) -> tuple[str, bool, bool]:
    """Repair nested opens in a stream chunk and return updated open state.

    Does not append a trailing ``</think>`` — the caller closes on tool-call
    interruptions and at end of stream.
    """
    return _walk(chunk, inside=inside, content_since_open=content_since_open, close_at_end=False)


class ThinkStreamState:
    """Track concatenated text and whether a ``<think>`` block is still open."""

    def __init__(self) -> None:
        self.text = ""
        self.inside = False
        self.content_since_open = False

    def feed_text(self, chunk: str) -> str:
        repaired, self.inside, self.content_since_open = normalize_think_chunk(
            chunk,
            inside=self.inside,
            content_since_open=self.content_since_open,
        )
        self.text += repaired
        return repaired

    def close_if_open(self) -> str | None:
        if not self.inside:
            return None
        self.inside = False
        self.content_since_open = False
        self.text += THINK_CLOSE
        return THINK_CLOSE


def _walk(
    text: str,
    *,
    inside: bool,
    content_since_open: bool,
    close_at_end: bool,
) -> tuple[str, bool, bool]:
    parts: list[str] = []
    i = 0
    length = len(text)
    open_len = len(THINK_OPEN)
    close_len = len(THINK_CLOSE)

    while i < length:
        if text.startswith(THINK_OPEN, i):
            if inside and content_since_open:
                parts.append(THINK_CLOSE)
            elif inside:
                i += open_len
                continue
            parts.append(THINK_OPEN)
            inside = True
            content_since_open = False
            i += open_len
            continue
        if text.startswith(THINK_CLOSE, i):
            parts.append(THINK_CLOSE)
            inside = False
            content_since_open = False
            i += close_len
            continue
        ch = text[i]
        parts.append(ch)
        if inside and not ch.isspace():
            content_since_open = True
        i += 1

    if close_at_end and inside:
        parts.append(THINK_CLOSE)
        inside = False
        content_since_open = False

    return "".join(parts), inside, content_since_open
