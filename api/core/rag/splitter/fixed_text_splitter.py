"""Functionality for splitting text."""

from __future__ import annotations

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
    def __init__(self, fixed_separator: str = "\n\n", separators: Optional[list[str]] = None, **kwargs: Any):
        """Create a new TextSplitter."""
        super().__init__(**kwargs)
        self._fixed_separator = fixed_separator
        self._separators = separators or ["\n\n", "\n", " ", ""]

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
        # 'separator' here will hold the chosen separator for the current iteration
        separator_to_use = self._separators[-1] # Default to the last separator
        remaining_separators_for_recursion = []

        for i, _s in enumerate(self._separators):
            if _s == "":
                separator_to_use = _s
                # For character splitting, typically no finer user-defined separators
                # Or, if "" is not last, remaining_separators_for_recursion could be self._separators[i+1:]
                # For simplicity of this logic, if "" is chosen, assume it's the finest.
                remaining_separators_for_recursion = [] 
                break
            if _s in text:
                separator_to_use = _s
                remaining_separators_for_recursion = self._separators[i + 1 :]
                break
        
        # Now that we have the separator_to_use, split the text
        splits: list[str]
        if separator_to_use:
            # --- CHANGE 1: Use text.split(separator_to_use) consistently ---
            # Removed the special `if separator_to_use == " ": splits = text.split()`
            splits = text.split(separator_to_use)
        else: # separator_to_use is "" (empty string), so split by character
            splits = list(text)
        
        # --- CHANGE 2: REMOVE the aggressive filter ---
        # The following line is removed:
        # splits = [s for s in splits if (s not in {"", "\n"})]
        
        _good_splits = []
        _good_splits_lengths = []  # cache the lengths of the splits
        
        # --- CHANGE 3: Correct the logic for determining the separator for merging ---
        # 'separator_to_use' holds the actual separator string used for splitting.
        _separator_for_merging = separator_to_use if self._keep_separator else ""
        
        s_lens = self._length_function(splits)

        # This outer if/else distinguishes behavior based on whether a non-empty separator was found
        # or if it's character-level splitting. This structure is preserved from your "Neuer Code".
        if separator_to_use != "": 
            for s, s_len in zip(splits, s_lens):
                if s_len < self._chunk_size:
                    _good_splits.append(s)
                    _good_splits_lengths.append(s_len)
                else:
                    if _good_splits:
                        merged_text = self._merge_splits(_good_splits, _separator_for_merging, _good_splits_lengths)
                        final_chunks.extend(merged_text)
                        _good_splits = []
                        _good_splits_lengths = []
                    
                    # If the current split 's' is still too long, try splitting it further
                    # with the remaining finer separators.
                    if not remaining_separators_for_recursion: # No more finer separators to try
                        final_chunks.append(s) # Add as is (potentially oversized)
                    else:
                        # `self._split_text` is a method from the base RecursiveCharacterTextSplitter
                        # which handles splitting with a given list of separators.
                        other_info = self._split_text(s, remaining_separators_for_recursion)
                        final_chunks.extend(other_info)

            if _good_splits:
                merged_text = self._merge_splits(_good_splits, _separator_for_merging, _good_splits_lengths)
                final_chunks.extend(merged_text)
        else: # This block handles the case where separator_to_use == "" (character splitting)
              # This logic is from your "Neuer Code" and is largely preserved.
              # Note: The `_separator_for_merging` (which would be "" if separator_to_use is "")
              # is not directly used by this custom character accumulation logic.
            current_part = ""
            current_length = 0
            overlap_part = ""
            overlap_part_length = 0
            for s, s_len in zip(splits, s_lens): # 'splits' are individual characters here
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