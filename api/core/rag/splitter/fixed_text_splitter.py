"""Functionality for splitting text."""

from __future__ import annotations

import codecs
import re
from collections.abc import Sequence
from collections.abc import Set as AbstractSet
from typing import Any, Literal, override

from core.model_manager import ModelInstance
from core.rag.splitter.text_splitter import RecursiveCharacterTextSplitter
from graphon.model_runtime.model_providers.base.tokenizers.gpt2_tokenizer import GPT2Tokenizer


def _reattach_trailing_separator(chunks: Sequence[str], trailing_separator: str) -> list[str]:
    """Re-attach ``trailing_separator`` to all but the last merged chunk.

    The base ``_join_docs`` strips outer whitespace from each merged chunk, which
    silently drops the trailing space (or other separator) when ``keep_separator``
    is True and the chunk came from a space-separated split. To keep the original
    text reconstructable, we re-attach the requested trailing separator here.
    Returns ``chunks`` unchanged when ``trailing_separator`` is empty.
    """
    if not trailing_separator or len(chunks) <= 1:
        return list(chunks)
    return [c + trailing_separator for c in chunks[:-1]] + [chunks[-1]]


class EnhanceRecursiveCharacterTextSplitter(RecursiveCharacterTextSplitter):
    """
    This class is used to implement from_gpt2_encoder, to prevent using of tiktoken
    """

    @classmethod
    def from_encoder[T: EnhanceRecursiveCharacterTextSplitter](
        cls: type[T],
        embedding_model_instance: ModelInstance | None,
        allowed_special: Literal["all"] | AbstractSet[str] = frozenset(),
        disallowed_special: Literal["all"] | AbstractSet[str] = "all",
        **kwargs: Any,
    ) -> T:
        def _token_encoder(texts: list[str]) -> list[int]:
            if not texts:
                return []

            if embedding_model_instance:
                return embedding_model_instance.get_text_embedding_num_tokens(texts=texts)
            else:
                return [GPT2Tokenizer.get_num_tokens(text) for text in texts]

        def _character_encoder(texts: list[str]) -> list[int]:
            if not texts:
                return []

            return [len(text) for text in texts]

        _ = _token_encoder  # kept for future token-length wiring
        return cls(length_function=_character_encoder, **kwargs)


class FixedRecursiveCharacterTextSplitter(EnhanceRecursiveCharacterTextSplitter):
    def __init__(self, fixed_separator: str = "\n\n", separators: list[str] | None = None, **kwargs: Any):
        """Create a new TextSplitter."""
        super().__init__(**kwargs)
        self._fixed_separator = codecs.decode(fixed_separator, "unicode_escape")
        self._separators = separators or ["\n\n", "\n", "。", ". ", " ", ""]

    @override
    def split_text(self, text: str) -> list[str]:
        """Split incoming text and return chunks."""
        if self._fixed_separator:
            chunks = text.split(self._fixed_separator)
        else:
            chunks = [text]

        final_chunks = []
        chunks_lengths = self._length_function(chunks)
        for chunk, chunk_length in zip(chunks, chunks_lengths):
            if chunk_length > self._chunk_size:
                final_chunks.extend(self.recursive_split_text(chunk))
            else:
                final_chunks.append(chunk)

        return final_chunks

    def recursive_split_text(self, text: str) -> list[str]:
        """Split incoming text and return chunks."""

        final_chunks = []
        separator = self._separators[-1]
        new_separators = []

        for i, _s in enumerate(self._separators):
            if _s == "":
                separator = _s
                break
            if _s in text:
                separator = _s
                new_separators = self._separators[i + 1 :]
                break

        # Now that we have the separator, split the text
        if separator:
            if separator == " ":
                if self._keep_separator:
                    # Keep one space at the tail of every split except the last so the
                    # original text can be reconstructed when the merges below use the
                    # empty ``_separator``. ``str.split`` collapses runs of whitespace
                    # into the splits, so we instead walk the source string and emit
                    # a single trailing space at every position where one existed.
                    splits: list[str] = []
                    tail = text
                    while True:
                        idx = tail.find(" ")
                        if idx == -1:
                            splits.append(tail)
                            break
                        splits.append(tail[: idx + 1])
                        tail = tail[idx + 1 :]
                else:
                    splits = re.split(r" +", text)
            else:
                splits = text.split(separator)
                if self._keep_separator:
                    splits = [s + separator for s in splits[:-1]] + splits[-1:]
        else:
            splits = list(text)
        if separator == "\n":
            splits = [s for s in splits if s != ""]
        else:
            splits = [s for s in splits if (s not in {"", "\n"})]
        _good_splits = []
        _good_splits_lengths = []  # cache the lengths of the splits
        _separator = "" if self._keep_separator else separator
        # When ``keep_separator`` is True we want to preserve the trailing
        # separator on every merged chunk except the last so that concatenating
        # the chunks reproduces the original text. The base ``_join_docs``
        # strips outer whitespace, so we remember the requested trailing
        # separator here and re-attach it after the merge below.
        _trailing_separator = separator if self._keep_separator else ""
        s_lens = self._length_function(splits)
        if separator != "":
            for s, s_len in zip(splits, s_lens):
                if s_len < self._chunk_size:
                    _good_splits.append(s)
                    _good_splits_lengths.append(s_len)
                else:
                    if _good_splits:
                        merged_text = self._merge_splits(_good_splits, _separator, _good_splits_lengths)
                        final_chunks.extend(_reattach_trailing_separator(merged_text, _trailing_separator))
                        _good_splits = []
                        _good_splits_lengths = []
                    if not new_separators:
                        final_chunks.append(s)
                    else:
                        other_info = self._split_text(s, new_separators)
                        final_chunks.extend(other_info)

            if _good_splits:
                merged_text = self._merge_splits(_good_splits, _separator, _good_splits_lengths)
                final_chunks.extend(_reattach_trailing_separator(merged_text, _trailing_separator))
        else:
            current_part = ""
            current_length = 0
            overlap_part = ""
            overlap_part_length = 0
            for s, s_len in zip(splits, s_lens):
                if current_length + s_len <= self._chunk_size - self._chunk_overlap:
                    current_part += s
                    current_length += s_len
                elif current_length + s_len <= self._chunk_size:
                    current_part += s
                    current_length += s_len
                    overlap_part += s
                    overlap_part_length += s_len
                else:
                    final_chunks.append(current_part)
                    current_part = overlap_part + s
                    current_length = s_len + overlap_part_length
                    overlap_part = ""
                    overlap_part_length = 0
            if current_part:
                final_chunks.append(current_part)

        return final_chunks
