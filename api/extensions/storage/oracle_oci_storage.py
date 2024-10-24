from collections.abc import Generator

import boto3
from botocore.exceptions import ClientError

from configs import dify_config
from extensions.storage.base_storage import BaseStorage


class OracleOCIStorage(BaseStorage):
    """Implementation for Oracle OCI storage."""

    def __init__(self):
        super().__init__()

        self.bucket_name = dify_config.OCI_BUCKET_NAME
        self.client = boto3.client(
            "s3",
            aws_secret_access_key=dify_config.OCI_SECRET_KEY,
            aws_access_key_id=dify_config.OCI_ACCESS_KEY,
            endpoint_url=dify_config.OCI_ENDPOINT,
            region_name=dify_config.OCI_REGION,
        )

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
        try:
            response = self.client.get_object(Bucket=self.bucket_name, Key=filename)
            yield from response["Body"].iter_chunks()
        except ClientError as ex:
            if ex.response["Error"]["Code"] == "NoSuchKey":
                raise FileNotFoundError("File not found")
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
