"""Storage wrapper that provides presigned URL support with fallback to signed proxy URLs."""

import base64
import hashlib
import hmac
import os
import time
import urllib.parse

from configs import dify_config
from extensions.storage.storage_wrapper import StorageWrapper


class FilePresignStorage(StorageWrapper):
    """Storage wrapper that provides presigned URL support.

    If the wrapped storage supports presigned URLs, delegates to it.
    Otherwise, generates signed proxy URLs for download.
    """

    SIGNATURE_PREFIX = "storage-download"

    def get_download_url(self, filename: str, expires_in: int = 3600) -> str:
        try:
            return super().get_download_url(filename, expires_in)
        except NotImplementedError:
            return self._generate_signed_proxy_url(filename, expires_in)

    def get_upload_url(self, filename: str, expires_in: int = 3600) -> str:
        try:
            return super().get_upload_url(filename, expires_in)
        except NotImplementedError:
            return self._generate_signed_upload_url(filename)

    def get_download_urls(self, filenames: list[str], expires_in: int = 3600) -> list[str]:
        try:
            return super().get_download_urls(filenames, expires_in)
        except NotImplementedError:
            return [self._generate_signed_proxy_url(filename, expires_in) for filename in filenames]

    def _generate_signed_upload_url(self, filename: str) -> str:
        # TODO: Implement this
        raise NotImplementedError("This storage backend doesn't support pre-signed URLs")

    def _generate_signed_proxy_url(self, filename: str, expires_in: int = 3600) -> str:
        base_url = dify_config.FILES_URL
        encoded_filename = urllib.parse.quote(filename, safe="")
        url = f"{base_url}/files/storage/{encoded_filename}/download"

        timestamp = str(int(time.time()))
        nonce = os.urandom(16).hex()
        sign = self._create_signature(filename, timestamp, nonce)

        query = urllib.parse.urlencode({"timestamp": timestamp, "nonce": nonce, "sign": sign})
        return f"{url}?{query}"

    @classmethod
    def _create_signature(cls, filename: str, timestamp: str, nonce: str) -> str:
        key = dify_config.SECRET_KEY.encode()
        msg = f"{cls.SIGNATURE_PREFIX}|{filename}|{timestamp}|{nonce}"
        sign = hmac.new(key, msg.encode(), hashlib.sha256).digest()
        return base64.urlsafe_b64encode(sign).decode()

    @classmethod
    def verify_signature(cls, *, filename: str, timestamp: str, nonce: str, sign: str) -> bool:
        expected_sign = cls._create_signature(filename, timestamp, nonce)
        if sign != expected_sign:
            return False

        current_time = int(time.time())
        return current_time - int(timestamp) <= dify_config.FILES_ACCESS_TIMEOUT
