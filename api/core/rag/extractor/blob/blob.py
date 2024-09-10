"""Schema for Blobs and Blob Loaders.

The goal is to facilitate decoupling of content loading from content parsing code.

In addition, content loading code should provide a lazy loading interface by default.
"""
from __future__ import annotations

import contextlib
import mimetypes
from abc import ABC, abstractmethod
from collections.abc import Generator, Iterable, Mapping
from io import BufferedReader, BytesIO
from pathlib import PurePath
from typing import Any, Optional, Union

from pydantic import BaseModel, ConfigDict, model_validator

PathLike = Union[str, PurePath]


class Blob(BaseModel):
    """A blob is used to represent raw data by either reference or value.

    Provides an interface to materialize the blob in different representations, and
    help to decouple the development of data loaders from the downstream parsing of
    the raw data.

    Inspired by: https://developer.mozilla.org/en-US/docs/Web/API/Blob
    """

    data: Union[bytes, str, None] = None  # Raw data
    mimetype: Optional[str] = None  # Not to be confused with a file extension
    encoding: str = "utf-8"  # Use utf-8 as default encoding, if decoding to string
    # Location where the original content was found
    # Represent location on the local file system
    # Useful for situations where downstream code assumes it must work with file paths
    # rather than in-memory content.
    path: Optional[PathLike] = None
    model_config = ConfigDict(arbitrary_types_allowed=True, frozen=True)

    @property
    def source(self) -> Optional[str]:
        """The source location of the blob as string if known otherwise none."""
        return str(self.path) if self.path else None

    @model_validator(mode="before")
    @classmethod
    def check_blob_is_valid(cls, values: Mapping[str, Any]) -> Mapping[str, Any]:
        """Verify that either data or path is provided."""
        if "data" not in values and "path" not in values:
            raise ValueError("Either data or path must be provided")
        return values

    def as_string(self) -> str:
        """Read data as a string."""
        if self.data is None and self.path:
            with open(str(self.path), encoding=self.encoding) as f:
                return f.read()
        elif isinstance(self.data, bytes):
            return self.data.decode(self.encoding)
        elif isinstance(self.data, str):
            return self.data
        else:
            raise ValueError(f"Unable to get string for blob {self}")

    def as_bytes(self) -> bytes:
        """Read data as bytes."""
        if isinstance(self.data, bytes):
            return self.data
        elif isinstance(self.data, str):
            return self.data.encode(self.encoding)
        elif self.data is None and self.path:
            with open(str(self.path), "rb") as f:
                return f.read()
        else:
            raise ValueError(f"Unable to get bytes for blob {self}")

    @contextlib.contextmanager
    def as_bytes_io(self) -> Generator[Union[BytesIO, BufferedReader], None, None]:
        """Read data as a byte stream."""
        if isinstance(self.data, bytes):
            yield BytesIO(self.data)
        elif self.data is None and self.path:
            with open(str(self.path), "rb") as f:
                yield f
        else:
            raise NotImplementedError(f"Unable to convert blob {self}")

    @classmethod
    def from_path(
        cls,
        path: PathLike,
        *,
        encoding: str = "utf-8",
        mime_type: Optional[str] = None,
        guess_type: bool = True,
    ) -> Blob:
        """Load the blob from a path like object.

        Args:
            path: path like object to file to be read
            encoding: Encoding to use if decoding the bytes into a string
            mime_type: if provided, will be set as the mime-type of the data
            guess_type: If True, the mimetype will be guessed from the file extension,
                        if a mime-type was not provided

        Returns:
            Blob instance
        """
        if mime_type is None and guess_type:
            _mimetype = mimetypes.guess_type(path)[0] if guess_type else None
        else:
            _mimetype = mime_type
        # We do not load the data immediately, instead we treat the blob as a
        # reference to the underlying data.
        return cls(data=None, mimetype=_mimetype, encoding=encoding, path=path)

    @classmethod
    def from_data(
        cls,
        data: Union[str, bytes],
        *,
        encoding: str = "utf-8",
        mime_type: Optional[str] = None,
        path: Optional[str] = None,
    ) -> Blob:
        """Initialize the blob from in-memory data.

        Args:
            data: the in-memory data associated with the blob
            encoding: Encoding to use if decoding the bytes into a string
            mime_type: if provided, will be set as the mime-type of the data
            path: if provided, will be set as the source from which the data came

        Returns:
            Blob instance
        """
        return cls(data=data, mimetype=mime_type, encoding=encoding, path=path)

    def __repr__(self) -> str:
        """Define the blob representation."""
        str_repr = f"Blob {id(self)}"
        if self.source:
            str_repr += f" {self.source}"
        return str_repr


class BlobLoader(ABC):
    """Abstract interface for blob loaders implementation.

    Implementer should be able to load raw content from a datasource system according
    to some criteria and return the raw content lazily as a stream of blobs.
    """

    @abstractmethod
    def yield_blobs(
        self,
    ) -> Iterable[Blob]:
        """A lazy loader for raw data represented by Blob object.

        Returns:
            A generator over blobs
        """
