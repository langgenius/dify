"""Functionality for splitting text."""

from __future__ import annotations

from typing import Any, Optional

from core.model_manager import ModelInstance
from core.model_runtime.model_providers.__base.tokenizers.gpt2_tokenizer import GPT2Tokenizer
from core.rag.splitter.text_splitter import (
    TS,
    Collection,
    Literal,
    RecursiveCharacterTextSplitter,
    Set,
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

        return cls(length_function=_character_encoder, **kwargs)


class FixedRecursiveCharacterTextSplitter(EnhanceRecursiveCharacterTextSplitter):
    def __init__(self, fixed_separator: str = "\n\n", separators: Optional[list[str]] = None, **kwargs: Any):
        """Create a new TextSplitter."""
        super().__init__(**kwargs)
        self._fixed_separator = fixed_separator
        self._separators = separators or ["\n\n", "\n", " ", ""]

    def split_text(self, text: str) -> list[str]:
        """Split incoming text and return chunks using the specified algorithm."""
        if self._fixed_separator:
            chunks = text.split(self._fixed_separator)
        else:
            chunks = [text]

        final_chunks = []
        for chunk in chunks:
            if not chunk.strip():
                continue

            chunk_lengths = self._length_function([chunk])
            chunk_length = chunk_lengths[0] if chunk_lengths else 0

            if chunk_length <= self._chunk_size:
                # NO -> Push the chunk into the list of chunks to save
                final_chunks.append(chunk)
            else:
                # YES -> Split current chunk on space character and reconstruct
                final_chunks.extend(self._reconstruct_chunk_by_words(chunk))

        return final_chunks

    def _reconstruct_chunk_by_words(self, text: str) -> list[str]:
        """
        Reconstruct oversized chunk by splitting on spaces and rebuilding word by word.
        """
        words = text.split(" ")
        chunks = []
        current_chunk = ""

        for word in words:
            if not word:
                continue

            if current_chunk:
                concatenee = " " + word
            else:
                concatenee = word

            potential_chunk = current_chunk + concatenee
            potential_lengths = self._length_function([potential_chunk])
            potential_length = potential_lengths[0] if potential_lengths else 0

            if potential_length > self._chunk_size:
                # YES -> push the chunk in the list of chunks to save and start a new one
                if current_chunk:  # Don't add empty chunks
                    chunks.append(current_chunk)
                current_chunk = word  # Start new chunk with just the word
            else:
                current_chunk = current_chunk + concatenee

        if current_chunk:
            chunks.append(current_chunk)

        return chunks

    def recursive_split_text(self, text: str) -> list[str]:
        return self.split_text(text)
