"""
Test for invisible Unicode delimiter support in FixedRecursiveCharacterTextSplitter.

Regression test for issue #31672:
ZWSP and other invisible Unicode characters should work as delimiters.
"""

import pytest

from core.rag.splitter.fixed_text_splitter import FixedRecursiveCharacterTextSplitter


class TestInvisibleDelimiters:
    """Test invisible Unicode characters as delimiters."""

    @pytest.fixture
    def base_splitter_kwargs(self):
        """Common kwargs for creating splitters."""
        def length_function(texts: list[str]) -> list[int]:
            return [len(text) for text in texts]
        
        return {
            "chunk_size": 100,
            "chunk_overlap": 0,
            "length_function": length_function,
        }

    def test_zwsp_literal_delimiter(self, base_splitter_kwargs):
        """ZWSP (U+200B) should work as a literal delimiter."""
        zwsp = "\u200b"
        splitter = FixedRecursiveCharacterTextSplitter(
            fixed_separator=zwsp,
            **base_splitter_kwargs,
        )

        text = f"chunk1{zwsp}chunk2{zwsp}chunk3"
        result = splitter.split_text(text)

        assert len(result) == 3
        assert result == ["chunk1", "chunk2", "chunk3"]

    def test_zwnbsp_literal_delimiter(self, base_splitter_kwargs):
        """ZWNBSP (U+FEFF) should work as a literal delimiter."""
        zwnbsp = "\ufeff"
        splitter = FixedRecursiveCharacterTextSplitter(
            fixed_separator=zwnbsp,
            **base_splitter_kwargs,
        )

        text = f"chunk1{zwnbsp}chunk2{zwnbsp}chunk3"
        result = splitter.split_text(text)

        assert len(result) == 3
        assert result == ["chunk1", "chunk2", "chunk3"]

    def test_invisible_separator_literal(self, base_splitter_kwargs):
        """INVISIBLE SEPARATOR (U+2063) should work as a literal delimiter."""
        invisible_sep = "\u2063"
        splitter = FixedRecursiveCharacterTextSplitter(
            fixed_separator=invisible_sep,
            **base_splitter_kwargs,
        )

        text = f"chunk1{invisible_sep}chunk2{invisible_sep}chunk3"
        result = splitter.split_text(text)

        assert len(result) == 3
        assert result == ["chunk1", "chunk2", "chunk3"]

    def test_word_joiner_literal(self, base_splitter_kwargs):
        """WORD JOINER (U+2060) should work as a literal delimiter."""
        word_joiner = "\u2060"
        splitter = FixedRecursiveCharacterTextSplitter(
            fixed_separator=word_joiner,
            **base_splitter_kwargs,
        )

        text = f"chunk1{word_joiner}chunk2{word_joiner}chunk3"
        result = splitter.split_text(text)

        assert len(result) == 3
        assert result == ["chunk1", "chunk2", "chunk3"]

    def test_ltr_mark_literal(self, base_splitter_kwargs):
        """LEFT-TO-RIGHT MARK (U+200E) should work as a literal delimiter."""
        ltr_mark = "\u200e"
        splitter = FixedRecursiveCharacterTextSplitter(
            fixed_separator=ltr_mark,
            **base_splitter_kwargs,
        )

        text = f"chunk1{ltr_mark}chunk2{ltr_mark}chunk3"
        result = splitter.split_text(text)

        assert len(result) == 3
        assert result == ["chunk1", "chunk2", "chunk3"]

    def test_escaped_newline_still_works(self, base_splitter_kwargs):
        """Escaped newline \\n should still be decoded properly."""
        splitter = FixedRecursiveCharacterTextSplitter(
            fixed_separator="\\n",
            **base_splitter_kwargs,
        )

        text = "chunk1\nchunk2\nchunk3"
        result = splitter.split_text(text)

        assert len(result) == 3
        assert result == ["chunk1", "chunk2", "chunk3"]

    def test_escaped_tab_still_works(self, base_splitter_kwargs):
        """Escaped tab \\t should still be decoded properly."""
        splitter = FixedRecursiveCharacterTextSplitter(
            fixed_separator="\\t",
            **base_splitter_kwargs,
        )

        text = "chunk1\tchunk2\tchunk3"
        result = splitter.split_text(text)

        assert len(result) == 3
        assert result == ["chunk1", "chunk2", "chunk3"]

    def test_literal_newline_works(self, base_splitter_kwargs):
        """Literal newline should work without escaping."""
        splitter = FixedRecursiveCharacterTextSplitter(
            fixed_separator="\n",
            **base_splitter_kwargs,
        )

        text = "chunk1\nchunk2\nchunk3"
        result = splitter.split_text(text)

        assert len(result) == 3
        assert result == ["chunk1", "chunk2", "chunk3"]

    def test_chinese_punctuation_literal(self, base_splitter_kwargs):
        """Chinese punctuation should work as literal delimiters (related to issue)."""
        # Test Chinese comma
        splitter = FixedRecursiveCharacterTextSplitter(
            fixed_separator="，",
            **base_splitter_kwargs,
        )

        text = "chunk1，chunk2，chunk3"
        result = splitter.split_text(text)

        assert len(result) == 3
        assert result == ["chunk1", "chunk2", "chunk3"]

    def test_mixed_content_with_zwsp(self, base_splitter_kwargs):
        """Test realistic content with ZWSP delimiters."""
        zwsp = "\u200b"
        splitter = FixedRecursiveCharacterTextSplitter(
            fixed_separator=zwsp,
            **base_splitter_kwargs,
        )

        text = f"First paragraph with some text.{zwsp}Second paragraph with more content.{zwsp}Third paragraph here."
        result = splitter.split_text(text)

        assert len(result) == 3
        assert "First paragraph" in result[0]
        assert "Second paragraph" in result[1]
        assert "Third paragraph" in result[2]

    def test_empty_separator(self, base_splitter_kwargs):
        """Empty separator should not split."""
        splitter = FixedRecursiveCharacterTextSplitter(
            fixed_separator="",
            **base_splitter_kwargs,
        )

        text = "chunk1 chunk2 chunk3"
        result = splitter.split_text(text)

        # Should not split on empty separator
        assert len(result) == 1

    def test_escaped_unicode_hex_notation(self, base_splitter_kwargs):
        """Escaped Unicode hex notation \\u200b should be decoded."""
        splitter = FixedRecursiveCharacterTextSplitter(
            fixed_separator="\\u200b",
            **base_splitter_kwargs,
        )

        zwsp = "\u200b"
        text = f"chunk1{zwsp}chunk2{zwsp}chunk3"
        result = splitter.split_text(text)

        assert len(result) == 3
        assert result == ["chunk1", "chunk2", "chunk3"]
