"""Tests for CJK keyword search in workflow log queries.

PR #30450 introduced ``escape_like_pattern`` to prevent SQL injection via LIKE
wildcards, but removed the ``unicode_escape`` encoding that was essential for
matching CJK characters stored as ``\\uXXXX`` escape sequences (the default
behaviour of ``json.dumps(ensure_ascii=True)``).

These tests verify that both the raw-CJK and the ``\\uXXXX``-escaped LIKE
patterns are produced correctly so that searches work regardless of how the
data was serialized.
"""

import pytest

from libs.helper import escape_like_pattern


class TestCJKKeywordEncoding:
    """Verify the CJK keyword-to-LIKE-pattern conversion used in
    ``WorkflowAppService.get_workflow_app_logs``."""

    @staticmethod
    def _build_like_values(keyword: str) -> tuple[str, str | None]:
        """Reproduce the keyword encoding logic from workflow_app_service.py.

        Returns (raw_like_val, ascii_escaped_like_val_or_None).
        """
        truncated = keyword[:30]
        escaped = escape_like_pattern(truncated)
        raw_like_val = f"%{escaped}%"

        has_non_ascii = any(ord(c) > 127 for c in truncated)
        if has_non_ascii:
            ascii_escaped = escape_like_pattern(
                truncated.encode("unicode_escape").decode("utf-8")
            )
            return raw_like_val, f"%{ascii_escaped}%"
        return raw_like_val, None

    # ── CJK keywords ──────────────────────────────────────────────

    def test_cjk_keyword_produces_both_like_values(self):
        """A CJK keyword must produce both a raw and an ascii-escaped LIKE value."""
        raw, escaped = self._build_like_values("你好")
        assert raw == "%你好%"
        assert escaped is not None
        # The escaped form should contain \\u4f60 and \\u597d (doubled backslashes
        # for LIKE ESCAPE '\\')
        assert "\\\\u4f60" in escaped
        assert "\\\\u597d" in escaped

    def test_cjk_keyword_escaped_form_matches_json_dumps_output(self):
        """The escaped LIKE value must match data produced by json.dumps with
        ensure_ascii=True (the default)."""
        import json

        keyword = "你好世界"
        _, escaped = self._build_like_values(keyword)
        assert escaped is not None

        # Simulate what's stored in the database: json.dumps with default ensure_ascii
        stored = json.dumps({"query": keyword})
        # stored contains \u4f60\u597d\u4e16\u754c (with literal backslashes)
        assert "\\u4f60" in stored

        # The escaped LIKE value, after PostgreSQL processes it with ESCAPE '\\',
        # must resolve to a pattern that matches the stored data.
        # escaped has \\\\u4f60 → PostgreSQL reads \\ as literal \ → matches \u4f60
        assert "\\\\u4f60" in escaped

    @pytest.mark.parametrize(
        "keyword",
        ["你好", "日本語", "한국어", "Привет"],
    )
    def test_non_ascii_keywords_produce_escaped_form(self, keyword: str):
        """Any non-ASCII keyword should produce an additional escaped LIKE value."""
        _, escaped = self._build_like_values(keyword)
        assert escaped is not None
        # All non-ASCII chars must have been converted to \\uXXXX in the escaped form
        # (no raw non-ASCII chars should remain in the escaped form)
        raw_non_ascii = any(ord(c) > 127 for c in escaped)
        # The escaped form may still contain % delimiters but the keyword part
        # should have no raw non-ASCII characters
        keyword_part = escaped.strip("%")
        assert not any(ord(c) > 127 for c in keyword_part)

    # ── Mixed ASCII + CJK ────────────────────────────────────────

    def test_mixed_ascii_cjk_keyword(self):
        """A keyword with both ASCII and CJK characters must produce correct
        LIKE values for both forms."""
        raw, escaped = self._build_like_values("test你好")
        assert raw == "%test你好%"
        assert escaped is not None
        # ASCII part stays as-is, CJK part gets \\uXXXX encoded
        assert "test" in escaped
        assert "\\\\u4f60" in escaped

    # ── Pure ASCII keywords ──────────────────────────────────────

    def test_ascii_keyword_no_escaped_form(self):
        """Pure ASCII keywords should NOT produce an additional escaped LIKE
        value (no need for double-search)."""
        raw, escaped = self._build_like_values("hello")
        assert raw == "%hello%"
        assert escaped is None

    def test_ascii_keyword_with_special_like_chars(self):
        """ASCII keywords with LIKE special characters are properly escaped
        and no extra escaped form is produced."""
        raw, escaped = self._build_like_values("50%_test")
        assert raw == "%50\\%\\_test%"
        assert escaped is None

    # ── Edge cases ───────────────────────────────────────────────

    def test_keyword_truncation_at_30_chars(self):
        """Keywords longer than 30 characters are truncated before encoding."""
        long_keyword = "你好" * 20  # 40 chars
        raw, escaped = self._build_like_values(long_keyword)
        # Raw form should contain at most 30 chars of the keyword
        keyword_in_raw = raw.strip("%")
        assert len(keyword_in_raw) <= 30

    def test_cjk_keyword_with_like_special_chars(self):
        """CJK keywords that also contain LIKE special characters (% _ \\)
        must have those characters properly escaped in both LIKE values."""
        raw, escaped = self._build_like_values("50%你好")
        assert raw == "%50\\%你好%"
        assert escaped is not None
        assert "50\\%" in escaped
        assert "\\\\u4f60" in escaped
