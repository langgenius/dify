from unittest.mock import MagicMock

from extensions.storage.aws_s3_storage import AwsS3Storage


def test_scan_reads_all_pages_and_filters_directory_markers() -> None:
    storage = AwsS3Storage.__new__(AwsS3Storage)
    storage.bucket_name = "test-bucket"
    storage.client = MagicMock()
    storage.client.get_paginator.return_value.paginate.return_value = [
        {"Contents": [{"Key": "ops_trace/app/"}, {"Key": "ops_trace/app/one.json"}]},
        {"Contents": [{"Key": "ops_trace/app/two.json"}]},
        dict[str, str](),
    ]
    assert storage.scan("ops_trace/app/") == ["ops_trace/app/one.json", "ops_trace/app/two.json"]
    storage.client.get_paginator.assert_called_once_with("list_objects_v2")
    storage.client.get_paginator.return_value.paginate.assert_called_once_with(
        Bucket="test-bucket", Prefix="ops_trace/app/"
    )


def test_generate_presigned_url() -> None:
    storage = AwsS3Storage.__new__(AwsS3Storage)
    storage.bucket_name = "test-bucket"
    storage.client = MagicMock()
    storage.client.generate_presigned_url.return_value = "https://s3.example.com/icon.png?signature=test"

    result = storage.generate_presigned_url(
        "upload_files/tenant/icon.png",
        expires_in=300,
        content_type="image/png",
    )

    assert result == "https://s3.example.com/icon.png?signature=test"
    storage.client.generate_presigned_url.assert_called_once_with(
        "get_object",
        Params={
            "Bucket": "test-bucket",
            "Key": "upload_files/tenant/icon.png",
            "ResponseContentType": "image/png",
        },
        ExpiresIn=300,
    )
