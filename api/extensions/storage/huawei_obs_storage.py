from collections.abc import Generator
from typing import Any, override

from obs import ObsClient

from configs import dify_config
from extensions.storage.base_storage import BaseStorage


class HuaweiObsStorage(BaseStorage):
    """Implementation for Huawei OBS storage."""

    def __init__(self):
        super().__init__()

        self.bucket_name = dify_config.HUAWEI_OBS_BUCKET_NAME
        if dify_config.HUAWEI_OBS_USE_OIDC:
            self.client = ObsClient(
                server=dify_config.HUAWEI_OBS_SERVER,
                path_style=dify_config.HUAWEI_OBS_PATH_STYLE,
                security_provider_policy="OIDC",
            )
        else:
            self.client = ObsClient(
                access_key_id=dify_config.HUAWEI_OBS_ACCESS_KEY,
                secret_access_key=dify_config.HUAWEI_OBS_SECRET_KEY,
                server=dify_config.HUAWEI_OBS_SERVER,
                path_style=dify_config.HUAWEI_OBS_PATH_STYLE,
            )

    @override
    def save(self, filename, data):
        self.client.putObject(bucketName=self.bucket_name, objectKey=filename, content=data)

    @override
    def load_once(self, filename: str) -> bytes:
        # TODO: Huawei SDK lacks proper typing
        data: bytes = self.client.getObject(bucketName=self.bucket_name, objectKey=filename).body.response.read()  # type: ignore
        return data

    @override
    def load_stream(self, filename: str) -> Generator:
        # TODO: Huawei SDK lacks proper typing
        response = self.client.getObject(bucketName=self.bucket_name, objectKey=filename).body.response  # type: ignore
        while chunk := response.read(4096):
            yield chunk

    @override
    def download(self, filename, target_filepath):
        self.client.getObject(bucketName=self.bucket_name, objectKey=filename, downloadPath=target_filepath)

    @override
    def exists(self, filename):
        res = self._get_meta(filename)
        return res is not None

    @override
    def delete(self, filename: str):
        response: Any = self.client.deleteObject(bucketName=self.bucket_name, objectKey=filename)
        if response.status == 404 and response.errorCode == "NoSuchKey":
            raise FileNotFoundError(filename)
        if response.status >= 300:
            raise RuntimeError(f"OBS object deletion failed: status={response.status}, code={response.errorCode}")

    @override
    def scan(self, path: str, files: bool = True, directories: bool = False) -> list[str]:
        keys: list[str] = []
        marker = ""
        while True:
            # The SDK's decorator annotations do not describe its response model.
            response: Any = self.client.listObjects(
                bucketName=self.bucket_name, prefix=path, marker=marker, max_keys=1000
            )
            if response.status >= 300:
                raise RuntimeError(f"OBS object listing failed: status={response.status}, code={response.errorCode}")
            page = response.body
            keys.extend(obj.key for obj in page.contents or [])
            if not page.is_truncated:
                break
            if not page.next_marker or page.next_marker == marker:
                raise RuntimeError("OBS object listing did not advance its pagination marker")
            marker = page.next_marker
        return self._filter_scan_keys(keys, files, directories)

    def _get_meta(self, filename):
        res = self.client.getObjectMetadata(bucketName=self.bucket_name, objectKey=filename)
        if res and res.status and res.status < 300:
            return res
        else:
            return None
