"""Abstract interface for file storage implementations."""

from abc import ABC, abstractmethod
from collections.abc import Generator


class BaseStorage(ABC):
    """Interface for file storage."""

    @abstractmethod
    def save(self, filename: str, data: bytes):
        raise NotImplementedError

    @abstractmethod
    def load_once(self, filename: str) -> bytes:
        raise NotImplementedError

    @abstractmethod
    def load_stream(self, filename: str) -> Generator:
        raise NotImplementedError

    @abstractmethod
    def download(self, filename, target_filepath):
        raise NotImplementedError

    @abstractmethod
    def exists(self, filename):
        raise NotImplementedError

    @abstractmethod
    def delete(self, filename):
        raise NotImplementedError

    def scan(self, path, files=True, directories=False) -> list[str]:
        """
        Scan files and directories in the given path.
        This method is implemented only in some storage backends.
        If a storage backend doesn't support scanning, it will raise NotImplementedError.
        """
        raise NotImplementedError("This storage backend doesn't support scanning")

    def get_download_url(self, filename: str, expires_in: int = 3600) -> str:
        """
        Generate a pre-signed URL for downloading a file.

        Storage backends that support pre-signed URLs (e.g., S3, Azure Blob, GCS)
        should override this method to return a direct download URL.

        Args:
            filename: The file path/key in storage
            expires_in: URL validity duration in seconds (default: 1 hour)

        Returns:
            Pre-signed URL string

        Raises:
            NotImplementedError: If this storage backend doesn't support pre-signed URLs
        """
        raise NotImplementedError("This storage backend doesn't support pre-signed URLs")

    def get_upload_url(self, filename: str, expires_in: int = 3600) -> str:
        """
        Generate a pre-signed URL for uploading a file.

        Storage backends that support pre-signed URLs (e.g., S3, Azure Blob, GCS)
        should override this method to return a direct upload URL.
        """
        raise NotImplementedError("This storage backend doesn't support pre-signed URLs")
