from collections.abc import Generator

import tos  # type: ignore

from configs import dify_config
from extensions.storage.base_storage import BaseStorage


class VolcengineTosStorage(BaseStorage):
    """Implementation for Volcengine TOS storage."""

    def __init__(self):
        super().__init__()
        self.bucket_name = dify_config.VOLCENGINE_TOS_BUCKET_NAME
        self.client = tos.TosClientV2(
            ak=dify_config.VOLCENGINE_TOS_ACCESS_KEY,
            sk=dify_config.VOLCENGINE_TOS_SECRET_KEY,
            endpoint=dify_config.VOLCENGINE_TOS_ENDPOINT,
            region=dify_config.VOLCENGINE_TOS_REGION,
        )

    def save(self, filename, data):
        self.client.put_object(bucket=self.bucket_name, key=filename, content=data)

    def load_once(self, filename: str) -> bytes:
        data = self.client.get_object(bucket=self.bucket_name, key=filename).read()
        if not isinstance(data, bytes):
            raise TypeError("Expected bytes, got {}".format(type(data).__name__))
        return data

    def load_stream(self, filename: str) -> Generator:
        response = self.client.get_object(bucket=self.bucket_name, key=filename)
        while chunk := response.read(4096):
            yield chunk

    def download(self, filename, target_filepath):
        self.client.get_object_to_file(bucket=self.bucket_name, key=filename, file_path=target_filepath)

    def exists(self, filename):
        res = self.client.head_object(bucket=self.bucket_name, key=filename)
        if res.status_code != 200:
            return False
        return True

    def delete(self, filename):
        self.client.delete_object(bucket=self.bucket_name, key=filename)
