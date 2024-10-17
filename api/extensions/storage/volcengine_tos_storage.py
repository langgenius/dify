from collections.abc import Generator

import tos
from flask import Flask

from extensions.storage.base_storage import BaseStorage


class VolcengineTosStorage(BaseStorage):
    """Implementation for Volcengine TOS storage."""

    def __init__(self, app: Flask):
        super().__init__(app)
        app_config = self.app.config
        self.bucket_name = app_config.get("VOLCENGINE_TOS_BUCKET_NAME")
        self.client = tos.TosClientV2(
            ak=app_config.get("VOLCENGINE_TOS_ACCESS_KEY"),
            sk=app_config.get("VOLCENGINE_TOS_SECRET_KEY"),
            endpoint=app_config.get("VOLCENGINE_TOS_ENDPOINT"),
            region=app_config.get("VOLCENGINE_TOS_REGION"),
        )

    def save(self, filename, data):
        self.client.put_object(bucket=self.bucket_name, key=filename, content=data)

    def load_once(self, filename: str) -> bytes:
        data = self.client.get_object(bucket=self.bucket_name, key=filename).read()
        return data

    def load_stream(self, filename: str) -> Generator:
        def generate(filename: str = filename) -> Generator:
            response = self.client.get_object(bucket=self.bucket_name, key=filename)
            while chunk := response.read(4096):
                yield chunk

        return generate()

    def download(self, filename, target_filepath):
        self.client.get_object_to_file(bucket=self.bucket_name, key=filename, file_path=target_filepath)

    def exists(self, filename):
        res = self.client.head_object(bucket=self.bucket_name, key=filename)
        if res.status_code != 200:
            return False
        return True

    def delete(self, filename):
        self.client.delete_object(bucket=self.bucket_name, key=filename)
