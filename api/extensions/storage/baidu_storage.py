import base64
import hashlib
from collections.abc import Generator

from baidubce.auth.bce_credentials import BceCredentials
from baidubce.bce_client_configuration import BceClientConfiguration
from baidubce.services.bos.bos_client import BosClient
from flask import Flask

from extensions.storage.base_storage import BaseStorage


class BaiduStorage(BaseStorage):
    """Implementation for baidu obs storage."""

    def __init__(self, app: Flask):
        super().__init__(app)
        app_config = self.app.config
        self.bucket_name = app_config.get("BAIDU_OBS_BUCKET_NAME")
        client_config = BceClientConfiguration(
            credentials=BceCredentials(
                access_key_id=app_config.get("BAIDU_OBS_ACCESS_KEY"),
                secret_access_key=app_config.get("BAIDU_OBS_SECRET_KEY"),
            ),
            endpoint=app_config.get("BAIDU_OBS_ENDPOINT"),
        )

        self.client = BosClient(config=client_config)

    def save(self, filename, data):
        md5 = hashlib.md5()
        md5.update(data)
        content_md5 = base64.standard_b64encode(md5.digest())
        self.client.put_object(
            bucket_name=self.bucket_name, key=filename, data=data, content_length=len(data), content_md5=content_md5
        )

    def load_once(self, filename: str) -> bytes:
        response = self.client.get_object(bucket_name=self.bucket_name, key=filename)
        return response.data.read()

    def load_stream(self, filename: str) -> Generator:
        def generate(filename: str = filename) -> Generator:
            response = self.client.get_object(bucket_name=self.bucket_name, key=filename).data
            while chunk := response.read(4096):
                yield chunk

        return generate()

    def download(self, filename, target_filepath):
        self.client.get_object_to_file(bucket_name=self.bucket_name, key=filename, file_name=target_filepath)

    def exists(self, filename):
        res = self.client.get_object_meta_data(bucket_name=self.bucket_name, key=filename)
        if res is None:
            return False
        return True

    def delete(self, filename):
        self.client.delete_object(bucket_name=self.bucket_name, key=filename)
