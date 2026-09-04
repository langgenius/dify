import logging
from collections.abc import Callable, Generator
from typing import Literal, Union, overload, override

from flask import Flask

from configs import dify_config
from configs.extra.public_storage_config import PublicStoragePolicyConfig
from dify_app import DifyApp
from extensions.storage.base_storage import BaseStorage
from extensions.storage.storage_type import StorageType

logger = logging.getLogger(__name__)


class Storage:
    storage_runner: BaseStorage
    storage_type: StorageType | None

    def __init__(self, storage_type: StorageType | None = None):
        self.storage_type = storage_type

    def init_app(self, app: Flask):
        storage_type = StorageType(dify_config.STORAGE_TYPE)
        storage_factory = self.get_storage_factory(storage_type)
        with app.app_context():
            self.storage_runner = storage_factory()
        self.storage_type = storage_type

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
            case StorageType.SUPABASE:
                from extensions.storage.supabase_storage import SupabaseStorage

                return SupabaseStorage
            case StorageType.CLICKZETTA_VOLUME:
                from extensions.storage.clickzetta_volume.clickzetta_volume_storage import (
                    ClickZettaVolumeConfig,
                    ClickZettaVolumeStorage,
                )

                def create_clickzetta_volume_storage():
                    # ClickZettaVolumeConfig will automatically read from environment variables
                    # and fallback to CLICKZETTA_* config if CLICKZETTA_VOLUME_* is not set
                    volume_config = ClickZettaVolumeConfig()
                    return ClickZettaVolumeStorage(volume_config)

                return create_clickzetta_volume_storage
            case _:
                raise ValueError(f"unsupported storage type {storage_type}")

    def save(self, filename: str, data: bytes, *, content_type: str | None = None) -> None:
        if content_type is not None:
            raise NotImplementedError("This storage backend doesn't support explicit content types")
        self.storage_runner.save(filename, data)

    @overload
    def load(self, filename: str, /, *, stream: Literal[False] = False) -> bytes: ...

    @overload
    def load(self, filename: str, /, *, stream: Literal[True]) -> Generator: ...

    # Keep a bool fallback overload for callers that forward a runtime bool flag.
    @overload
    def load(self, filename: str, /, *, stream: bool = False) -> Union[bytes, Generator]: ...

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

    def delete(self, filename: str):
        return self.storage_runner.delete(filename)

    def generate_presigned_url(
        self,
        filename: str,
        *,
        expires_in: int,
        content_type: str | None = None,
    ) -> str:
        return self.storage_runner.generate_presigned_url(
            filename,
            expires_in=expires_in,
            content_type=content_type,
        )

    def scan(self, path: str, files: bool = True, directories: bool = False) -> list[str]:
        return self.storage_runner.scan(path, files=files, directories=directories)


class PublicStorage(Storage):
    """Storage backend for one public upload policy."""

    enabled: bool

    def __init__(self, storage_type: StorageType, policy_config: PublicStoragePolicyConfig):
        super().__init__(storage_type)
        self.policy_config = policy_config
        self.enabled = False

    @override
    def save(self, filename: str, data: bytes, *, content_type: str | None = None) -> None:
        from extensions.storage.aws_s3_storage import AwsS3Storage

        if not isinstance(self.storage_runner, AwsS3Storage):
            raise RuntimeError("Public storage must use the S3 storage backend")
        self.storage_runner.save(filename, data, content_type=content_type)

    @override
    def init_app(self, app: Flask):
        if self.storage_type != StorageType.S3:
            raise ValueError(f"unsupported public storage type {self.storage_type}")

        bucket_name = self.policy_config.bucket or dify_config.S3_BUCKET_NAME
        required_settings = (
            dify_config.PUBLIC_STORAGE_ENDPOINT,
            bucket_name,
            dify_config.PUBLIC_STORAGE_ACCESS_KEY,
            dify_config.PUBLIC_STORAGE_SECRET_KEY,
        )
        if not all(required_settings):
            raise ValueError(
                "Public storage configuration is incomplete. Required: PUBLIC_STORAGE_ENDPOINT, "
                "PUBLIC_STORAGE_<PURPOSE>_S3_BUCKET or S3_BUCKET_NAME, PUBLIC_STORAGE_ACCESS_KEY, "
                "and PUBLIC_STORAGE_SECRET_KEY"
            )

        from extensions.storage.aws_s3_storage import AwsS3Storage, AwsS3StorageSettings

        settings = AwsS3StorageSettings(
            endpoint=dify_config.PUBLIC_STORAGE_ENDPOINT,
            region=dify_config.PUBLIC_STORAGE_REGION,
            bucket_name=bucket_name,
            access_key=dify_config.PUBLIC_STORAGE_ACCESS_KEY,
            secret_key=dify_config.PUBLIC_STORAGE_SECRET_KEY,
            address_style=dify_config.PUBLIC_STORAGE_ADDRESS_STYLE,
            use_aws_managed_iam=False,
        )
        with app.app_context():
            self.storage_runner = AwsS3Storage(settings)
        self.enabled = True


class PublicStorageRegistry:
    def __init__(self):
        self._storages: dict[tuple[str, StorageType], PublicStorage] = {}

    @property
    def enabled(self) -> bool:
        return bool(self._storages)

    def init_app(self, app: Flask) -> None:
        self._storages.clear()
        if not dify_config.PUBLIC_STORAGE_ENABLED:
            return
        if not dify_config.PUBLIC_STORAGE_POLICIES:
            raise ValueError("PUBLIC_STORAGE_ENABLED requires at least one public storage policy")

        from models.enums import UploadFilePurpose

        for purpose_name, storage_policies in dify_config.PUBLIC_STORAGE_POLICIES.items():
            if purpose_name not in UploadFilePurpose.__members__:
                raise ValueError(f"unsupported public upload purpose {purpose_name}")
            if len(storage_policies) != 1:
                raise ValueError(f"public upload purpose {purpose_name} must configure exactly one storage type")

            for storage_type, policy_config in storage_policies.items():
                policy_config.validate_policy()
                policy_storage = PublicStorage(storage_type, policy_config)
                policy_storage.init_app(app)
                self._storages[(purpose_name, storage_type)] = policy_storage

    def get(self, purpose_name: str, storage_type: StorageType) -> PublicStorage | None:
        return self._storages.get((purpose_name, storage_type))


storage = Storage()
public_storage = PublicStorageRegistry()


def init_app(app: DifyApp):
    storage.init_app(app)
    public_storage.init_app(app)
    from core.app.workflow.file_runtime import bind_dify_workflow_file_runtime

    bind_dify_workflow_file_runtime()
