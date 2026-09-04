from collections.abc import Callable
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask

from configs.extra.public_storage_config import PublicStoragePolicyConfig
from extensions.ext_storage import PublicStorage, PublicStorageRegistry
from extensions.storage.aws_s3_storage import AwsS3Storage, AwsS3StorageSettings
from extensions.storage.storage_type import StorageType


def _policies(
    *,
    bucket: str | None = "public-files",
) -> dict[str, dict[StorageType, PublicStoragePolicyConfig]]:
    return {"ICON": {StorageType.S3: PublicStoragePolicyConfig(bucket=bucket)}}


def test_public_storage_forwards_content_type_to_s3() -> None:
    storage_runner = AwsS3Storage.__new__(AwsS3Storage)
    storage_runner.save = MagicMock()
    public_storage = PublicStorage.__new__(PublicStorage)
    public_storage.storage_runner = storage_runner

    public_storage.save("public/icon.png", b"image", content_type="image/png")

    storage_runner.save.assert_called_once_with("public/icon.png", b"image", content_type="image/png")


def test_public_storage_registry_stays_disabled_without_initializing_backend(
    config_overrides: Callable[..., None],
) -> None:
    registry = PublicStorageRegistry()
    config_overrides(PUBLIC_STORAGE_ENABLED=False)

    with (
        patch("extensions.storage.aws_s3_storage.AwsS3Storage") as storage_factory,
    ):
        registry.init_app(Flask(__name__))

    assert registry.enabled is False
    assert registry.get("ICON", StorageType.S3) is None
    storage_factory.assert_not_called()


def test_public_storage_registry_initializes_policy_s3_backend(config_overrides: Callable[..., None]) -> None:
    registry = PublicStorageRegistry()
    storage_runner = object()
    config_overrides(
        PUBLIC_STORAGE_ENABLED=True,
        PUBLIC_STORAGE_POLICIES=_policies(),
        PUBLIC_STORAGE_ENDPOINT="https://r2.example.com",
        PUBLIC_STORAGE_REGION="auto",
        PUBLIC_STORAGE_ACCESS_KEY="access-key",
        PUBLIC_STORAGE_SECRET_KEY="secret-key",
        PUBLIC_STORAGE_ADDRESS_STYLE="path",
    )

    with (
        patch("extensions.storage.aws_s3_storage.AwsS3Storage", return_value=storage_runner) as storage_factory,
    ):
        registry.init_app(Flask(__name__))

    policy_storage = registry.get("ICON", StorageType.S3)
    assert registry.enabled is True
    assert policy_storage is not None
    assert policy_storage.storage_runner is storage_runner
    storage_factory.assert_called_once_with(
        AwsS3StorageSettings(
            endpoint="https://r2.example.com",
            region="auto",
            bucket_name="public-files",
            access_key="access-key",
            secret_key="secret-key",
            address_style="path",
            use_aws_managed_iam=False,
        )
    )


def test_public_storage_registry_rejects_incomplete_connection_configuration(
    config_overrides: Callable[..., None],
) -> None:
    registry = PublicStorageRegistry()
    config_overrides(
        PUBLIC_STORAGE_ENABLED=True,
        PUBLIC_STORAGE_POLICIES=_policies(bucket=None),
        PUBLIC_STORAGE_ENDPOINT="https://r2.example.com",
        S3_BUCKET_NAME=None,
        PUBLIC_STORAGE_ACCESS_KEY="access-key",
        PUBLIC_STORAGE_SECRET_KEY="secret-key",
    )

    with (
        pytest.raises(ValueError, match="Public storage configuration is incomplete"),
    ):
        registry.init_app(Flask(__name__))


def test_public_storage_registry_falls_back_to_s3_bucket_name(config_overrides: Callable[..., None]) -> None:
    registry = PublicStorageRegistry()
    storage_runner = object()
    config_overrides(
        PUBLIC_STORAGE_ENABLED=True,
        PUBLIC_STORAGE_POLICIES=_policies(bucket=None),
        PUBLIC_STORAGE_ENDPOINT="https://r2.example.com",
        PUBLIC_STORAGE_REGION="auto",
        S3_BUCKET_NAME="fallback-files",
        PUBLIC_STORAGE_ACCESS_KEY="access-key",
        PUBLIC_STORAGE_SECRET_KEY="secret-key",
        PUBLIC_STORAGE_ADDRESS_STYLE="path",
    )

    with (
        patch("extensions.storage.aws_s3_storage.AwsS3Storage", return_value=storage_runner) as storage_factory,
    ):
        registry.init_app(Flask(__name__))

    assert registry.enabled is True
    assert storage_factory.call_args.args[0].bucket_name == "fallback-files"


def test_public_storage_registry_rejects_multiple_storage_types_for_one_purpose(
    config_overrides: Callable[..., None],
) -> None:
    registry = PublicStorageRegistry()
    policies = {
        "ICON": {
            StorageType.S3: PublicStoragePolicyConfig(bucket="s3-icons"),
            StorageType.AZURE_BLOB: PublicStoragePolicyConfig(bucket="azure-icons"),
        }
    }

    config_overrides(PUBLIC_STORAGE_ENABLED=True, PUBLIC_STORAGE_POLICIES=policies)
    with pytest.raises(ValueError, match="must configure exactly one storage type"):
        registry.init_app(Flask(__name__))
