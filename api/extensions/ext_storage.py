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
    def __init__(self):
        self.upload_files_storage = None
        self.private_files_storage = None

    def init_app(self, app: Flask):
        # Initialize upload files storage
        upload_files_storage_factory = self.get_storage_factory(dify_config.UPLOAD_FILES_STORAGE_TYPE)
        with app.app_context():
            self.upload_files_storage = upload_files_storage_factory()

        # Initialize private files storage
        private_files_storage_factory = self.get_storage_factory(dify_config.PRIVATE_FILES_STORAGE_TYPE)
        with app.app_context():
            if dify_config.PRIVATE_FILES_STORAGE_TYPE == "local":
                self.private_files_storage = private_files_storage_factory(scheme="fs", root=dify_config.PRIVATE_FILES_STORAGE_PATH)
            else:
                self.private_files_storage = private_files_storage_factory()

    @staticmethod
    def get_storage_factory(storage_type: str) -> Callable[[], BaseStorage]:
        match storage_type:
            case StorageType.S3:
                from extensions.storage.aws_s3_storage import AwsS3Storage
                return AwsS3Storage
            case StorageType.OPENDAL:
                from extensions.storage.opendal_storage import OpenDALStorage
                return lambda **kwargs: OpenDALStorage(dify_config.OPENDAL_SCHEME, **kwargs)
            case StorageType.LOCAL:
                from extensions.storage.opendal_storage import OpenDALStorage
                return lambda **kwargs: OpenDALStorage(scheme="fs", **kwargs)
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
            case StorageType.HUAWEI_OBS:
                from extensions.storage.huawei_obs_storage import HuaweiObsStorage
                return HuaweiObsStorage
            case StorageType.BAIDU_OBS:
                from extensions.storage.baidu_obs_storage import BaiduObsStorage
                return BaiduObsStorage
            case StorageType.OCI_STORAGE:
                from extensions.storage.oracle_oci_storage import OracleOCIStorage
                return OracleOCIStorage
            case StorageType.VOLCENGINE_TOS:
                from extensions.storage.volcengine_tos_storage import VolcengineTosStorage
                return VolcengineTosStorage
            case StorageType.SUPBASE:
                from extensions.storage.supabase_storage import SupabaseStorage
                return SupabaseStorage
            case _:
                raise ValueError(f"unsupported storage type {storage_type}")

    def _get_storage(self, filename: str) -> BaseStorage:
        # Check if the file is a private file
        if filename.startswith("privkeys/"):
            return self.private_files_storage
        # Default to upload files storage
        return self.upload_files_storage

    def save(self, filename, data):
        try:
            storage = self._get_storage(filename)
            storage.save(filename, data)
        except Exception as e:
            logger.exception(f"Failed to save file {filename}")
            raise e

    @overload
    def load(self, filename: str, /, *, stream: Literal[False] = False) -> bytes: ...

    @overload
    def load(self, filename: str, /, *, stream: Literal[True]) -> Generator: ...

    def load(self, filename: str, /, *, stream: bool = False) -> Union[bytes, Generator]:
        try:
            storage = self._get_storage(filename)
            if stream:
                return storage.load_stream(filename)
            else:
                return storage.load_once(filename)
        except Exception as e:
            logger.exception(f"Failed to load file {filename}")
            raise e

    def load_once(self, filename: str) -> bytes:
        try:
            storage = self._get_storage(filename)
            return storage.load_once(filename)
        except Exception as e:
            logger.exception(f"Failed to load_once file {filename}")
            raise e

    def load_stream(self, filename: str) -> Generator:
        try:
            storage = self._get_storage(filename)
            return storage.load_stream(filename)
        except Exception as e:
            logger.exception(f"Failed to load_stream file {filename}")
            raise e

    def download(self, filename, target_filepath):
        try:
            storage = self._get_storage(filename)
            storage.download(filename, target_filepath)
        except Exception as e:
            logger.exception(f"Failed to download file {filename}")
            raise e

    def exists(self, filename):
        try:
            storage = self._get_storage(filename)
            return storage.exists(filename)
        except Exception as e:
            logger.exception(f"Failed to check if file exists {filename}")
            raise e

    def delete(self, filename):
        try:
            storage = self._get_storage(filename)
            storage.delete(filename)
        except Exception as e:
            logger.exception(f"Failed to delete file {filename}")
            raise e


storage = Storage()


def init_app(app: DifyApp):
    storage.init_app(app)
