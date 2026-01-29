"""Storage wrapper that provides presigned URL support with fallback to ticket-based URLs.

This is the unified presign wrapper for all storage operations. When the underlying
storage backend doesn't support presigned URLs (raises NotImplementedError), it falls
back to generating ticket-based URLs that route through Dify's file proxy endpoints.

Usage:
    from extensions.storage.file_presign_storage import FilePresignStorage

    # Wrap any BaseStorage to add presign support
    presign_storage = FilePresignStorage(base_storage)
    download_url = presign_storage.get_download_url("path/to/file.txt", expires_in=3600)
    upload_url = presign_storage.get_upload_url("path/to/file.txt", expires_in=3600)

When the underlying storage doesn't support presigned URLs, the fallback URLs follow the format:
    {FILES_URL}/files/storage-tickets/{token}

The token is a UUID that maps to the real storage key in Redis.
"""

from extensions.storage.storage_wrapper import StorageWrapper


class FilePresignStorage(StorageWrapper):
    """Storage wrapper that provides presigned URL support with ticket fallback.

    If the wrapped storage supports presigned URLs, delegates to it.
    Otherwise, generates ticket-based URLs for both download and upload operations.
    """

    def get_download_url(self, filename: str, expires_in: int = 3600) -> str:
        """Get a presigned download URL, falling back to ticket URL if not supported."""
        try:
            return self._storage.get_download_url(filename, expires_in)
        except NotImplementedError:
            from services.storage_ticket_service import StorageTicketService

            return StorageTicketService.create_download_url(filename, expires_in=expires_in)

    def get_download_urls(self, filenames: list[str], expires_in: int = 3600) -> list[str]:
        """Get presigned download URLs for multiple files."""
        try:
            return self._storage.get_download_urls(filenames, expires_in)
        except NotImplementedError:
            from services.storage_ticket_service import StorageTicketService

            return [StorageTicketService.create_download_url(f, expires_in=expires_in) for f in filenames]

    def get_upload_url(self, filename: str, expires_in: int = 3600) -> str:
        """Get a presigned upload URL, falling back to ticket URL if not supported."""
        try:
            return self._storage.get_upload_url(filename, expires_in)
        except NotImplementedError:
            from services.storage_ticket_service import StorageTicketService

            return StorageTicketService.create_upload_url(filename, expires_in=expires_in)
