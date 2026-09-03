"""Helpers for formatting shell output into bounded prompt-safe text.

The shell layer uses byte budgets, not Python character counts, because
shellctl output windows are byte-limited. These helpers keep UTF-8 boundaries
valid while producing a compact head/tail rendering for model-visible output.
"""

from __future__ import annotations


def utf8_prefix(text: str, max_bytes: int) -> str:
    """Return the longest UTF-8-safe prefix that fits within ``max_bytes``."""
    if max_bytes <= 0:
        return ""
    return text.encode("utf-8")[:max_bytes].decode("utf-8", errors="ignore")


def utf8_suffix(text: str, max_bytes: int) -> str:
    """Return the longest UTF-8-safe suffix that fits within ``max_bytes``."""
    if max_bytes <= 0:
        return ""
    return text.encode("utf-8")[-max_bytes:].decode("utf-8", errors="ignore")


def normalized_output_text(
    head: str,
    *,
    tail: str | None,
    output_path: str | None,
    max_output_size_bytes: int,
    truncated_in_middle: bool | None = None,
    truncation_message: str | None = None,
) -> str:
    """Format bounded shell output with an optional truncation marker and log path."""
    if truncated_in_middle is None:
        truncated_in_middle = tail is not None and tail != head
    if not truncated_in_middle:
        return head
    if truncation_message is None:
        truncation_message = (
            f"truncated in middle because the max output size is limited to {max_output_size_bytes} bytes"
        )

    parts = [
        head,
        f"... ({truncation_message}) ...",
    ]
    if tail is not None:
        parts.append(tail)
    if output_path:
        parts.append(f"(check the {output_path} for full output)")
    return "\n".join(parts)


__all__ = ["normalized_output_text", "utf8_prefix", "utf8_suffix"]
