"""Lightweight PTY sanitizer used by tmux `pipe-pane`.

This module stays stdlib-only because shellctl starts it once per job to drain
PTY output into `output.log`. The ready-file handshake must happen before any
stdin reads so the server can distinguish slow startup from a stuck tmux pipe.
"""

from __future__ import annotations

import argparse
import codecs
import sys
from pathlib import Path
from typing import BinaryIO


class PtySanitizer:
    """Incrementally convert PTY bytes into stable, readable UTF-8 text.

    Responsibilities:
    - preserve UTF-8 decoder state across chunk boundaries
    - strip common ANSI control sequences without leaking partial escape state
    - normalize carriage-return progress updates into the final visible line

    This adapter intentionally keeps only minimal terminal state. It aims for a
    practical log representation rather than a full terminal emulator.
    """

    def __init__(self) -> None:
        self._decoder = codecs.getincrementaldecoder("utf-8")("replace")
        self._line_buffer = ""
        self._pending_cr = False
        self._escape_state = "normal"

    def feed(self, raw: bytes) -> str:
        """Consume one PTY byte chunk and return newly stable text."""

        return self._consume_text(self._decoder.decode(raw, final=False), final=False)

    def flush(self) -> str:
        """Flush buffered decoder/line state at end-of-stream."""

        tail = self._consume_text(self._decoder.decode(b"", final=True), final=True)
        if self._line_buffer:
            tail += self._line_buffer
            self._line_buffer = ""
        self._pending_cr = False
        self._escape_state = "normal"
        return tail

    def _consume_text(self, text: str, *, final: bool) -> str:
        parts: list[str] = []
        for char in text:
            self._consume_char(char, parts)
        if final and self._escape_state != "normal":
            self._escape_state = "normal"
        return "".join(parts)

    def _consume_char(self, char: str, parts: list[str]) -> None:
        state = self._escape_state
        if state == "normal":
            if char == "\x1b":
                self._escape_state = "esc"
                return
            self._consume_visible_char(char, parts)
            return
        if state == "esc":
            if char == "[":
                self._escape_state = "csi"
                return
            if char == "]":
                self._escape_state = "osc"
                return
            self._escape_state = "normal"
            if char.isprintable() and char != "\x1b":
                self._consume_visible_char(char, parts)
            return
        if state == "csi":
            if "@" <= char <= "~":
                self._escape_state = "normal"
            return
        if state == "osc":
            if char == "\x07":
                self._escape_state = "normal"
                return
            if char == "\x1b":
                self._escape_state = "osc_esc"
            return
        if state == "osc_esc":
            self._escape_state = "normal" if char == "\\" else "osc"

    def _consume_visible_char(self, char: str, parts: list[str]) -> None:
        if self._pending_cr:
            if char == "\n":
                parts.append(self._line_buffer)
                parts.append("\n")
                self._line_buffer = ""
                self._pending_cr = False
                return
            self._line_buffer = ""
            self._pending_cr = False
        if char == "\r":
            self._pending_cr = True
            return
        if char == "\n":
            parts.append(self._line_buffer)
            parts.append("\n")
            self._line_buffer = ""
            return
        self._line_buffer += char


def sanitize_pty_output(raw: bytes) -> str:
    """Sanitize a complete PTY byte string into readable UTF-8 text."""

    sanitizer = PtySanitizer()
    return sanitizer.feed(raw) + sanitizer.flush()


def sanitize_pty_stream(
    stdin: BinaryIO,
    stdout: BinaryIO,
    *,
    chunk_size: int = 65536,
) -> None:
    """Run the streaming PTY sanitizer as a Unix-style filter."""

    sanitizer = PtySanitizer()
    while True:
        chunk = stdin.read(chunk_size)
        if not chunk:
            break
        output = sanitizer.feed(chunk)
        if output:
            stdout.write(output.encode("utf-8"))
            if hasattr(stdout, "flush"):
                stdout.flush()
    tail = sanitizer.flush()
    if tail:
        stdout.write(tail.encode("utf-8"))
        if hasattr(stdout, "flush"):
            stdout.flush()
    if hasattr(stdout, "flush"):
        stdout.flush()


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """Parse the tiny CLI contract used by tmux `pipe-pane`."""

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ready-file", type=Path)
    return parser.parse_args(argv)


def run_sanitize_pty(
    ready_file: Path | None,
    *,
    stdin: BinaryIO,
    stdout: BinaryIO,
) -> None:
    """Touch the ready file, then sanitize stdin into stdout."""

    if ready_file is not None:
        ready_file.touch()
    sanitize_pty_stream(stdin, stdout)


def main(argv: list[str] | None = None) -> None:
    """Run the standalone PTY sanitizer module."""

    args = parse_args(argv)
    run_sanitize_pty(args.ready_file, stdin=sys.stdin.buffer, stdout=sys.stdout.buffer)


if __name__ == "__main__":
    main()


__all__ = [
    "PtySanitizer",
    "main",
    "parse_args",
    "run_sanitize_pty",
    "sanitize_pty_output",
    "sanitize_pty_stream",
]
