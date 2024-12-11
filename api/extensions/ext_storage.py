import logging
from collections.abc import Callable, Generator, Mapping
from typing import Union

from flask import Flask

from configs import dify_config
from configs.middleware.storage.opendal_storage_config import OpenDALScheme
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
                from extensions.storage.opendal_storage import OpenDALStorage

                kwargs = _load_s3_storage_kwargs()
                return lambda: OpenDALStorage(scheme=OpenDALScheme.S3, **kwargs)
            case StorageType.OPENDAL:
                from extensions.storage.opendal_storage import OpenDALStorage

                scheme = OpenDALScheme(dify_config.STORAGE_OPENDAL_SCHEME)
                kwargs = _load_opendal_storage_kwargs(scheme)
                return lambda: OpenDALStorage(scheme=scheme, **kwargs)
            case StorageType.LOCAL:
                from extensions.storage.opendal_storage import OpenDALStorage

                kwargs = _load_local_storage_kwargs()
                return lambda: OpenDALStorage(scheme=OpenDALScheme.FS, **kwargs)
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
                raise ValueError(f"Unsupported storage type {storage_type}")

    def save(self, filename, data):
        try:
            self.storage_runner.save(filename, data)
        except Exception as e:
            logger.exception(f"Failed to save file {filename}")
            raise e

    def load(self, filename: str, /, *, stream: bool = False) -> Union[bytes, Generator]:
        try:
            if stream:
                return self.load_stream(filename)
            else:
                return self.load_once(filename)
        except Exception as e:
            logger.exception(f"Failed to load file {filename}")
            raise e

    def load_once(self, filename: str) -> bytes:
        try:
            return self.storage_runner.load_once(filename)
        except Exception as e:
            logger.exception(f"Failed to load_once file {filename}")
            raise e

    def load_stream(self, filename: str) -> Generator:
        try:
            return self.storage_runner.load_stream(filename)
        except Exception as e:
            logger.exception(f"Failed to load_stream file {filename}")
            raise e

    def download(self, filename, target_filepath):
        try:
            self.storage_runner.download(filename, target_filepath)
        except Exception as e:
            logger.exception(f"Failed to download file {filename}")
            raise e

    def exists(self, filename):
        try:
            return self.storage_runner.exists(filename)
        except Exception as e:
            logger.exception(f"Failed to check file exists {filename}")
            raise e

    def delete(self, filename):
        try:
            return self.storage_runner.delete(filename)
        except Exception as e:
            logger.exception(f"Failed to delete file {filename}")
            raise e


def _load_s3_storage_kwargs() -> Mapping[str, str]:
    """
    Load the kwargs for S3 storage based on dify_config.
    Handles special cases like AWS managed IAM and R2.
    """
    kwargs = {
        "root": "/",
        "bucket": dify_config.S3_BUCKET_NAME,
        "endpoint": dify_config.S3_ENDPOINT,
        "access_key_id": dify_config.S3_ACCESS_KEY,
        "secret_access_key": dify_config.S3_SECRET_KEY,
        "region": dify_config.S3_REGION,
    }
    kwargs = {k: v for k, v in kwargs.items() if isinstance(v, str)}

    # For AWS managed IAM
    if dify_config.S3_USE_AWS_MANAGED_IAM:
        from extensions.storage.opendal_storage import S3_SSE_WITH_AWS_MANAGED_IAM_KWARGS

        logger.debug("Using AWS managed IAM role for S3")
        kwargs = {**kwargs, **{k: v for k, v in S3_SSE_WITH_AWS_MANAGED_IAM_KWARGS.items() if k not in kwargs}}

    # For Cloudflare R2
    if kwargs.get("endpoint"):
        from extensions.storage.opendal_storage import S3_R2_COMPATIBLE_KWARGS, is_r2_endpoint

        if is_r2_endpoint(kwargs["endpoint"]):
            logger.debug("Using R2 for OpenDAL S3")
            kwargs = {**kwargs, **{k: v for k, v in S3_R2_COMPATIBLE_KWARGS.items() if k not in kwargs}}

    return kwargs


def _load_local_storage_kwargs() -> Mapping[str, str]:
    """
    Load the kwargs for local storage based on dify_config.
    """
    return {
        "root": dify_config.STORAGE_LOCAL_PATH,
    }


def _load_opendal_storage_kwargs(scheme: OpenDALScheme) -> Mapping[str, str]:
    """
    Load the kwargs for OpenDAL storage based on the given scheme.
    """
    match scheme:
        case OpenDALScheme.FS:
            kwargs = {
                "root": dify_config.OPENDAL_FS_ROOT,
            }
        case OpenDALScheme.S3:
            # Load OpenDAL S3-related configs
            kwargs = {
                "root": dify_config.OPENDAL_S3_ROOT,
                "bucket": dify_config.OPENDAL_S3_BUCKET,
                "endpoint": dify_config.OPENDAL_S3_ENDPOINT,
                "access_key_id": dify_config.OPENDAL_S3_ACCESS_KEY_ID,
                "secret_access_key": dify_config.OPENDAL_S3_SECRET_ACCESS_KEY,
                "region": dify_config.OPENDAL_S3_REGION,
            }

            # For Cloudflare R2
            if kwargs.get("endpoint"):
                from extensions.storage.opendal_storage import S3_R2_COMPATIBLE_KWARGS, is_r2_endpoint

                if is_r2_endpoint(kwargs["endpoint"]):
                    logger.debug("Using R2 for OpenDAL S3")
                    kwargs = {**kwargs, **{k: v for k, v in S3_R2_COMPATIBLE_KWARGS.items() if k not in kwargs}}
        case _:
            logger.warning(f"Unrecognized OpenDAL scheme: {scheme}, will fall back to default.")
            kwargs = {}
    return kwargs


storage = Storage()


def init_app(app: DifyApp):
    storage.init_app(app)
