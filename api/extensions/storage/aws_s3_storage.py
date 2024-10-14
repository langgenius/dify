import logging
from collections.abc import Generator

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError
from flask import Flask

from extensions.storage.base_storage import BaseStorage

logger = logging.getLogger(__name__)


class AwsS3Storage(BaseStorage):
    """Implementation for Amazon Web Services S3 storage."""

    def __init__(self, app: Flask):
        super().__init__(app)
        app_config = self.app.config
        self.bucket_name = app_config.get("S3_BUCKET_NAME")
        if app_config.get("S3_USE_AWS_MANAGED_IAM"):
            logger.info("Using AWS managed IAM role for S3")

            session = boto3.Session()
            region_name = app_config.get("S3_REGION")
            self.client = session.client(service_name="s3", region_name=region_name)
        else:
            logger.info("Using ak and sk for S3")

            self.client = boto3.client(
                "s3",
                aws_secret_access_key=app_config.get("S3_SECRET_KEY"),
                aws_access_key_id=app_config.get("S3_ACCESS_KEY"),
                endpoint_url=app_config.get("S3_ENDPOINT"),
                region_name=app_config.get("S3_REGION"),
                config=Config(s3={"addressing_style": app_config.get("S3_ADDRESS_STYLE")}),
            )
        # create bucket
        try:
            self.client.head_bucket(Bucket=self.bucket_name)
        except ClientError as e:
            # if bucket not exists, create it
            if e.response["Error"]["Code"] == "404":
                self.client.create_bucket(Bucket=self.bucket_name)
            # if bucket is not accessible, pass, maybe the bucket is existing but not accessible
            elif e.response["Error"]["Code"] == "403":
                pass
            else:
                # other error, raise exception
                raise

    def save(self, filename, data):
        self.client.put_object(Bucket=self.bucket_name, Key=filename, Body=data)

    def load_once(self, filename: str) -> bytes:
        try:
            data = self.client.get_object(Bucket=self.bucket_name, Key=filename)["Body"].read()
        except ClientError as ex:
            if ex.response["Error"]["Code"] == "NoSuchKey":
                raise FileNotFoundError("File not found")
            else:
                raise
        return data

    def load_stream(self, filename: str) -> Generator:
        def generate(filename: str = filename) -> Generator:
            try:
                response = self.client.get_object(Bucket=self.bucket_name, Key=filename)
                yield from response["Body"].iter_chunks()
            except ClientError as ex:
                if ex.response["Error"]["Code"] == "NoSuchKey":
                    raise FileNotFoundError("File not found")
                else:
                    raise

        return generate()

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
