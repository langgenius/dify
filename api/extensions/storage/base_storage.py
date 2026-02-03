"""Abstract interface for file storage implementations."""

from abc import ABC, abstractmethod
from collections.abc import Generator


class BaseStorage(ABC):
    """Interface for file storage."""

    @abstractmethod
    def save(self, filename: str, data: bytes) -> None:
        raise NotImplementedError

    @abstractmethod
    def load_once(self, filename: str) -> bytes:
        raise NotImplementedError

    @abstractmethod
    def load_stream(self, filename: str) -> Generator[bytes, None, None]:
        raise NotImplementedError

    @abstractmethod
    def download(self, filename: str, target_filepath: str) -> None:
        raise NotImplementedError

    @abstractmethod
    def exists(self, filename: str) -> bool:
        raise NotImplementedError

    @abstractmethod
    def delete(self, filename: str) -> None:
        raise NotImplementedError

    def scan(self, path: str, files: bool = True, directories: bool = False) -> list[str]:
        """
        Scan files and directories in the given path.
        This method is implemented only in some storage backends.
        If a storage backend doesn't support scanning, it will raise NotImplementedError.
        """
        raise NotImplementedError("This storage backend doesn't support scanning")

    def get_download_url(
        self,
        filename: str,
        expires_in: int = 3600,
        *,
        download_filename: str | None = None,
    ) -> str:
        """
        Generate a pre-signed URL for downloading a file.

        Storage backends that support pre-signed URLs (e.g., S3, Azure Blob, GCS)
        should override this method to return a direct download URL.

        Args:
            filename: The file path/key in storage
            expires_in: URL validity duration in seconds (default: 1 hour)
            download_filename: If provided, the browser will use this as the downloaded
                file name instead of the storage key. Implemented via response header
                override (e.g., Content-Disposition) where supported.

        Returns:
            Pre-signed URL string

        Raises:
            NotImplementedError: If this storage backend doesn't support pre-signed URLs
        """
        raise NotImplementedError("This storage backend doesn't support pre-signed URLs")

    def get_download_urls(
        self,
        filenames: list[str],
        expires_in: int = 3600,
        *,
        download_filenames: list[str] | None = None,
    ) -> list[str]:
        """
        Generate pre-signed URLs for downloading multiple files.

        Args:
            filenames: List of file paths/keys in storage
            expires_in: URL validity duration in seconds (default: 1 hour)
            download_filenames: If provided, must match len(filenames). Each element
                specifies the download filename for the corresponding file.
        """
        raise NotImplementedError("This storage backend doesn't support pre-signed URLs")

    def get_upload_url(self, filename: str, expires_in: int = 3600) -> str:
        """
        Generate a pre-signed URL for uploading a file.

        Storage backends that support pre-signed URLs (e.g., S3, Azure Blob, GCS)
        should override this method to return a direct upload URL.
        """
        raise NotImplementedError("This storage backend doesn't support pre-signed URLs")
