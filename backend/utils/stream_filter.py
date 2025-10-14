from typing import Iterator


class StreamingHTMLStripper:
    """
    Stream-safe stripper that removes a <details><summary>...</summary></details>
    wrapper from an async/sync stream of text chunks without buffering the whole stream.
    """

    def __init__(self, max_buffer: int = 4096):
        self.buffer = ""
        self.max_buffer = max_buffer

    def _strip_prefixes_from_buffer(self) -> bool:
        """
        If buffer starts with <details ...><summary>... </summary>, remove up to the end of </summary>.
        Return True if something was removed.
        """
        b = self.buffer.lstrip()
        if not b.startswith("<details"):
            return False

        # find end of opening <details ...>
        idx = b.find(">")
        if idx == -1:
            return False
        rest = b[idx + 1 :].lstrip()
        if not rest.startswith("<summary"):
            return False
        s_idx = rest.find(">")
        if s_idx == -1:
            return False
        after_summary = rest[s_idx + 1 :]
        end_summary_idx = after_summary.find("</summary>")
        if end_summary_idx == -1:
            return False
        # remove up to end of </summary>
        remove_len = (len(b) - len(rest)) + s_idx + 1 + end_summary_idx + len("</summary>")
        self.buffer = b[remove_len:].lstrip()
        return True

    def feed(self, chunk: str) -> Iterator[str]:
        """
        Feed a chunk and yield cleaned output pieces (synchronous usage).
        """
        if not chunk:
            return
        self.buffer += chunk

        # keep buffer bounded
        if len(self.buffer) > self.max_buffer:
            yield self.buffer
            self.buffer = ""
            return

        # attempt to strip wrapper prefix(s)
        while self._strip_prefixes_from_buffer():
            pass

        # ---- NEW: if the buffer currently *starts* with an opening <details...>
        # and we have not yet seen the closing </summary>, do not emit anything yet.
        # This prevents emitting partial wrapper text that later would be stripped.
        b_lstripped = self.buffer.lstrip()
        if b_lstripped.startswith("<details") and "</summary>" not in b_lstripped:
            # wait for more chunks (do not yield anything yet)
            return
        # ---- END NEW

        # choose safe cut so we don't emit partial tags
        last_lt = self.buffer.rfind("<")
        last_gt = self.buffer.rfind(">")
        if last_lt == -1:
            safe_cut = len(self.buffer)
        elif last_gt > last_lt:
            safe_cut = len(self.buffer)
        else:
            safe_cut = last_lt

        if safe_cut and safe_cut > 0:
            out = self.buffer[:safe_cut]
            self.buffer = self.buffer[safe_cut:]
            if out:
                yield out

    def finish(self) -> Iterator[str]:
        """Flush any remaining buffer at stream end."""
        while self._strip_prefixes_from_buffer():
            pass
        if self.buffer:
            yield self.buffer
            self.buffer = ""
