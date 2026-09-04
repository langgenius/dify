from unittest.mock import MagicMock, patch

from extensions.storage.aws_s3_storage import AwsS3Storage, AwsS3StorageSettings


def test_init_with_explicit_settings() -> None:
    client = MagicMock()
    settings = AwsS3StorageSettings(
        endpoint="https://r2.example.com",
        region="auto",
        bucket_name="public-files",
        access_key="access-key",
        secret_key="secret-key",
        address_style="path",
        use_aws_managed_iam=False,
    )

    with patch("extensions.storage.aws_s3_storage.boto3.client", return_value=client) as client_factory:
        storage = AwsS3Storage(settings)

    assert storage.bucket_name == "public-files"
    client.head_bucket.assert_called_once_with(Bucket="public-files")
    client_factory.assert_called_once()
    client_kwargs = client_factory.call_args.kwargs
    assert client_kwargs["endpoint_url"] == "https://r2.example.com"
    assert client_kwargs["region_name"] == "auto"
    assert client_kwargs["aws_access_key_id"] == "access-key"
    assert client_kwargs["aws_secret_access_key"] == "secret-key"
    assert client_kwargs["config"].s3 == {"addressing_style": "path"}


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


def test_save_sets_content_type_when_provided() -> None:
    storage = AwsS3Storage.__new__(AwsS3Storage)
    storage.bucket_name = "test-bucket"
    storage.client = MagicMock()

    storage.save("public/icon.png", b"image", content_type="image/png")

    storage.client.put_object.assert_called_once_with(
        Bucket="test-bucket",
        Key="public/icon.png",
        Body=b"image",
        ContentType="image/png",
    )
