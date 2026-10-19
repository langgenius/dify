from collections.abc import Generator
from typing import override

import tos

from configs import dify_config
from extensions.storage.base_storage import BaseStorage


class VolcengineTosStorage(BaseStorage):
    """Implementation for Volcengine TOS storage."""

    def __init__(self):
        super().__init__()
        if not dify_config.VOLCENGINE_TOS_ACCESS_KEY:
            raise ValueError("VOLCENGINE_TOS_ACCESS_KEY is not set")
        if not dify_config.VOLCENGINE_TOS_SECRET_KEY:
            raise ValueError("VOLCENGINE_TOS_SECRET_KEY is not set")
        if not dify_config.VOLCENGINE_TOS_ENDPOINT:
            raise ValueError("VOLCENGINE_TOS_ENDPOINT is not set")
        if not dify_config.VOLCENGINE_TOS_REGION:
            raise ValueError("VOLCENGINE_TOS_REGION is not set")
        self.bucket_name = dify_config.VOLCENGINE_TOS_BUCKET_NAME
        self.client = tos.TosClientV2(
            ak=dify_config.VOLCENGINE_TOS_ACCESS_KEY,
            sk=dify_config.VOLCENGINE_TOS_SECRET_KEY,
            endpoint=dify_config.VOLCENGINE_TOS_ENDPOINT,
            region=dify_config.VOLCENGINE_TOS_REGION,
        )

    @override
    def save(self, filename, data):
        if not self.bucket_name:
            raise ValueError("VOLCENGINE_TOS_BUCKET_NAME is not set")
        self.client.put_object(bucket=self.bucket_name, key=filename, content=data)

    @override
    def load_once(self, filename: str) -> bytes:
        if not self.bucket_name:
            raise FileNotFoundError("VOLCENGINE_TOS_BUCKET_NAME is not set")
        data = self.client.get_object(bucket=self.bucket_name, key=filename).read()
        if not isinstance(data, bytes):
            raise TypeError(f"Expected bytes, got {type(data).__name__}")
        return data

    @override
    def load_stream(self, filename: str) -> Generator:
        if not self.bucket_name:
            raise FileNotFoundError("VOLCENGINE_TOS_BUCKET_NAME is not set")
        response = self.client.get_object(bucket=self.bucket_name, key=filename)
        while chunk := response.read(4096):
            yield chunk

    @override
    def download(self, filename, target_filepath):
        if not self.bucket_name:
            raise ValueError("VOLCENGINE_TOS_BUCKET_NAME is not set")
        self.client.get_object_to_file(bucket=self.bucket_name, key=filename, file_path=target_filepath)

    @override
    def exists(self, filename):
        if not self.bucket_name:
            return False
        res = self.client.head_object(bucket=self.bucket_name, key=filename)
        return res.status_code == 200

    @override
    def delete(self, filename: str):
        if not self.bucket_name:
            return
        self.client.delete_object(bucket=self.bucket_name, key=filename)

    @override
    def scan(self, path: str, files: bool = True, directories: bool = False) -> list[str]:
        if not self.bucket_name:
            raise ValueError("VOLCENGINE_TOS_BUCKET_NAME is not set")
        keys: list[str] = []
        marker = ""
        while True:
            page = self.client.list_objects(bucket=self.bucket_name, prefix=path, marker=marker, max_keys=1000)
            keys.extend(obj.key for obj in page.contents)
            if not page.is_truncated:
                break
            if not page.next_marker or page.next_marker == marker:
                raise RuntimeError("TOS object listing did not advance its pagination marker")
            marker = page.next_marker
        return self._filter_scan_keys(keys, files, directories)
