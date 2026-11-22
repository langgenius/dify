"""Unit tests for the common AWS S3 storage adapter."""

from collections.abc import Callable
from unittest.mock import MagicMock, patch

import pytest
from botocore.exceptions import ClientError

from extensions.storage.aws_s3_storage import AwsS3Storage


@pytest.fixture
def s3_storage(config_overrides: Callable[..., None]) -> tuple[AwsS3Storage, MagicMock]:
    client = MagicMock()
    client.head_bucket.return_value = dict[str, object]()
    config_overrides(S3_USE_AWS_MANAGED_IAM=False, S3_BUCKET_NAME="dify-files")
    with patch("extensions.storage.aws_s3_storage.boto3.client", return_value=client):
        storage = AwsS3Storage()
    return storage, client


@pytest.mark.parametrize("code", ["404", "NoSuchKey"])
def test_exists_returns_false_for_missing_keys(s3_storage: tuple[AwsS3Storage, MagicMock], code: str) -> None:
    storage, client = s3_storage
    client.head_object.side_effect = ClientError({"Error": {"Code": code}}, "HeadObject")
    assert not storage.exists("logs/export.csv")


@pytest.mark.parametrize("code", ["AccessDenied", "SlowDown", "503", "NoSuchBucket"])
def test_exists_propagates_s3_failures(s3_storage: tuple[AwsS3Storage, MagicMock], code: str) -> None:
    storage, client = s3_storage
    client.head_object.side_effect = ClientError({"Error": {"Code": code}}, "HeadObject")
    with pytest.raises(ClientError):
        storage.exists("logs/export.csv")


def test_generate_presigned_url(s3_storage: tuple[AwsS3Storage, MagicMock]) -> None:
    storage, client = s3_storage
    client.generate_presigned_url.return_value = "https://s3.example.com/icon.png?signature=test"

    result = storage.generate_presigned_url(
        "upload_files/tenant/icon.png",
        expires_in=300,
        content_type="image/png",
    )

    assert result == "https://s3.example.com/icon.png?signature=test"
    client.generate_presigned_url.assert_called_once_with(
        "get_object",
        Params={
            "Bucket": "dify-files",
            "Key": "upload_files/tenant/icon.png",
            "ResponseContentType": "image/png",
        },
        ExpiresIn=300,
    )


def test_generate_presigned_url_for_attachment(s3_storage: tuple[AwsS3Storage, MagicMock]) -> None:
    storage, client = s3_storage

    storage.generate_presigned_url(
        "logs/export.csv",
        expires_in=300,
        content_type="text/csv; charset=utf-8",
        download_filename="应用日志.csv",
    )

    client.generate_presigned_url.assert_called_once_with(
        "get_object",
        Params={
            "Bucket": "dify-files",
            "Key": "logs/export.csv",
            "ResponseContentType": "text/csv; charset=utf-8",
            "ResponseContentDisposition": "attachment; filename*=UTF-8''%E5%BA%94%E7%94%A8%E6%97%A5%E5%BF%97.csv",
        },
        ExpiresIn=300,
    )


def test_scan_lists_recursive_files_and_derived_directories(
    s3_storage: tuple[AwsS3Storage, MagicMock],
) -> None:
    storage, client = s3_storage
    paginator = client.get_paginator.return_value
    paginator.paginate.return_value = [
        {
            "Contents": [
                {"Key": "knowledge-fs/objects/tenant-1/a.txt"},
                {"Key": "knowledge-fs/objects/tenant-1/nested/b.txt"},
                {"Key": "knowledge-fs/objects/tenant-1/empty/"},
            ]
        },
        {"Contents": [{"Key": "knowledge-fs/objects/tenant-1/nested/c.txt"}]},
    ]

    result = storage.scan(
        "knowledge-fs/objects/tenant-1",
        files=True,
        directories=True,
    )

    assert result == [
        "knowledge-fs/objects/tenant-1/a.txt",
        "knowledge-fs/objects/tenant-1/empty/",
        "knowledge-fs/objects/tenant-1/nested/",
        "knowledge-fs/objects/tenant-1/nested/b.txt",
        "knowledge-fs/objects/tenant-1/nested/c.txt",
    ]
    client.get_paginator.assert_called_once_with("list_objects_v2")
    paginator.paginate.assert_called_once_with(
        Bucket="dify-files",
        Prefix="knowledge-fs/objects/tenant-1/",
    )


def test_scan_rejects_request_without_files_or_directories(
    s3_storage: tuple[AwsS3Storage, MagicMock],
) -> None:
    storage, _ = s3_storage

    with pytest.raises(ValueError, match="At least one"):
        storage.scan("knowledge-fs", files=False, directories=False)
