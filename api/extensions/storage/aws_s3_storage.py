from collections.abc import Generator
from contextlib import closing

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError

from configs import dify_config
from extensions.storage.base_storage import BaseStorage


class AwsS3Storage(BaseStorage):
    """Implementation for Amazon Web Services S3 storage."""

    def __init__(self):
        super().__init__()
        self.bucket_name = dify_config.S3_BUCKET_NAME
        if dify_config.S3_USE_AWS_MANAGED_IAM:
            session = boto3.Session()
            self.client = session.client("s3")
        else:
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
            with closing(self.client) as client:
                data = client.get_object(Bucket=self.bucket_name, Key=filename)["Body"].read()
        except ClientError as ex:
            if ex.response["Error"]["Code"] == "NoSuchKey":
                raise FileNotFoundError("File not found")
            else:
                raise
        return data

    def load_stream(self, filename: str) -> Generator:
        def generate(filename: str = filename) -> Generator:
            try:
                with closing(self.client) as client:
                    response = client.get_object(Bucket=self.bucket_name, Key=filename)
                    yield from response["Body"].iter_chunks()
            except ClientError as ex:
                if ex.response["Error"]["Code"] == "NoSuchKey":
                    raise FileNotFoundError("File not found")
                else:
                    raise

        return generate()

    def download(self, filename, target_filepath):
        with closing(self.client) as client:
            client.download_file(self.bucket_name, filename, target_filepath)

    def exists(self, filename):
        with closing(self.client) as client:
            try:
                client.head_object(Bucket=self.bucket_name, Key=filename)
                return True
            except:
                return False

    def delete(self, filename):
        self.client.delete_object(Bucket=self.bucket_name, Key=filename)
