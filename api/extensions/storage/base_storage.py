"""Abstract interface for file storage implementations."""

from abc import ABC, abstractmethod
from collections.abc import Generator, Iterable


class BaseStorage(ABC):
    """Interface for file storage."""

    @abstractmethod
    def save(self, filename: str, data: bytes):
        raise NotImplementedError

    def save_if_absent(self, filename: str, data: bytes) -> bool:
        """Atomically publish bytes only if absent; return False without changing existing material.

        Implementations must use a storage-side precondition, never an exists/save
        sequence. Unsupported backends fail closed; ordinary save is not a fallback.
        """
        raise NotImplementedError("This storage backend does not support atomic creation")

    @abstractmethod
    def load_once(self, filename: str) -> bytes:
        """Read one object; FileNotFoundError means only that object is absent, not an access failure."""
        raise NotImplementedError

    @abstractmethod
    def load_stream(self, filename: str) -> Generator:
        raise NotImplementedError

    @abstractmethod
    def download(self, filename: str, target_filepath: str) -> None:
        raise NotImplementedError

    @abstractmethod
    def exists(self, filename: str) -> bool:
        raise NotImplementedError

    @abstractmethod
    def delete(self, filename: str):
        raise NotImplementedError

    def generate_presigned_url(
        self,
        filename: str,
        *,
        expires_in: int,
        content_type: str | None = None,
    ) -> str:
        """Generate a temporary direct-download URL when the backend supports it."""
        raise NotImplementedError("This storage backend doesn't support presigned URLs")

    def scan(self, path, files=True, directories=False) -> list[str]:
        """
        Scan files and directories in the given path.
        This method is implemented only in some storage backends.
        If a storage backend doesn't support scanning, it will raise NotImplementedError.
        """
        raise NotImplementedError("This storage backend doesn't support scanning")

    @staticmethod
    def _filter_scan_keys(keys: Iterable[str], files: bool, directories: bool) -> list[str]:
        """Filter recursive object listings; directory entries end with '/'."""
        if not files and not directories:
            raise ValueError("At least one of files or directories must be True")
        return [key for key in keys if (key.endswith("/") and directories) or (not key.endswith("/") and files)]
