import logging
from collections.abc import Generator
from typing import override

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError

from configs import dify_config
from extensions.storage.base_storage import BaseStorage
from libs.stream import close_stream

logger = logging.getLogger(__name__)


class AwsS3Storage(BaseStorage):
    """Implementation for Amazon Web Services S3 storage."""

    def __init__(self):
        super().__init__()
        self.bucket_name = dify_config.S3_BUCKET_NAME
        if dify_config.S3_USE_AWS_MANAGED_IAM:
            logger.info("Using AWS managed IAM role for S3")

            session = boto3.Session()
            region_name = dify_config.S3_REGION
            self.client = session.client(service_name="s3", region_name=region_name)
        else:
            logger.info("Using ak and sk for S3")

            self.client = boto3.client(
                "s3",
                aws_secret_access_key=dify_config.S3_SECRET_KEY,
                aws_access_key_id=dify_config.S3_ACCESS_KEY,
                endpoint_url=dify_config.S3_ENDPOINT,
                region_name=dify_config.S3_REGION,
                config=Config(s3={"addressing_style": dify_config.S3_ADDRESS_STYLE}),
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
    def save(self, filename, data):
        self.client.put_object(Bucket=self.bucket_name, Key=filename, Body=data)

    @override
    def scan(self, path: str, files: bool = True, directories: bool = False) -> list[str]:
        if not files and not directories:
            raise ValueError("At least one of files or directories must be True")
        keys: list[str] = []
        paginator = self.client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self.bucket_name, Prefix=path):
            for obj in page.get("Contents", []):
                key = obj["Key"]
                if (key.endswith("/") and directories) or (not key.endswith("/") and files):
                    keys.append(key)
        return keys

    @override
    def load_once(self, filename: str) -> bytes:
        try:
            body = self.client.get_object(Bucket=self.bucket_name, Key=filename)["Body"]
            try:
                data: bytes = body.read()
            finally:
                close_stream(body)
        except ClientError as ex:
            if ex.response.get("Error", {}).get("Code") == "NoSuchKey":
                raise FileNotFoundError("File not found") from ex
            else:
                raise
        return data

    @override
    def load_stream(self, filename: str) -> Generator:
        try:
            response = self.client.get_object(Bucket=self.bucket_name, Key=filename)
            body = response["Body"]
            try:
                yield from body.iter_chunks()
            finally:
                close_stream(body)
        except ClientError as ex:
            if ex.response.get("Error", {}).get("Code") == "NoSuchKey":
                raise FileNotFoundError("file not found") from ex
            elif "reached max retries" in str(ex):
                raise ValueError("please do not request the same file too frequently") from ex
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
