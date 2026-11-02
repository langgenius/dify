"""Regression tests for split_text_on_tokens termination guarantees.

`split_text_on_tokens` advances the window by
`tokens_per_chunk - chunk_overlap` per iteration. When `chunk_overlap` equals
(or exceeds) `tokens_per_chunk`, or `tokens_per_chunk` is not positive, the
window never advances and the function loops forever while appending decoded
fragments, hanging the caller and growing memory without bound.
"""

import pytest

from core.rag.splitter.text_splitter import Tokenizer, split_text_on_tokens


def _char_tokenizer(tokens_per_chunk: int, chunk_overlap: int) -> Tokenizer:
    """Treat every character as one token so expectations stay deterministic."""
    return Tokenizer(
        chunk_overlap=chunk_overlap,
        tokens_per_chunk=tokens_per_chunk,
        decode=lambda token_ids: "".join(chr(token_id) for token_id in token_ids),
        encode=lambda text: [ord(char) for char in text],
    )


def test_chunk_overlap_equal_to_tokens_per_chunk_raises():
    tokenizer = _char_tokenizer(tokens_per_chunk=8, chunk_overlap=8)
    with pytest.raises(ValueError, match="strictly smaller"):
        split_text_on_tokens(text="hello world", tokenizer=tokenizer)


def test_chunk_overlap_greater_than_tokens_per_chunk_raises():
    tokenizer = _char_tokenizer(tokens_per_chunk=8, chunk_overlap=10)
    with pytest.raises(ValueError, match="strictly smaller"):
        split_text_on_tokens(text="hello world", tokenizer=tokenizer)


def test_non_positive_tokens_per_chunk_raises():
    with pytest.raises(ValueError, match="positive"):
        split_text_on_tokens(text="hello world", tokenizer=_char_tokenizer(tokens_per_chunk=0, chunk_overlap=0))


def test_valid_overlap_smaller_than_tokens_per_chunk_terminates():
    text = "abcdefghij"
    chunks = split_text_on_tokens(text=text, tokenizer=_char_tokenizer(tokens_per_chunk=6, chunk_overlap=2))
    assert chunks == ["abcdef", "efghij", "ij"]


def test_shorter_than_one_window_returns_single_chunk():
    chunks = split_text_on_tokens(text="abc", tokenizer=_char_tokenizer(tokens_per_chunk=10, chunk_overlap=3))
    assert chunks == ["abc"]
