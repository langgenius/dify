"""Unit tests for the common AWS S3 storage adapter."""

from unittest.mock import MagicMock, patch

import pytest

from extensions.storage.aws_s3_storage import AwsS3Storage


@pytest.fixture
def s3_storage() -> tuple[AwsS3Storage, MagicMock]:
    client = MagicMock()
    client.head_bucket.return_value = {}
    with (
        patch("extensions.storage.aws_s3_storage.boto3.client", return_value=client),
        patch("extensions.storage.aws_s3_storage.dify_config.S3_USE_AWS_MANAGED_IAM", False),
        patch("extensions.storage.aws_s3_storage.dify_config.S3_BUCKET_NAME", "dify-files"),
    ):
        storage = AwsS3Storage()
    return storage, client


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
