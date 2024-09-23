import logging
from collections.abc import Generator
from typing import Union

from flask import Flask

from extensions.storage.aliyun_storage import AliyunStorage
from extensions.storage.azure_storage import AzureStorage
from extensions.storage.google_storage import GoogleStorage
from extensions.storage.huawei_storage import HuaweiStorage
from extensions.storage.local_storage import LocalStorage
from extensions.storage.oci_storage import OCIStorage
from extensions.storage.s3_storage import S3Storage
from extensions.storage.tencent_storage import TencentStorage
from extensions.storage.volcengine_storage import VolcengineStorage


class Storage:
    def __init__(self):
        self.storage_runner = None

    def init_app(self, app: Flask):
        storage_type = app.config.get("STORAGE_TYPE")
        if storage_type == "s3":
            self.storage_runner = S3Storage(app=app)
        elif storage_type == "azure-blob":
            self.storage_runner = AzureStorage(app=app)
        elif storage_type == "aliyun-oss":
            self.storage_runner = AliyunStorage(app=app)
        elif storage_type == "google-storage":
            self.storage_runner = GoogleStorage(app=app)
        elif storage_type == "tencent-cos":
            self.storage_runner = TencentStorage(app=app)
        elif storage_type == "oci-storage":
            self.storage_runner = OCIStorage(app=app)
        elif storage_type == "huawei-obs":
            self.storage_runner = HuaweiStorage(app=app)
        elif storage_type == "volcengine-tos":
            self.storage_runner = VolcengineStorage(app=app)
        else:
            self.storage_runner = LocalStorage(app=app)

    def save(self, filename, data):
        try:
            self.storage_runner.save(filename, data)
        except Exception as e:
            logging.exception("Failed to save file: %s", e)
            raise e

    def load(self, filename: str, stream: bool = False) -> Union[bytes, Generator]:
        try:
            if stream:
                return self.load_stream(filename)
            else:
                return self.load_once(filename)
        except Exception as e:
            logging.exception("Failed to load file: %s", e)
            raise e

    def load_once(self, filename: str) -> bytes:
        try:
            return self.storage_runner.load_once(filename)
        except Exception as e:
            logging.exception("Failed to load_once file: %s", e)
            raise e

    def load_stream(self, filename: str) -> Generator:
        try:
            return self.storage_runner.load_stream(filename)
        except Exception as e:
            logging.exception("Failed to load_stream file: %s", e)
            raise e

    def download(self, filename, target_filepath):
        try:
            self.storage_runner.download(filename, target_filepath)
        except Exception as e:
            logging.exception("Failed to download file: %s", e)
            raise e

    def exists(self, filename):
        try:
            return self.storage_runner.exists(filename)
        except Exception as e:
            logging.exception("Failed to check file exists: %s", e)
            raise e

    def delete(self, filename):
        try:
            return self.storage_runner.delete(filename)
        except Exception as e:
            logging.exception("Failed to delete file: %s", e)
            raise e


storage = Storage()


def init_app(app: Flask):
    storage.init_app(app)
