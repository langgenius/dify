import posixpath
from collections.abc import Generator

import oss2 as aliyun_s3

from configs import dify_config
from extensions.storage.base_storage import BaseStorage


class AliyunOssStorage(BaseStorage):
    """Implementation for Aliyun OSS storage."""

    def __init__(self):
        super().__init__()
        self.bucket_name = dify_config.ALIYUN_OSS_BUCKET_NAME
        self.folder = dify_config.ALIYUN_OSS_PATH
        oss_auth_method = aliyun_s3.Auth
        region = None
        if dify_config.ALIYUN_OSS_AUTH_VERSION == "v4":
            oss_auth_method = aliyun_s3.AuthV4
            region = dify_config.ALIYUN_OSS_REGION
        oss_auth = oss_auth_method(dify_config.ALIYUN_OSS_ACCESS_KEY, dify_config.ALIYUN_OSS_SECRET_KEY)
        self.client = aliyun_s3.Bucket(
            oss_auth,
            dify_config.ALIYUN_OSS_ENDPOINT,
            self.bucket_name,
            connect_timeout=30,
            region=region,
        )

    def save(self, filename, data):
        self.client.put_object(self.__wrapper_folder_filename(filename), data)

    def load_once(self, filename: str) -> bytes:
        obj = self.client.get_object(self.__wrapper_folder_filename(filename))
        data = obj.read()
        return data

    def load_stream(self, filename: str) -> Generator:
        obj = self.client.get_object(self.__wrapper_folder_filename(filename))
        while chunk := obj.read(4096):
            yield chunk

    def download(self, filename, target_filepath):
        self.client.get_object_to_file(self.__wrapper_folder_filename(filename), target_filepath)

    def exists(self, filename):
        return self.client.object_exists(self.__wrapper_folder_filename(filename))

    def delete(self, filename):
        self.client.delete_object(self.__wrapper_folder_filename(filename))

    def __wrapper_folder_filename(self, filename) -> str:
        return posixpath.join(self.folder, filename) if self.folder else filename
