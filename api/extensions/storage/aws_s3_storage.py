import logging
from collections.abc import Generator
from urllib.parse import quote

import boto3
from botocore.client import BaseClient, Config
from botocore.exceptions import ClientError

from configs import dify_config
from extensions.storage.base_storage import BaseStorage

logger = logging.getLogger(__name__)


class AwsS3Storage(BaseStorage):
    """Implementation for Amazon Web Services S3 storage."""

    client: BaseClient

    def __init__(self):
        super().__init__()
        self.bucket_name = dify_config.S3_BUCKET_NAME

        # NOTE:
        # Some S3-compatible providers (e.g. MinIO) are strict about presigned request
        # signature calculation. If the client sends a `Content-Type` header while the
        # server generates a SigV2 presigned URL (or otherwise signs an empty Content-Type),
        # the request may be rejected with 403 (signature mismatch).
        #
        # Enforce SigV4 for presigned URLs to avoid accidental SigV2 fallback and to keep
        # header signing behavior consistent across providers.
        s3_client_config = Config(
            signature_version="s3v4",
            s3={"addressing_style": dify_config.S3_ADDRESS_STYLE},
        )
        if dify_config.S3_USE_AWS_MANAGED_IAM:
            logger.info("Using AWS managed IAM role for S3")

            session = boto3.Session()
            region_name = dify_config.S3_REGION
            self.client = session.client(
                service_name="s3",
                region_name=region_name,
                config=s3_client_config,
            )
        else:
            logger.info("Using ak and sk for S3")

            self.client = boto3.client(
                "s3",
                aws_secret_access_key=dify_config.S3_SECRET_KEY,
                aws_access_key_id=dify_config.S3_ACCESS_KEY,
                endpoint_url=dify_config.S3_ENDPOINT,
                region_name=dify_config.S3_REGION,
                config=s3_client_config,
            )
        # create bucket
        try:
            self.client.head_bucket(Bucket=self.bucket_name)
        except ClientError as e:
            # if bucket not exists, create it
            if e.response.get("Error", {}).get("Code") == "404":
                self.client.create_bucket(Bucket=self.bucket_name)
            # if bucket is not accessible, pass, maybe the bucket is existing but not accessible
            elif e.response.get("Error", {}).get("Code") == "403":
                pass
            else:
                # other error, raise exception
                raise

    def save(self, filename, data):
        self.client.put_object(Bucket=self.bucket_name, Key=filename, Body=data)

    def load_once(self, filename: str) -> bytes:
        try:
            data: bytes = self.client.get_object(Bucket=self.bucket_name, Key=filename)["Body"].read()
        except ClientError as ex:
            if ex.response.get("Error", {}).get("Code") == "NoSuchKey":
                raise FileNotFoundError("File not found")
            else:
                raise
        return data

    def load_stream(self, filename: str) -> Generator:
        try:
            response = self.client.get_object(Bucket=self.bucket_name, Key=filename)
            yield from response["Body"].iter_chunks()
        except ClientError as ex:
            if ex.response.get("Error", {}).get("Code") == "NoSuchKey":
                raise FileNotFoundError("file not found")
            elif "reached max retries" in str(ex):
                raise ValueError("please do not request the same file too frequently")
            else:
                raise

    def download(self, filename, target_filepath):
        self.client.download_file(self.bucket_name, filename, target_filepath)

    def exists(self, filename):
        try:
            self.client.head_object(Bucket=self.bucket_name, Key=filename)
            return True
        except:
            return False

    def delete(self, filename):
        self.client.delete_object(Bucket=self.bucket_name, Key=filename)

    def get_download_url(
        self,
        filename: str,
        expires_in: int = 3600,
        *,
        download_filename: str | None = None,
    ) -> str:
        """Generate a presigned download URL.

        Args:
            filename: The S3 object key
            expires_in: URL validity duration in seconds
            download_filename: If provided, sets Content-Disposition header so browser
                downloads the file with this name instead of the S3 key.
        """
        params: dict = {"Bucket": self.bucket_name, "Key": filename}
        if download_filename:
            # RFC 5987 / RFC 6266: Use both filename and filename* for compatibility.
            # filename* with UTF-8 encoding handles non-ASCII characters.
            encoded = quote(download_filename)
            params["ResponseContentDisposition"] = f"attachment; filename=\"{encoded}\"; filename*=UTF-8''{encoded}"
        url: str = self.client.generate_presigned_url(
            ClientMethod="get_object",
            Params=params,
            ExpiresIn=expires_in,
        )
        return url

    def get_download_urls(
        self,
        filenames: list[str],
        expires_in: int = 3600,
        *,
        download_filenames: list[str] | None = None,
    ) -> list[str]:
        """Generate presigned download URLs for multiple files.

        Args:
            filenames: List of S3 object keys
            expires_in: URL validity duration in seconds
            download_filenames: If provided, must match len(filenames). Sets
                Content-Disposition for each file.
        """
        if download_filenames is None:
            return [
                self.client.generate_presigned_url(
                    ClientMethod="get_object",
                    Params={"Bucket": self.bucket_name, "Key": filename},
                    ExpiresIn=expires_in,
                )
                for filename in filenames
            ]

        urls: list[str] = []
        for filename, download_filename in zip(filenames, download_filenames, strict=True):
            params: dict = {"Bucket": self.bucket_name, "Key": filename}
            if download_filename:
                encoded = quote(download_filename)
                params["ResponseContentDisposition"] = f"attachment; filename=\"{encoded}\"; filename*=UTF-8''{encoded}"
            urls.append(
                self.client.generate_presigned_url(
                    ClientMethod="get_object",
                    Params=params,
                    ExpiresIn=expires_in,
                )
            )
        return urls

    def get_upload_url(self, filename: str, expires_in: int = 3600) -> str:
        url: str = self.client.generate_presigned_url(
            ClientMethod="put_object",
            Params={"Bucket": self.bucket_name, "Key": filename},
            ExpiresIn=expires_in,
        )
        return url
