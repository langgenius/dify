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

    @pytest.mark.parametrize(
        "delimiter",
        [
            pytest.param("\u200b", id="zwsp"),
            pytest.param("\ufeff", id="zwnbsp"),
            pytest.param("\u2063", id="invisible_separator"),
            pytest.param("\u2060", id="word_joiner"),
            pytest.param("\u200e", id="ltr_mark"),
        ],
    )
    def test_invisible_literal_delimiters(self, base_splitter_kwargs, delimiter):
        """Test that various invisible Unicode characters work as literal delimiters."""
        splitter = FixedRecursiveCharacterTextSplitter(
            fixed_separator=delimiter,
            **base_splitter_kwargs,
        )

        text = f"chunk1{delimiter}chunk2{delimiter}chunk3"
        result = splitter.split_text(text)

        assert len(result) == 3
        assert result == ["chunk1", "chunk2", "chunk3"]

    @pytest.mark.parametrize(
        ("escaped_char", "literal_char"),
        [
            pytest.param("\\n", "\n", id="newline"),
            pytest.param("\\t", "\t", id="tab"),
        ],
    )
    def test_escaped_chars_still_work(self, base_splitter_kwargs, escaped_char, literal_char):
        """Escaped characters should still be decoded properly."""
        splitter = FixedRecursiveCharacterTextSplitter(
            fixed_separator=escaped_char,
            **base_splitter_kwargs,
        )

        text = f"chunk1{literal_char}chunk2{literal_char}chunk3"
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
