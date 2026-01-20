import base64
import hashlib
import hmac
import os
import time
import urllib.parse
from collections.abc import Generator

from configs import dify_config
from extensions.storage.base_storage import BaseStorage


class FilePresignStorage(BaseStorage):
    SIGNATURE_PREFIX = "storage-download"

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

    def get_download_url(self, filename: str, expires_in: int = 3600) -> str:
        try:
            return self._storage.get_download_url(filename, expires_in)
        except NotImplementedError:
            return self._generate_signed_proxy_url(filename)

    def get_upload_url(self, filename: str, expires_in: int = 3600) -> str:
        try:
            return self._storage.get_upload_url(filename, expires_in)
        except NotImplementedError:
            return self._generate_signed_upload_url(filename)

    def _generate_signed_upload_url(self, filename: str) -> str:
        # TODO: Implement this
        raise NotImplementedError("This storage backend doesn't support pre-signed URLs")

    def _generate_signed_proxy_url(self, filename: str) -> str:
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
