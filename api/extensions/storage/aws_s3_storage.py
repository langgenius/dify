import logging
from collections.abc import Generator
from dataclasses import dataclass
from typing import Literal, override

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError

from configs import dify_config
from extensions.storage.base_storage import BaseStorage

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class AwsS3StorageSettings:
    """Connection settings for one S3-compatible storage instance."""

    endpoint: str | None
    region: str | None
    bucket_name: str | None
    access_key: str | None
    secret_key: str | None
    address_style: Literal["auto", "virtual", "path"]
    use_aws_managed_iam: bool

    @classmethod
    def from_dify_config(cls) -> "AwsS3StorageSettings":
        return cls(
            endpoint=dify_config.S3_ENDPOINT,
            region=dify_config.S3_REGION,
            bucket_name=dify_config.S3_BUCKET_NAME,
            access_key=dify_config.S3_ACCESS_KEY,
            secret_key=dify_config.S3_SECRET_KEY,
            address_style=dify_config.S3_ADDRESS_STYLE,
            use_aws_managed_iam=dify_config.S3_USE_AWS_MANAGED_IAM,
        )


class AwsS3Storage(BaseStorage):
    """Implementation for S3-compatible storage using explicit or default settings."""

    def __init__(self, settings: AwsS3StorageSettings | None = None):
        super().__init__()
        settings = settings or AwsS3StorageSettings.from_dify_config()
        self.bucket_name = settings.bucket_name
        if settings.use_aws_managed_iam:
            logger.info("Using AWS managed IAM role for S3")

            session = boto3.Session()
            self.client = session.client(service_name="s3", region_name=settings.region)
        else:
            logger.info("Using ak and sk for S3")

            self.client = boto3.client(
                "s3",
                aws_secret_access_key=settings.secret_key,
                aws_access_key_id=settings.access_key,
                endpoint_url=settings.endpoint,
                region_name=settings.region,
                config=Config(s3={"addressing_style": settings.address_style}),
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

    @override
    def save(self, filename: str, data: bytes, *, content_type: str | None = None) -> None:
        params = {"Bucket": self.bucket_name, "Key": filename, "Body": data}
        if content_type is not None:
            params["ContentType"] = content_type
        self.client.put_object(**params)

    @override
    def load_once(self, filename: str) -> bytes:
        try:
            data: bytes = self.client.get_object(Bucket=self.bucket_name, Key=filename)["Body"].read()
        except ClientError as ex:
            if ex.response.get("Error", {}).get("Code") == "NoSuchKey":
                raise FileNotFoundError("File not found")
            else:
                raise
        return data

    @override
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

    @override
    def download(self, filename, target_filepath):
        self.client.download_file(self.bucket_name, filename, target_filepath)

    @override
    def exists(self, filename):
        try:
            self.client.head_object(Bucket=self.bucket_name, Key=filename)
            return True
        except ClientError:
            return False

    @override
    def delete(self, filename: str):
        self.client.delete_object(Bucket=self.bucket_name, Key=filename)

    @override
    def generate_presigned_url(
        self,
        filename: str,
        *,
        expires_in: int,
        content_type: str | None = None,
    ) -> str:
        params = {"Bucket": self.bucket_name, "Key": filename}
        if content_type:
            params["ResponseContentType"] = content_type

        return self.client.generate_presigned_url(
            "get_object",
            Params=params,
            ExpiresIn=expires_in,
        )
