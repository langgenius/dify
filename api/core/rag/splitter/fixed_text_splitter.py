"""Functionality for splitting text."""

from __future__ import annotations

import re
from typing import Any, Optional

from core.model_manager import ModelInstance
from core.model_runtime.model_providers.__base.tokenizers.gpt2_tokenzier import GPT2Tokenizer
from core.rag.splitter.text_splitter import (
    TS,
    Collection,
    Literal,
    RecursiveCharacterTextSplitter,
    Set,
    TokenTextSplitter,
    Union,
)


class EnhanceRecursiveCharacterTextSplitter(RecursiveCharacterTextSplitter):
    """
    This class is used to implement from_gpt2_encoder, to prevent using of tiktoken
    """

    @classmethod
    def from_encoder(
        cls: type[TS],
        embedding_model_instance: Optional[ModelInstance],
        allowed_special: Union[Literal["all"], Set[str]] = set(),  # noqa: UP037
        disallowed_special: Union[Literal["all"], Collection[str]] = "all",  # noqa: UP037
        **kwargs: Any,
    ):
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

        if issubclass(cls, TokenTextSplitter):
            extra_kwargs = {
                "model_name": embedding_model_instance.model if embedding_model_instance else "gpt2",
                "allowed_special": allowed_special,
                "disallowed_special": disallowed_special,
            }
            kwargs = {**kwargs, **extra_kwargs}

        return cls(length_function=_character_encoder, **kwargs)


class FixedRecursiveCharacterTextSplitter(EnhanceRecursiveCharacterTextSplitter):
    # Regex special characters for detection
    _regex_chars = ["(", ")", "[", "]", "{", "}", "*", "+", "?", "|", "\\", ".", "^", "$"]

    def __init__(self, fixed_separator: str = "\n\n", separators: Optional[list[str]] = None, **kwargs: Any):
        """Create a new TextSplitter."""
        super().__init__(**kwargs)
        self._fixed_separator = fixed_separator
        self._separators = separators or ["\n\n", "\n", " ", ""]

    def split_text(self, text: str) -> list[str]:
        """Split incoming text and return chunks."""
        if self._fixed_separator:
            # Check if the separator contains regex special characters
            is_regex = any(char in self._fixed_separator for char in self._regex_chars)

            if is_regex:
                # For regex separators, use finditer to find all matches and split manually
                chunks = self._split_with_regex_manual(text, self._fixed_separator)
                # Handle large chunks at sentence boundaries while preserving regex structure
                final_chunks = []
                for chunk in chunks:
                    if len(chunk) > self._chunk_size:
                        final_chunks.extend(self._split_large_regex_chunk(chunk))
                    else:
                        final_chunks.append(chunk)
                return final_chunks
            else:
                # Use regular string splitting for simple separators
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
                splits = text.split()
            else:
                splits = text.split(separator)
                splits = [item + separator if i < len(splits) else item for i, item in enumerate(splits)]
        else:
            splits = list(text)
        splits = [s for s in splits if (s not in {"", "\n"})]
        _good_splits = []
        _good_splits_lengths = []  # cache the lengths of the splits
        _separator = "" if self._keep_separator else separator
        s_lens = self._length_function(splits)
        if separator != "":
            for s, s_len in zip(splits, s_lens):
                if s_len < self._chunk_size:
                    _good_splits.append(s)
                    _good_splits_lengths.append(s_len)
                else:
                    if _good_splits:
                        merged_text = self._merge_splits(_good_splits, _separator, _good_splits_lengths)
                        final_chunks.extend(merged_text)
                        _good_splits = []
                        _good_splits_lengths = []
                    if not new_separators:
                        final_chunks.append(s)
                    else:
                        # For regex separators, use custom splitting to preserve structure
                        is_regex = any(char in self._fixed_separator for char in self._regex_chars)
                        if is_regex:
                            other_info = self._split_large_regex_chunk(s)
                            final_chunks.extend(other_info)
                        else:
                            other_info = self._split_text(s, new_separators)
                            final_chunks.extend(other_info)

            if _good_splits:
                merged_text = self._merge_splits(_good_splits, _separator, _good_splits_lengths)
                final_chunks.extend(merged_text)
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

    def _split_with_regex_manual(self, text: str, pattern: str) -> list[str]:
        """Manually split text using regex pattern by finding all matches."""
        # Find all matches
        matches = list(re.finditer(pattern, text))

        if not matches:
            return [text]

        chunks = []
        last_end = 0

        for i, match in enumerate(matches):
            # Get the matched separator (e.g., "一、", "二、")
            separator = match.group(0)

            # Find the end of this section (next match or end of text)
            next_start = len(text)
            if i + 1 < len(matches):
                next_start = matches[i + 1].start()

            # Create a chunk that includes the separator and all content up to next separator
            chunk_content = text[match.start() : next_start].strip()
            if chunk_content:
                chunks.append(chunk_content)

            last_end = next_start

        # Add any remaining text after the last match
        if last_end < len(text):
            remaining = text[last_end:].strip()
            if remaining:
                chunks.append(remaining)

        return chunks

    def _split_large_regex_chunk(self, chunk: str) -> list[str]:
        """Split large regex chunks at sentence boundaries while preserving structure."""
        # Split at sentence boundaries (。！？.!?)
        sentence_pattern = r"([。！？.!?])"
        sentences = re.split(sentence_pattern, chunk)

        # Rejoin sentences with their punctuation
        sentences = ["".join(sentences[i : i + 2]) for i in range(0, len(sentences) - 1, 2)]
        if len(sentences) % 2 == 1:
            sentences.append(sentences[-1])

        # Filter out empty sentences
        sentences = [s.strip() for s in sentences if s.strip()]

        # Group sentences into chunks that fit within chunk_size
        chunks = []
        current_chunk = ""
        current_length = 0

        for sentence in sentences:
            sentence_length = len(sentence)

            # If adding this sentence would exceed chunk_size, start a new chunk
            if current_length + sentence_length > self._chunk_size and current_chunk:
                chunks.append(current_chunk.strip())
                current_chunk = sentence
                current_length = sentence_length
            else:
                current_chunk += sentence
                current_length += sentence_length

        # Add the last chunk if it exists
        if current_chunk:
            chunks.append(current_chunk.strip())

        return chunks
