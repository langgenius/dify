from collections.abc import Generator
from contextlib import closing

import oss2 as aliyun_s3
from flask import Flask

from extensions.storage.base_storage import BaseStorage


class AliyunOssStorage(BaseStorage):
    """Implementation for Aliyun OSS storage."""

    def __init__(self, app: Flask):
        super().__init__(app)

        app_config = self.app.config
        self.bucket_name = app_config.get("ALIYUN_OSS_BUCKET_NAME")
        self.folder = app.config.get("ALIYUN_OSS_PATH")
        oss_auth_method = aliyun_s3.Auth
        region = None
        if app_config.get("ALIYUN_OSS_AUTH_VERSION") == "v4":
            oss_auth_method = aliyun_s3.AuthV4
            region = app_config.get("ALIYUN_OSS_REGION")
        oss_auth = oss_auth_method(app_config.get("ALIYUN_OSS_ACCESS_KEY"), app_config.get("ALIYUN_OSS_SECRET_KEY"))
        self.client = aliyun_s3.Bucket(
            oss_auth,
            app_config.get("ALIYUN_OSS_ENDPOINT"),
            self.bucket_name,
            connect_timeout=30,
            region=region,
        )

    def save(self, filename, data):
        self.client.put_object(self.__wrapper_folder_filename(filename), data)

    def load_once(self, filename: str) -> bytes:
        with closing(self.client.get_object(self.__wrapper_folder_filename(filename))) as obj:
            data = obj.read()
        return data

    def load_stream(self, filename: str) -> Generator:
        def generate(filename: str = filename) -> Generator:
            with closing(self.client.get_object(self.__wrapper_folder_filename(filename))) as obj:
                while chunk := obj.read(4096):
                    yield chunk

        return generate()

    def download(self, filename, target_filepath):
        self.client.get_object_to_file(self.__wrapper_folder_filename(filename), target_filepath)

    def exists(self, filename):
        return self.client.object_exists(self.__wrapper_folder_filename(filename))

    def delete(self, filename):
        self.client.delete_object(self.__wrapper_folder_filename(filename))

    def __wrapper_folder_filename(self, filename) -> str:
        if self.folder:
            if self.folder.endswith("/"):
                filename = self.folder + filename
            else:
                filename = self.folder + "/" + filename
        return filename
