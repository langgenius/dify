"""Base class for storage wrappers that delegate to an inner storage."""

from collections.abc import Generator

from extensions.storage.base_storage import BaseStorage


class StorageWrapper(BaseStorage):
    """Base class for storage wrappers using the decorator pattern.

    Forwards all BaseStorage methods to the wrapped storage by default.
    Subclasses can override specific methods to customize behavior.

    Example:
        class MyCustomStorage(StorageWrapper):
            def save(self, filename: str, data: bytes):
                # Custom logic before save
                super().save(filename, data)
                # Custom logic after save
    """

    def __init__(self, storage: BaseStorage):
        super().__init__()
        self._storage = storage

    def save(self, filename: str, data: bytes):
        self._storage.save(filename, data)

    def load_once(self, filename: str) -> bytes:
        return self._storage.load_once(filename)

    def load_stream(self, filename: str) -> Generator:
        return self._storage.load_stream(filename)

    def download(self, filename: str, target_filepath: str):
        self._storage.download(filename, target_filepath)

    def exists(self, filename: str) -> bool:
        return self._storage.exists(filename)

    def delete(self, filename: str):
        self._storage.delete(filename)

    def scan(self, path: str, files: bool = True, directories: bool = False) -> list[str]:
        return self._storage.scan(path, files=files, directories=directories)

    def get_download_url(
        self,
        filename: str,
        expires_in: int = 3600,
        *,
        download_filename: str | None = None,
    ) -> str:
        return self._storage.get_download_url(filename, expires_in, download_filename=download_filename)

    def get_download_urls(
        self,
        filenames: list[str],
        expires_in: int = 3600,
        *,
        download_filenames: list[str] | None = None,
    ) -> list[str]:
        return self._storage.get_download_urls(filenames, expires_in, download_filenames=download_filenames)

    def get_upload_url(self, filename: str, expires_in: int = 3600) -> str:
        return self._storage.get_upload_url(filename, expires_in)
