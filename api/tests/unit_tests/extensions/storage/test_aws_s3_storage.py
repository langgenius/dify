from unittest.mock import Mock, patch

from botocore.exceptions import ClientError

from extensions.storage.aws_s3_storage import AwsS3Storage


def _build_storage(public_base_url: str | None = None) -> AwsS3Storage:
    with patch("extensions.storage.aws_s3_storage.dify_config", autospec=True) as mock_config:
        mock_config.S3_BUCKET_NAME = "test-bucket"
        mock_config.S3_PUBLIC_BASE_URL = public_base_url
        mock_config.S3_USE_AWS_MANAGED_IAM = False
        mock_config.S3_ACCESS_KEY = "ak"
        mock_config.S3_SECRET_KEY = "sk"
        mock_config.S3_ENDPOINT = "https://example.com"
        mock_config.S3_REGION = "auto"
        mock_config.S3_ADDRESS_STYLE = "auto"

        with patch("extensions.storage.aws_s3_storage.boto3") as mock_boto3:
            client = Mock()
            client.head_bucket.return_value = None
            mock_boto3.client.return_value = client
            mock_boto3.Session.return_value.client.return_value = client
            return AwsS3Storage()


class TestAwsS3StoragePublicUrl:
    def test_returns_none_when_public_base_url_unset(self):
        storage = _build_storage(public_base_url=None)
        assert storage.get_public_url("upload_files/tenant/abc.png") is None

    def test_returns_none_when_public_base_url_empty_string(self):
        storage = _build_storage(public_base_url="")
        assert storage.get_public_url("upload_files/tenant/abc.png") is None

    def test_composes_url_when_configured(self):
        storage = _build_storage(public_base_url="https://cdn.example.com")
        assert (
            storage.get_public_url("upload_files/tenant/abc.png")
            == "https://cdn.example.com/upload_files/tenant/abc.png"
        )

    def test_strips_trailing_slash(self):
        storage = _build_storage(public_base_url="https://cdn.example.com/")
        assert (
            storage.get_public_url("upload_files/tenant/abc.png")
            == "https://cdn.example.com/upload_files/tenant/abc.png"
        )

    def test_preserves_path_separators_in_key(self):
        # Object key path separators must not be percent-encoded.
        storage = _build_storage(public_base_url="https://cdn.example.com")
        url = storage.get_public_url("a/b/c.txt")
        assert url == "https://cdn.example.com/a/b/c.txt"

    def test_quotes_unsafe_characters_in_key(self):
        storage = _build_storage(public_base_url="https://cdn.example.com")
        url = storage.get_public_url("upload_files/has space.png")
        assert url == "https://cdn.example.com/upload_files/has%20space.png"


class TestAwsS3StorageBucketCheck:
    def test_init_handles_403_on_head_bucket(self):
        # Regression: R2 / hardened buckets often return 403 on head_bucket; the
        # constructor must swallow the error instead of crashing.
        with patch("extensions.storage.aws_s3_storage.dify_config", autospec=True) as mock_config:
            mock_config.S3_BUCKET_NAME = "test-bucket"
            mock_config.S3_PUBLIC_BASE_URL = None
            mock_config.S3_USE_AWS_MANAGED_IAM = False
            mock_config.S3_ACCESS_KEY = "ak"
            mock_config.S3_SECRET_KEY = "sk"
            mock_config.S3_ENDPOINT = "https://example.com"
            mock_config.S3_REGION = "auto"
            mock_config.S3_ADDRESS_STYLE = "auto"

            with patch("extensions.storage.aws_s3_storage.boto3") as mock_boto3:
                client = Mock()
                client.head_bucket.side_effect = ClientError(
                    {"Error": {"Code": "403", "Message": "Forbidden"}}, "HeadBucket"
                )
                mock_boto3.client.return_value = client
                storage = AwsS3Storage()
                assert storage.bucket_name == "test-bucket"
                client.create_bucket.assert_not_called()
