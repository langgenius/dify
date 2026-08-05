from unittest.mock import patch

import pytest
from flask import Flask

from configs import dify_config
from configs.extra.public_storage_config import PublicStoragePolicyConfig
from extensions.ext_storage import PublicStorageRegistry
from extensions.storage.aws_s3_storage import AwsS3StorageSettings
from extensions.storage.storage_type import StorageType


def _policies(
    *,
    bucket: str | None = "public-files",
) -> dict[str, dict[StorageType, PublicStoragePolicyConfig]]:
    return {"ICON": {StorageType.S3: PublicStoragePolicyConfig(bucket=bucket)}}


def test_public_storage_registry_stays_disabled_without_initializing_backend() -> None:
    registry = PublicStorageRegistry()

    with (
        patch.object(dify_config, "PUBLIC_STORAGE_ENABLED", False),
        patch("extensions.storage.aws_s3_storage.AwsS3Storage") as storage_factory,
    ):
        registry.init_app(Flask(__name__))

    assert registry.enabled is False
    assert registry.get("ICON", StorageType.S3) is None
    storage_factory.assert_not_called()


def test_public_storage_registry_initializes_policy_s3_backend() -> None:
    registry = PublicStorageRegistry()
    storage_runner = object()

    with (
        patch.object(dify_config, "PUBLIC_STORAGE_ENABLED", True),
        patch.object(dify_config, "PUBLIC_STORAGE_POLICIES", _policies()),
        patch.object(dify_config, "PUBLIC_STORAGE_ENDPOINT", "https://r2.example.com"),
        patch.object(dify_config, "PUBLIC_STORAGE_REGION", "auto"),
        patch.object(dify_config, "PUBLIC_STORAGE_ACCESS_KEY", "access-key"),
        patch.object(dify_config, "PUBLIC_STORAGE_SECRET_KEY", "secret-key"),
        patch.object(dify_config, "PUBLIC_STORAGE_ADDRESS_STYLE", "path"),
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


def test_public_storage_registry_rejects_incomplete_connection_configuration() -> None:
    registry = PublicStorageRegistry()

    with (
        patch.object(dify_config, "PUBLIC_STORAGE_ENABLED", True),
        patch.object(dify_config, "PUBLIC_STORAGE_POLICIES", _policies(bucket=None)),
        patch.object(dify_config, "PUBLIC_STORAGE_ENDPOINT", "https://r2.example.com"),
        patch.object(dify_config, "S3_BUCKET_NAME", None),
        patch.object(dify_config, "PUBLIC_STORAGE_ACCESS_KEY", "access-key"),
        patch.object(dify_config, "PUBLIC_STORAGE_SECRET_KEY", "secret-key"),
        pytest.raises(ValueError, match="Public storage configuration is incomplete"),
    ):
        registry.init_app(Flask(__name__))


def test_public_storage_registry_falls_back_to_s3_bucket_name() -> None:
    registry = PublicStorageRegistry()
    storage_runner = object()

    with (
        patch.object(dify_config, "PUBLIC_STORAGE_ENABLED", True),
        patch.object(dify_config, "PUBLIC_STORAGE_POLICIES", _policies(bucket=None)),
        patch.object(dify_config, "PUBLIC_STORAGE_ENDPOINT", "https://r2.example.com"),
        patch.object(dify_config, "PUBLIC_STORAGE_REGION", "auto"),
        patch.object(dify_config, "S3_BUCKET_NAME", "fallback-files"),
        patch.object(dify_config, "PUBLIC_STORAGE_ACCESS_KEY", "access-key"),
        patch.object(dify_config, "PUBLIC_STORAGE_SECRET_KEY", "secret-key"),
        patch.object(dify_config, "PUBLIC_STORAGE_ADDRESS_STYLE", "path"),
        patch("extensions.storage.aws_s3_storage.AwsS3Storage", return_value=storage_runner) as storage_factory,
    ):
        registry.init_app(Flask(__name__))

    assert registry.enabled is True
    assert storage_factory.call_args.args[0].bucket_name == "fallback-files"


def test_public_storage_registry_rejects_multiple_storage_types_for_one_purpose() -> None:
    registry = PublicStorageRegistry()
    policies = {
        "ICON": {
            StorageType.S3: PublicStoragePolicyConfig(bucket="s3-icons"),
            StorageType.AZURE_BLOB: PublicStoragePolicyConfig(bucket="azure-icons"),
        }
    }

    with (
        patch.object(dify_config, "PUBLIC_STORAGE_ENABLED", True),
        patch.object(dify_config, "PUBLIC_STORAGE_POLICIES", policies),
        pytest.raises(ValueError, match="must configure exactly one storage type"),
    ):
        registry.init_app(Flask(__name__))
