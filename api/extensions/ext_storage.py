from collections.abc import Generator
from typing import Union

from flask import Flask

from extensions.storage.local_storage import LocalStorage


class Storage:
    def __init__(self):
        self.storage_runner = None

    def init_app(self, app: Flask):
        storage_type = app.config.get("STORAGE_TYPE")
        if storage_type == "s3":
            from extensions.storage.s3_storage import S3Storage
            self.storage_runner = S3Storage(app=app)
        elif storage_type == "azure-blob":
            from extensions.storage.azure_storage import AzureStorage
            self.storage_runner = AzureStorage(app=app)
        elif storage_type == "aliyun-oss":
            from extensions.storage.aliyun_storage import AliyunStorage
            self.storage_runner = AliyunStorage(app=app)
        elif storage_type == "google-storage":
            from extensions.storage.google_storage import GoogleStorage
            self.storage_runner = GoogleStorage(app=app)
        elif storage_type == "tencent-cos":
            from extensions.storage.tencent_storage import TencentStorage
            self.storage_runner = TencentStorage(app=app)
        elif storage_type == "oci-storage":
            from extensions.storage.oci_storage import OCIStorage
            self.storage_runner = OCIStorage(app=app)
        elif storage_type == "huawei-obs":
            from extensions.storage.huawei_storage import HuaweiStorage
            self.storage_runner = HuaweiStorage(app=app)
        elif storage_type == "volcengine-tos":
            from extensions.storage.volcengine_storage import VolcengineStorage
            self.storage_runner = VolcengineStorage(app=app)
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
