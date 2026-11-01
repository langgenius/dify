from collections.abc import Generator
from typing import override

from qcloud_cos import CosConfig, CosS3Client

from configs import dify_config
from extensions.storage.base_storage import BaseStorage
from libs.stream import close_stream


class TencentCosStorage(BaseStorage):
    """Implementation for Tencent Cloud COS storage."""

    def __init__(self):
        super().__init__()

        self.bucket_name = dify_config.TENCENT_COS_BUCKET_NAME
        if dify_config.TENCENT_COS_CUSTOM_DOMAIN:
            config = CosConfig(
                Domain=dify_config.TENCENT_COS_CUSTOM_DOMAIN,
                SecretId=dify_config.TENCENT_COS_SECRET_ID,
                SecretKey=dify_config.TENCENT_COS_SECRET_KEY,
                Scheme=dify_config.TENCENT_COS_SCHEME,
            )
        else:
            config = CosConfig(
                Region=dify_config.TENCENT_COS_REGION,
                SecretId=dify_config.TENCENT_COS_SECRET_ID,
                SecretKey=dify_config.TENCENT_COS_SECRET_KEY,
                Scheme=dify_config.TENCENT_COS_SCHEME,
            )
        self.client = CosS3Client(config)

    @override
    def save(self, filename, data):
        self.client.put_object(Bucket=self.bucket_name, Body=data, Key=filename)

    @override
    def load_once(self, filename: str) -> bytes:
        body = self.client.get_object(Bucket=self.bucket_name, Key=filename)["Body"]
        raw_stream = body.get_raw_stream()
        try:
            data: bytes = raw_stream.read()
        finally:
            close_stream(raw_stream)
        return data

    @override
    def load_stream(self, filename: str) -> Generator:
        response = self.client.get_object(Bucket=self.bucket_name, Key=filename)
        body = response["Body"]
        try:
            yield from body.get_stream(chunk_size=4096)
        finally:
            close_stream(body.get_raw_stream())

    @override
    def download(self, filename, target_filepath):
        response = self.client.get_object(Bucket=self.bucket_name, Key=filename)
        response["Body"].get_stream_to_file(target_filepath)

    @override
    def exists(self, filename):
        return self.client.object_exists(Bucket=self.bucket_name, Key=filename)

    @override
    def delete(self, filename: str):
        self.client.delete_object(Bucket=self.bucket_name, Key=filename)

    @override
    def scan(self, path: str, files: bool = True, directories: bool = False) -> list[str]:
        keys: list[str] = []
        marker = ""
        while True:
            page = self.client.list_objects(Bucket=self.bucket_name, Prefix=path, Marker=marker, MaxKeys=1000)
            keys.extend(obj["Key"] for obj in page.get("Contents", []))
            if str(page.get("IsTruncated", "false")).lower() != "true":
                break
            next_marker = page.get("NextMarker")
            if not next_marker or next_marker == marker:
                raise RuntimeError("COS object listing did not advance its pagination marker")
            marker = next_marker
        return self._filter_scan_keys(keys, files, directories)
