from __future__ import annotations

import copy
import logging
import re
from abc import ABC, abstractmethod
from collections.abc import Callable, Collection, Iterable, Sequence, Set
from dataclasses import dataclass
from typing import (
    Any,
    Literal,
    Optional,
    TypedDict,
    TypeVar,
    Union,
)

from core.rag.models.document import BaseDocumentTransformer, Document

logger = logging.getLogger(__name__)

TS = TypeVar("TS", bound="TextSplitter")


def _split_text_with_regex(
        text: str, separator: str, keep_separator: bool
) -> list[str]:
    # Now that we have the separator, split the text
    if separator:
        if keep_separator:
            # The parentheses in the pattern keep the delimiters in the result.
            _splits = re.split(f"({re.escape(separator)})", text)
            splits = [_splits[i - 1] + _splits[i] for i in range(1, len(_splits), 2)]
            if len(_splits) % 2 != 0:
                splits += _splits[-1:]
        else:
            splits = re.split(separator, text)
    else:
        splits = list(text)
    return [s for s in splits if (s != "" and s != '\n')]


class TextSplitter(BaseDocumentTransformer, ABC):
    """Interface for splitting text into chunks."""

    def __init__(
            self,
            chunk_size: int = 4000,
            chunk_overlap: int = 200,
            length_function: Callable[[str], int] = len,
            keep_separator: bool = False,
            add_start_index: bool = False,
    ) -> None:
        """Create a new TextSplitter.

        Args:
            chunk_size: Maximum size of chunks to return
            chunk_overlap: Overlap in characters between chunks
            length_function: Function that measures the length of given chunks
            keep_separator: Whether to keep the separator in the chunks
            add_start_index: If `True`, includes chunk's start index in metadata
        """
        if chunk_overlap > chunk_size:
            raise ValueError(
                f"Got a larger chunk overlap ({chunk_overlap}) than chunk size "
                f"({chunk_size}), should be smaller."
            )
        self._chunk_size = chunk_size
        self._chunk_overlap = chunk_overlap
        self._length_function = length_function
        self._keep_separator = keep_separator
        self._add_start_index = add_start_index

    @abstractmethod
    def split_text(self, text: str) -> list[str]:
        """Split text into multiple components."""

    def create_documents(
            self, texts: list[str], metadatas: Optional[list[dict]] = None
    ) -> list[Document]:
        """Create documents from a list of texts."""
        _metadatas = metadatas or [{}] * len(texts)
        documents = []
        for i, text in enumerate(texts):
            index = -1
            for chunk in self.split_text(text):
                metadata = copy.deepcopy(_metadatas[i])
                if self._add_start_index:
                    index = text.find(chunk, index + 1)
                    metadata["start_index"] = index
                new_doc = Document(page_content=chunk, metadata=metadata)
                documents.append(new_doc)
        return documents

    def split_documents(self, documents: Iterable[Document]) -> list[Document]:
        """Split documents."""
        texts, metadatas = [], []
        for doc in documents:
            texts.append(doc.page_content)
            metadatas.append(doc.metadata)
        return self.create_documents(texts, metadatas=metadatas)

    def _join_docs(self, docs: list[str], separator: str) -> Optional[str]:
        text = separator.join(docs)
        text = text.strip()
        if text == "":
            return None
        else:
            return text

    def _merge_splits(self, splits: Iterable[str], separator: str, lengths: list[int]) -> list[str]:
        # We now want to combine these smaller pieces into medium size
        # chunks to send to the LLM.
        separator_len = self._length_function(separator)

        docs = []
        current_doc: list[str] = []
        total = 0
        index = 0
        for d in splits:
            _len = lengths[index]
            if (
                    total + _len + (separator_len if len(current_doc) > 0 else 0)
                    > self._chunk_size
            ):
                if total > self._chunk_size:
                    logger.warning(
                        f"Created a chunk of size {total}, "
                        f"which is longer than the specified {self._chunk_size}"
                    )
                if len(current_doc) > 0:
                    doc = self._join_docs(current_doc, separator)
                    if doc is not None:
                        docs.append(doc)
                    # Keep on popping if:
                    # - we have a larger chunk than in the chunk overlap
                    # - or if we still have any chunks and the length is long
                    while total > self._chunk_overlap or (
                            total + _len + (separator_len if len(current_doc) > 0 else 0)
                            > self._chunk_size
                            and total > 0
                    ):
                        total -= self._length_function(current_doc[0]) + (
                            separator_len if len(current_doc) > 1 else 0
                        )
                        current_doc = current_doc[1:]
            current_doc.append(d)
            total += _len + (separator_len if len(current_doc) > 1 else 0)
            index += 1
        doc = self._join_docs(current_doc, separator)
        if doc is not None:
            docs.append(doc)
        return docs

    @classmethod
    def from_huggingface_tokenizer(cls, tokenizer: Any, **kwargs: Any) -> TextSplitter:
        """Text splitter that uses HuggingFace tokenizer to count length."""
        try:
            from transformers import PreTrainedTokenizerBase

            if not isinstance(tokenizer, PreTrainedTokenizerBase):
                raise ValueError(
                    "Tokenizer received was not an instance of PreTrainedTokenizerBase"
                )

            def _huggingface_tokenizer_length(text: str) -> int:
                return len(tokenizer.encode(text))

        except ImportError:
            raise ValueError(
                "Could not import transformers python package. "
                "Please install it with `pip install transformers`."
            )
        return cls(length_function=_huggingface_tokenizer_length, **kwargs)

    @classmethod
    def from_tiktoken_encoder(
            cls: type[TS],
            encoding_name: str = "gpt2",
            model_name: Optional[str] = None,
            allowed_special: Union[Literal["all"], Set[str]] = set(),
            disallowed_special: Union[Literal["all"], Collection[str]] = "all",
            **kwargs: Any,
    ) -> TS:
        """Text splitter that uses tiktoken encoder to count length."""
        try:
            import tiktoken
        except ImportError:
            raise ImportError(
                "Could not import tiktoken python package. "
                "This is needed in order to calculate max_tokens_for_prompt. "
                "Please install it with `pip install tiktoken`."
            )

        if model_name is not None:
            enc = tiktoken.encoding_for_model(model_name)
        else:
            enc = tiktoken.get_encoding(encoding_name)

        def _tiktoken_encoder(text: str) -> int:
            return len(
                enc.encode(
                    text,
                    allowed_special=allowed_special,
                    disallowed_special=disallowed_special,
                )
            )

        if issubclass(cls, TokenTextSplitter):
            extra_kwargs = {
                "encoding_name": encoding_name,
                "model_name": model_name,
                "allowed_special": allowed_special,
                "disallowed_special": disallowed_special,
            }
            kwargs = {**kwargs, **extra_kwargs}

        return cls(length_function=_tiktoken_encoder, **kwargs)

    def transform_documents(
            self, documents: Sequence[Document], **kwargs: Any
    ) -> Sequence[Document]:
        """Transform sequence of documents by splitting them."""
        return self.split_documents(list(documents))

    async def atransform_documents(
            self, documents: Sequence[Document], **kwargs: Any
    ) -> Sequence[Document]:
        """Asynchronously transform a sequence of documents by splitting them."""
        raise NotImplementedError


class CharacterTextSplitter(TextSplitter):
    """Splitting text that looks at characters."""

    def __init__(self, separator: str = "\n\n", **kwargs: Any) -> None:
        """Create a new TextSplitter."""
        super().__init__(**kwargs)
        self._separator = separator

    def split_text(self, text: str) -> list[str]:
        """Split incoming text and return chunks."""
        # First we naively split the large input into a bunch of smaller ones.
        splits = _split_text_with_regex(text, self._separator, self._keep_separator)
        _separator = "" if self._keep_separator else self._separator
        _good_splits_lengths = []  # cache the lengths of the splits
        for split in splits:
            _good_splits_lengths.append(self._length_function(split))
        return self._merge_splits(splits, _separator, _good_splits_lengths)


class LineType(TypedDict):
    """Line type as typed dict."""

    metadata: dict[str, str]
    content: str


class HeaderType(TypedDict):
    """Header type as typed dict."""

    level: int
    name: str
    data: str


class MarkdownHeaderTextSplitter:
    """Splitting markdown files based on specified headers."""

    def __init__(
            self, headers_to_split_on: list[tuple[str, str]], return_each_line: bool = False
    ):
        """Create a new MarkdownHeaderTextSplitter.

        Args:
            headers_to_split_on: Headers we want to track
            return_each_line: Return each line w/ associated headers
        """
        # Output line-by-line or aggregated into chunks w/ common headers
        self.return_each_line = return_each_line
        # Given the headers we want to split on,
        # (e.g., "#, ##, etc") order by length
        self.headers_to_split_on = sorted(
            headers_to_split_on, key=lambda split: len(split[0]), reverse=True
        )

    def aggregate_lines_to_chunks(self, lines: list[LineType]) -> list[Document]:
        """Combine lines with common metadata into chunks
        Args:
            lines: Line of text / associated header metadata
        """
        aggregated_chunks: list[LineType] = []

        for line in lines:
            if (
                    aggregated_chunks
                    and aggregated_chunks[-1]["metadata"] == line["metadata"]
            ):
                # If the last line in the aggregated list
                # has the same metadata as the current line,
                # append the current content to the last lines's content
                aggregated_chunks[-1]["content"] += "  \n" + line["content"]
            else:
                # Otherwise, append the current line to the aggregated list
                aggregated_chunks.append(line)

        return [
            Document(page_content=chunk["content"], metadata=chunk["metadata"])
            for chunk in aggregated_chunks
        ]

    def split_text(self, text: str) -> list[Document]:
        """Split markdown file
        Args:
            text: Markdown file"""

        # Split the input text by newline character ("\n").
        lines = text.split("\n")
        # Final output
        lines_with_metadata: list[LineType] = []
        # Content and metadata of the chunk currently being processed
        current_content: list[str] = []
        current_metadata: dict[str, str] = {}
        # Keep track of the nested header structure
        # header_stack: List[Dict[str, Union[int, str]]] = []
        header_stack: list[HeaderType] = []
        initial_metadata: dict[str, str] = {}

        for line in lines:
            stripped_line = line.strip()
            # Check each line against each of the header types (e.g., #, ##)
            for sep, name in self.headers_to_split_on:
                # Check if line starts with a header that we intend to split on
                if stripped_line.startswith(sep) and (
                        # Header with no text OR header is followed by space
                        # Both are valid conditions that sep is being used a header
                        len(stripped_line) == len(sep)
                        or stripped_line[len(sep)] == " "
                ):
                    # Ensure we are tracking the header as metadata
                    if name is not None:
                        # Get the current header level
                        current_header_level = sep.count("#")

                        # Pop out headers of lower or same level from the stack
                        while (
                                header_stack
                                and header_stack[-1]["level"] >= current_header_level
                        ):
                            # We have encountered a new header
                            # at the same or higher level
                            popped_header = header_stack.pop()
                            # Clear the metadata for the
                            # popped header in initial_metadata
                            if popped_header["name"] in initial_metadata:
                                initial_metadata.pop(popped_header["name"])

                        # Push the current header to the stack
                        header: HeaderType = {
                            "level": current_header_level,
                            "name": name,
                            "data": stripped_line[len(sep):].strip(),
                        }
                        header_stack.append(header)
                        # Update initial_metadata with the current header
                        initial_metadata[name] = header["data"]

                    # Add the previous line to the lines_with_metadata
                    # only if current_content is not empty
                    if current_content:
                        lines_with_metadata.append(
                            {
                                "content": "\n".join(current_content),
                                "metadata": current_metadata.copy(),
                            }
                        )
                        current_content.clear()

                    break
            else:
                if stripped_line:
                    current_content.append(stripped_line)
                elif current_content:
                    lines_with_metadata.append(
                        {
                            "content": "\n".join(current_content),
                            "metadata": current_metadata.copy(),
                        }
                    )
                    current_content.clear()

            current_metadata = initial_metadata.copy()

        if current_content:
            lines_with_metadata.append(
                {"content": "\n".join(current_content), "metadata": current_metadata}
            )

        # lines_with_metadata has each line with associated header metadata
        # aggregate these into chunks based on common metadata
        if not self.return_each_line:
            return self.aggregate_lines_to_chunks(lines_with_metadata)
        else:
            return [
                Document(page_content=chunk["content"], metadata=chunk["metadata"])
                for chunk in lines_with_metadata
            ]


# should be in newer Python versions (3.10+)
# @dataclass(frozen=True, kw_only=True, slots=True)
@dataclass(frozen=True)
class Tokenizer:
    chunk_overlap: int
    tokens_per_chunk: int
    decode: Callable[[list[int]], str]
    encode: Callable[[str], list[int]]


def split_text_on_tokens(*, text: str, tokenizer: Tokenizer) -> list[str]:
    """Split incoming text and return chunks using tokenizer."""
    splits: list[str] = []
    input_ids = tokenizer.encode(text)
    start_idx = 0
    cur_idx = min(start_idx + tokenizer.tokens_per_chunk, len(input_ids))
    chunk_ids = input_ids[start_idx:cur_idx]
    while start_idx < len(input_ids):
        splits.append(tokenizer.decode(chunk_ids))
        start_idx += tokenizer.tokens_per_chunk - tokenizer.chunk_overlap
        cur_idx = min(start_idx + tokenizer.tokens_per_chunk, len(input_ids))
        chunk_ids = input_ids[start_idx:cur_idx]
    return splits


class TokenTextSplitter(TextSplitter):
    """Splitting text to tokens using model tokenizer."""

    def __init__(
            self,
            encoding_name: str = "gpt2",
            model_name: Optional[str] = None,
            allowed_special: Union[Literal["all"], Set[str]] = set(),
            disallowed_special: Union[Literal["all"], Collection[str]] = "all",
            **kwargs: Any,
    ) -> None:
        """Create a new TextSplitter."""
        super().__init__(**kwargs)
        try:
            import tiktoken
        except ImportError:
            raise ImportError(
                "Could not import tiktoken python package. "
                "This is needed in order to for TokenTextSplitter. "
                "Please install it with `pip install tiktoken`."
            )

        if model_name is not None:
            enc = tiktoken.encoding_for_model(model_name)
        else:
            enc = tiktoken.get_encoding(encoding_name)
        self._tokenizer = enc
        self._allowed_special = allowed_special
        self._disallowed_special = disallowed_special

    def split_text(self, text: str) -> list[str]:
        def _encode(_text: str) -> list[int]:
            return self._tokenizer.encode(
                _text,
                allowed_special=self._allowed_special,
                disallowed_special=self._disallowed_special,
            )

        tokenizer = Tokenizer(
            chunk_overlap=self._chunk_overlap,
            tokens_per_chunk=self._chunk_size,
            decode=self._tokenizer.decode,
            encode=_encode,
        )

        return split_text_on_tokens(text=text, tokenizer=tokenizer)


class RecursiveCharacterTextSplitter(TextSplitter):
    """Splitting text by recursively look at characters.

    Recursively tries to split by different characters to find one
    that works.
    """

    def __init__(
            self,
            separators: Optional[list[str]] = None,
            keep_separator: bool = True,
            **kwargs: Any,
    ) -> None:
        """Create a new TextSplitter."""
        super().__init__(keep_separator=keep_separator, **kwargs)
        self._separators = separators or ["\n\n", "\n", " ", ""]

    def _split_text(self, text: str, separators: list[str]) -> list[str]:
        final_chunks = []
        separator = separators[-1]
        new_separators = []

        for i, _s in enumerate(separators):
            if _s == "":
                separator = _s
                break
            if re.search(_s, text):
                separator = _s
                new_separators = separators[i + 1:]
                break

        splits = _split_text_with_regex(text, separator, self._keep_separator)
        _good_splits = []
        _good_splits_lengths = []  # cache the lengths of the splits
        _separator = "" if self._keep_separator else separator

        for s in splits:
            s_len = self._length_function(s)
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
                    other_info = self._split_text(s, new_separators)
                    final_chunks.extend(other_info)

        if _good_splits:
            merged_text = self._merge_splits(_good_splits, _separator, _good_splits_lengths)
            final_chunks.extend(merged_text)

        return final_chunks

    def split_text(self, text: str) -> list[str]:
        return self._split_text(text, self._separators)
