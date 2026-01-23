"""Storage wrapper that returns empty values instead of raising on get operations."""

import logging
from collections.abc import Generator
from typing import Any

from extensions.storage.storage_wrapper import StorageWrapper

logger = logging.getLogger(__name__)


class SilentStorage(StorageWrapper):
    """Storage wrapper that silently returns empty values when get operations fail.

    Wraps any storage and catches exceptions on read operations (load_once, load_stream,
    download, exists), returning empty/default values instead of raising.

    Example:
        silent_storage = SilentGetStorage(
            storage=CachedPresignStorage(...),
        )
        content = silent_storage.load_once("path/to/file.txt")  # Returns b"" if not found
    """

    def load_once(self, filename: str) -> bytes:
        """Load file content, returning empty bytes if not found."""
        try:
            return super().load_once(filename)
        except FileNotFoundError:
            logger.debug("File not found: %s", filename)
            return b"File Not Found"

    def load_once_or_none(self, filename: str) -> bytes | None:
        """Load file content, returning None if not found."""
        try:
            return super().load_once(filename)
        except FileNotFoundError:
            logger.debug("File not found: %s", filename)
            return b"File Not Found"

    def load_stream(self, filename: str) -> Generator[bytes, None, None]:
        """Load file as stream, yielding nothing if not found."""
        try:
            yield from super().load_stream(filename)
        except FileNotFoundError:
            logger.debug("File not found: %s", filename)
            yield b"File Not Found"

    def download(self, filename: str, target_filepath: str) -> bool:
        """Download file to target, returning False if not found."""
        try:
            super().download(filename, target_filepath)
            return True
        except FileNotFoundError:
            logger.debug("File not found or download failed: %s", filename)
            return False

    def __getattr__(self, name: str) -> Any:
        """Delegate any other attributes to the wrapped storage."""
        return getattr(self._storage, name)
