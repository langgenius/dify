"""Storage wrapper that provides presigned URL support with fallback to signed proxy URLs.

This is the unified presign wrapper for all storage operations. When the underlying
storage backend doesn't support presigned URLs (raises NotImplementedError), it falls
back to generating signed proxy URLs that route through Dify's file proxy endpoints.

Usage:
    from extensions.storage.file_presign_storage import FilePresignStorage

    # Wrap any BaseStorage to add presign support
    presign_storage = FilePresignStorage(base_storage)
    download_url = presign_storage.get_download_url("path/to/file.txt", expires_in=3600)
    upload_url = presign_storage.get_upload_url("path/to/file.txt", expires_in=3600)

The proxy URLs follow the format:
    {FILES_URL}/files/storage/{encoded_filename}/(download|upload)?timestamp=...&nonce=...&sign=...

Signature format:
    HMAC-SHA256(SECRET_KEY, "storage-file|{operation}|{filename}|{timestamp}|{nonce}")
"""

import base64
import hashlib
import hmac
import os
import time
import urllib.parse

from configs import dify_config
from extensions.storage.storage_wrapper import StorageWrapper


class FilePresignStorage(StorageWrapper):
    """Storage wrapper that provides presigned URL support with proxy fallback.

    If the wrapped storage supports presigned URLs, delegates to it.
    Otherwise, generates signed proxy URLs for both download and upload operations.
    """

    SIGNATURE_PREFIX = "storage-file"

    def get_download_url(self, filename: str, expires_in: int = 3600) -> str:
        """Get a presigned download URL, falling back to proxy URL if not supported."""
        try:
            return self._storage.get_download_url(filename, expires_in)
        except NotImplementedError:
            return self._generate_signed_proxy_url(filename, "download", expires_in)

    def get_download_urls(self, filenames: list[str], expires_in: int = 3600) -> list[str]:
        """Get presigned download URLs for multiple files."""
        try:
            return self._storage.get_download_urls(filenames, expires_in)
        except NotImplementedError:
            return [self._generate_signed_proxy_url(f, "download", expires_in) for f in filenames]

    def get_upload_url(self, filename: str, expires_in: int = 3600) -> str:
        """Get a presigned upload URL, falling back to proxy URL if not supported."""
        try:
            return self._storage.get_upload_url(filename, expires_in)
        except NotImplementedError:
            return self._generate_signed_proxy_url(filename, "upload", expires_in)

    def _generate_signed_proxy_url(self, filename: str, operation: str, expires_in: int = 3600) -> str:
        """Generate a signed proxy URL for file operations.

        Args:
            filename: The storage key/path
            operation: Either "download" or "upload"
            expires_in: URL validity duration in seconds

        Returns:
            Signed proxy URL string
        """
        base_url = dify_config.FILES_URL
        encoded_filename = urllib.parse.quote(filename, safe="")
        url = f"{base_url}/files/storage/{encoded_filename}/{operation}"

        timestamp = str(int(time.time()))
        nonce = os.urandom(16).hex()
        sign = self._create_signature(operation, filename, timestamp, nonce)

        query = urllib.parse.urlencode({"timestamp": timestamp, "nonce": nonce, "sign": sign})
        return f"{url}?{query}"

    @classmethod
    def _create_signature(cls, operation: str, filename: str, timestamp: str, nonce: str) -> str:
        """Create HMAC signature for the proxy URL."""
        key = dify_config.SECRET_KEY.encode()
        msg = f"{cls.SIGNATURE_PREFIX}|{operation}|{filename}|{timestamp}|{nonce}"
        sign = hmac.new(key, msg.encode(), hashlib.sha256).digest()
        return base64.urlsafe_b64encode(sign).decode()

    @classmethod
    def verify_signature(cls, *, operation: str, filename: str, timestamp: str, nonce: str, sign: str) -> bool:
        """Verify the signature of a proxy URL.

        Args:
            operation: The operation type ("download" or "upload")
            filename: The storage key/path
            timestamp: Unix timestamp string from the URL
            nonce: Random nonce string from the URL
            sign: Signature string from the URL

        Returns:
            True if signature is valid and not expired, False otherwise
        """
        expected_sign = cls._create_signature(operation, filename, timestamp, nonce)
        if not hmac.compare_digest(sign, expected_sign):
            return False

        current_time = int(time.time())
        return current_time - int(timestamp) <= dify_config.FILES_ACCESS_TIMEOUT
