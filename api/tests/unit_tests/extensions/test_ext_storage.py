from unittest.mock import patch

import pytest
from flask import Flask

from configs import dify_config
from extensions.ext_storage import PublicStorage
from extensions.storage.aws_s3_storage import AwsS3StorageSettings
from extensions.storage.storage_type import StorageType


def test_public_storage_stays_disabled_without_initializing_backend() -> None:
    public_storage = PublicStorage()

    with (
        patch.object(dify_config, "PUBLIC_STORAGE_ENABLED", False),
        patch("extensions.storage.aws_s3_storage.AwsS3Storage") as storage_factory,
    ):
        public_storage.init_app(Flask(__name__))

    assert public_storage.enabled is False
    assert public_storage.storage_type == StorageType.S3
    storage_factory.assert_not_called()


def test_public_storage_initializes_s3_backend() -> None:
    public_storage = PublicStorage()
    storage_runner = object()

    with (
        patch.object(dify_config, "PUBLIC_STORAGE_ENABLED", True),
        patch.object(dify_config, "PUBLIC_STORAGE_ENDPOINT", "https://r2.example.com"),
        patch.object(dify_config, "PUBLIC_STORAGE_REGION", "auto"),
        patch.object(dify_config, "PUBLIC_STORAGE_BUCKET_NAME", "public-files"),
        patch.object(dify_config, "PUBLIC_STORAGE_ACCESS_KEY", "access-key"),
        patch.object(dify_config, "PUBLIC_STORAGE_SECRET_KEY", "secret-key"),
        patch.object(dify_config, "PUBLIC_STORAGE_ADDRESS_STYLE", "path"),
        patch("extensions.storage.aws_s3_storage.AwsS3Storage", return_value=storage_runner) as storage_factory,
    ):
        public_storage.init_app(Flask(__name__))

    assert public_storage.enabled is True
    assert public_storage.storage_runner is storage_runner
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


def test_public_storage_rejects_incomplete_configuration() -> None:
    public_storage = PublicStorage()

    with (
        patch.object(dify_config, "PUBLIC_STORAGE_ENABLED", True),
        patch.object(dify_config, "PUBLIC_STORAGE_ENDPOINT", "https://r2.example.com"),
        patch.object(dify_config, "PUBLIC_STORAGE_BUCKET_NAME", None),
        patch.object(dify_config, "PUBLIC_STORAGE_ACCESS_KEY", "access-key"),
        patch.object(dify_config, "PUBLIC_STORAGE_SECRET_KEY", "secret-key"),
        pytest.raises(ValueError, match="Public storage configuration is incomplete"),
    ):
        public_storage.init_app(Flask(__name__))
