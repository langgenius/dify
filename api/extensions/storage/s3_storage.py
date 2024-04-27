"""Abstract interface for file storage implementations."""
from collections.abc import Generator
from contextlib import closing

from botocore.exceptions import ClientError

from extensions.storage.base_storage import BaseStorage


class S3Storage(BaseStorage):
    """Interface for file storage.
    """

    def save(self, filename, data):
        self.client.put_object(Bucket=self.bucket_name, Key=filename, Body=data)

    def load_once(self, filename: str) -> bytes:
        try:
            with closing(self.client) as client:
                data = client.get_object(Bucket=self.bucket_name, Key=filename)['Body'].read()
        except ClientError as ex:
            if ex.response['Error']['Code'] == 'NoSuchKey':
                raise FileNotFoundError("File not found")
            else:
                raise
        return data

    def load_stream(self, filename: str) -> Generator:
        def generate(filename: str = filename) -> Generator:
            try:
                with closing(self.client) as client:
                    response = client.get_object(Bucket=self.bucket_name, Key=filename)
                    for chunk in response['Body'].iter_chunks():
                        yield chunk
            except ClientError as ex:
                if ex.response['Error']['Code'] == 'NoSuchKey':
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
