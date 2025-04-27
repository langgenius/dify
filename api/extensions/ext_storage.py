import logging
from collections.abc import Callable, Generator
from typing import Literal, Union, overload

from flask import Flask

from configs import dify_config
from dify_app import DifyApp
from extensions.storage.base_storage import BaseStorage
from extensions.storage.storage_type import StorageType

logger = logging.getLogger(__name__)


class Storage:
    def init_app(self, app: Flask):
        storage_factory = self.get_storage_factory(dify_config.STORAGE_TYPE)
        with app.app_context():
            self.storage_runner = storage_factory()

    @staticmethod
    def get_storage_factory(storage_type: str) -> Callable[[], BaseStorage]:
        match storage_type:
            case StorageType.S3:
                from extensions.storage.aws_s3_storage import AwsS3Storage

                return AwsS3Storage
            case StorageType.OPENDAL:
                from extensions.storage.opendal_storage import OpenDALStorage

                return lambda: OpenDALStorage(dify_config.OPENDAL_SCHEME)
            case StorageType.LOCAL:
                from extensions.storage.opendal_storage import OpenDALStorage

                return lambda: OpenDALStorage(scheme="fs", root=dify_config.STORAGE_LOCAL_PATH)
            case StorageType.AZURE_BLOB:
                from extensions.storage.azure_blob_storage import AzureBlobStorage

                return AzureBlobStorage
            case StorageType.ALIYUN_OSS:
                from extensions.storage.aliyun_oss_storage import AliyunOssStorage

                return AliyunOssStorage
            case StorageType.GOOGLE_STORAGE:
                from extensions.storage.google_cloud_storage import GoogleCloudStorage

                return GoogleCloudStorage
            case StorageType.TENCENT_COS:
                from extensions.storage.tencent_cos_storage import TencentCosStorage

                return TencentCosStorage
            case StorageType.OCI_STORAGE:
                from extensions.storage.oracle_oci_storage import OracleOCIStorage

                return OracleOCIStorage
            case StorageType.HUAWEI_OBS:
                from extensions.storage.huawei_obs_storage import HuaweiObsStorage

                return HuaweiObsStorage
            case StorageType.BAIDU_OBS:
                from extensions.storage.baidu_obs_storage import BaiduObsStorage

                return BaiduObsStorage
            case StorageType.VOLCENGINE_TOS:
                from extensions.storage.volcengine_tos_storage import VolcengineTosStorage

                return VolcengineTosStorage
            case StorageType.SUPBASE:
                from extensions.storage.supabase_storage import SupabaseStorage

                return SupabaseStorage
            case _:
                raise ValueError(f"unsupported storage type {storage_type}")

    def save(self, filename, data):
        self.storage_runner.save(filename, data)

    @overload
    def load(self, filename: str, /, *, stream: Literal[False] = False) -> bytes: ...

    @overload
    def load(self, filename: str, /, *, stream: Literal[True]) -> Generator: ...

    def load(self, filename: str, /, *, stream: bool = False) -> Union[bytes, Generator]:
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

    def scan(self, path: str, files: bool = True, directories: bool = False) -> list[str]:
        return self.storage_runner.scan(path, files=files, directories=directories)


storage = Storage()


def init_app(app: DifyApp):
    storage.init_app(app)
