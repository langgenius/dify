from collections.abc import Generator
from typing import Union

from flask import Flask

from extensions.storage.aliyun_storage import AliyunStorage
from extensions.storage.azure_storage import AzureStorage
from extensions.storage.google_storage import GoogleStorage
from extensions.storage.local_storage import LocalStorage
from extensions.storage.s3_storage import S3Storage
from extensions.storage.tencent_storage import TencentStorage


class Storage:
    def __init__(self):
        self.storage_runner = None

    def init_app(self, app: Flask):
        storage_type = app.config.get('STORAGE_TYPE')
        if storage_type == 's3':
            self.storage_runner = S3Storage(
                app=app
            )
        elif storage_type == 'azure-blob':
            self.storage_runner = AzureStorage(
                app=app
            )
        elif storage_type == 'aliyun-oss':
            self.storage_runner = AliyunStorage(
                app=app
            )
        elif storage_type == 'google-storage':
            self.storage_runner = GoogleStorage(
                app=app
            )
        elif storage_type == 'tencent-cos':
            self.storage_runner = TencentStorage(
                app=app
            )
        else:
            self.storage_runner = LocalStorage(app=app)

    def save(self, filename, data):
        self.storage_runner.save(filename, data)

    def load(self, filename: str, stream: bool = False) -> Union[bytes, Generator]:
        if stream:
            return self.load_stream(filename)
        else:
            return self.load_once(filename)

    def load_once(self, filename: str) -> bytes:
        return self.storage_runner.load_once(filename)

    def load_stream(self, filename: str) -> Generator:
        return self.storage_runner.load_stream(filename)

    def download(self, filename, target_filepath):
        self.storage_runner.download(filename, target_filepath)

    def exists(self, filename):
        return self.storage_runner.exists(filename)

    def delete(self, filename):
        return self.storage_runner.delete(filename)


storage = Storage()


def init_app(app: Flask):
    storage.init_app(app)
