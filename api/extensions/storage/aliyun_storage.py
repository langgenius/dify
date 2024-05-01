from collections.abc import Generator
from contextlib import closing

import oss2 as aliyun_s3
from flask import Flask

from extensions.storage.base_storage import BaseStorage


class AliyunStorage(BaseStorage):
    """Implementation for aliyun storage.
    """

    def __init__(self, app: Flask):
        super().__init__(app)
        app_config = self.app.config
        self.bucket_name = app_config.get('ALIYUN_OSS_BUCKET_NAME')
        self.client = aliyun_s3.Bucket(
            aliyun_s3.Auth(app_config.get('ALIYUN_OSS_ACCESS_KEY'), app_config.get('ALIYUN_OSS_SECRET_KEY')),
            app_config.get('ALIYUN_OSS_ENDPOINT'),
            self.bucket_name,
            connect_timeout=30
        )

    def save(self, filename, data):
        self.client.put_object(filename, data)

    def load_once(self, filename: str) -> bytes:
        with closing(self.client.get_object(filename)) as obj:
            data = obj.read()
        return data

    def load_stream(self, filename: str) -> Generator:
        def generate(filename: str = filename) -> Generator:
            with closing(self.client.get_object(filename)) as obj:
                while chunk := obj.read(4096):
                    yield chunk

        return generate()

    def download(self, filename, target_filepath):
        self.client.get_object_to_file(filename, target_filepath)

    def exists(self, filename):
        return self.client.object_exists(filename)

    def delete(self, filename):
        self.client.delete_object(filename)
