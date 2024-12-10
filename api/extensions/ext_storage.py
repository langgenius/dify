import logging
from collections.abc import Callable, Generator, Mapping
from typing import Union

from flask import Flask

from configs import dify_config
from configs.middleware.storage.opendal_storage_config import OpenDALScheme
from dify_app import DifyApp
from extensions.storage.base_storage import BaseStorage
from extensions.storage.storage_type import StorageType


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
            case StorageType.OPENDAL:
                from extensions.storage.opendal_storage import OpenDALStorage

                kwargs = _load_opendal_storage_kwargs_by_scheme(dify_config.STORAGE_OPENDAL_SCHEME)
                return lambda: OpenDALStorage(scheme=dify_config.STORAGE_OPENDAL_SCHEME, **kwargs)
            case StorageType.LOCAL | _:
                from extensions.storage.opendal_storage import OpenDALStorage

                kwargs = _load_opendal_storage_kwargs_by_scheme(OpenDALScheme.FS)
                return lambda: OpenDALStorage(scheme=OpenDALScheme.FS, **kwargs)

    def save(self, filename, data):
        try:
            self.storage_runner.save(filename, data)
        except Exception as e:
            logging.exception(f"Failed to save file {filename}")
            raise e

    def load(self, filename: str, /, *, stream: bool = False) -> Union[bytes, Generator]:
        try:
            if stream:
                return self.load_stream(filename)
            else:
                return self.load_once(filename)
        except Exception as e:
            logging.exception(f"Failed to load file {filename}")
            raise e

    def load_once(self, filename: str) -> bytes:
        try:
            return self.storage_runner.load_once(filename)
        except Exception as e:
            logging.exception(f"Failed to load_once file {filename}")
            raise e

    def load_stream(self, filename: str) -> Generator:
        try:
            return self.storage_runner.load_stream(filename)
        except Exception as e:
            logging.exception(f"Failed to load_stream file {filename}")
            raise e

    def download(self, filename, target_filepath):
        try:
            self.storage_runner.download(filename, target_filepath)
        except Exception as e:
            logging.exception(f"Failed to download file {filename}")
            raise e

    def exists(self, filename):
        try:
            return self.storage_runner.exists(filename)
        except Exception as e:
            logging.exception(f"Failed to check file exists {filename}")
            raise e

    def delete(self, filename):
        try:
            return self.storage_runner.delete(filename)
        except Exception as e:
            logging.exception(f"Failed to delete file {filename}")
            raise e


def _load_opendal_storage_kwargs_by_scheme(scheme: OpenDALScheme, /) -> Mapping[str, str]:
    match scheme:
        case OpenDALScheme.FS:
            return {
                "root": dify_config.OPENDAL_FS_ROOT,
            }
        case OpenDALScheme.S3:
            if dify_config.OPENDAL_S3_SERVER_SIDE_ENCRYPTION == "aws:kms":
                return {
                    "root": dify_config.OPENDAL_S3_ROOT,
                    "bucket": dify_config.OPENDAL_S3_BUCKET,
                    "server_side_encryption": dify_config.OPENDAL_S3_SERVER_SIDE_ENCRYPTION,
                    "region": dify_config.OPENDAL_S3_REGION,
                }
            return {
                "root": dify_config.OPENDAL_S3_ROOT,
                "bucket": dify_config.OPENDAL_S3_BUCKET,
                "endpoint": dify_config.OPENDAL_S3_ENDPOINT,
                "access_key_id": dify_config.OPENDAL_S3_ACCESS_KEY_ID,
                "secret_access_key": dify_config.OPENDAL_S3_SECRET_ACCESS_KEY,
                "region": dify_config.OPENDAL_S3_REGION,
            }
        case _:
            raise ValueError(f"Unsupported OpenDAL scheme {scheme}")


storage = Storage()


def init_app(app: DifyApp):
    storage.init_app(app)
