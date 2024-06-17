from collections.abc import Generator

from flask import Flask
from qcloud_cos import CosConfig, CosS3Client

from extensions.storage.base_storage import BaseStorage


class TencentStorage(BaseStorage):
    """Implementation for tencent cos storage.
    """

    def __init__(self, app: Flask):
        super().__init__(app)
        app_config = self.app.config
        self.bucket_name = app_config.get('TENCENT_COS_BUCKET_NAME')
        config = CosConfig(
            Region=app_config.get('TENCENT_COS_REGION'),
            SecretId=app_config.get('TENCENT_COS_SECRET_ID'),
            SecretKey=app_config.get('TENCENT_COS_SECRET_KEY'),
            Scheme=app_config.get('TENCENT_COS_SCHEME'),
        )
        self.client = CosS3Client(config)

    def save(self, filename, data):
        self.client.put_object(Bucket=self.bucket_name, Body=data, Key=filename)

    def load_once(self, filename: str) -> bytes:
        data = self.client.get_object(Bucket=self.bucket_name, Key=filename)['Body'].get_raw_stream().read()
        return data

    def load_stream(self, filename: str) -> Generator:
        def generate(filename: str = filename) -> Generator:
            response = self.client.get_object(Bucket=self.bucket_name, Key=filename)
            while chunk := response['Body'].get_stream(chunk_size=4096):
                yield chunk

        return generate()

    def download(self, filename, target_filepath):
        response = self.client.get_object(Bucket=self.bucket_name, Key=filename)
        response['Body'].get_stream_to_file(target_filepath)

    def exists(self, filename):
        return self.client.object_exists(Bucket=self.bucket_name, Key=filename)

    def delete(self, filename):
        self.client.delete_object(Bucket=self.bucket_name, Key=filename)
