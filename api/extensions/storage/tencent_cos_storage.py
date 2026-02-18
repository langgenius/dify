from collections.abc import Generator

from qcloud_cos import CosConfig, CosS3Client

from configs import dify_config
from extensions.storage.base_storage import BaseStorage


class TencentCosStorage(BaseStorage):
    """Implementation for Tencent Cloud COS storage."""

    def __init__(self):
        super().__init__()

        self.bucket_name = dify_config.TENCENT_COS_BUCKET_NAME
        if dify_config.TENCENT_COS_CUSTOM_DOMAIN:
            config = CosConfig(
                Domain=dify_config.TENCENT_COS_CUSTOM_DOMAIN,
                SecretId=dify_config.TENCENT_COS_SECRET_ID,
                SecretKey=dify_config.TENCENT_COS_SECRET_KEY,
                Scheme=dify_config.TENCENT_COS_SCHEME,
            )
        else:
            config = CosConfig(
                Region=dify_config.TENCENT_COS_REGION,
                SecretId=dify_config.TENCENT_COS_SECRET_ID,
                SecretKey=dify_config.TENCENT_COS_SECRET_KEY,
                Scheme=dify_config.TENCENT_COS_SCHEME,
            )
        self.client = CosS3Client(config)

    def save(self, filename, data):
        self.client.put_object(Bucket=self.bucket_name, Body=data, Key=filename)

    def load_once(self, filename: str) -> bytes:
        data: bytes = self.client.get_object(Bucket=self.bucket_name, Key=filename)["Body"].get_raw_stream().read()
        return data

    def load_stream(self, filename: str) -> Generator:
        response = self.client.get_object(Bucket=self.bucket_name, Key=filename)
        yield from response["Body"].get_stream(chunk_size=4096)

    def download(self, filename, target_filepath):
        response = self.client.get_object(Bucket=self.bucket_name, Key=filename)
        response["Body"].get_stream_to_file(target_filepath)

    def exists(self, filename):
        return self.client.object_exists(Bucket=self.bucket_name, Key=filename)

    def delete(self, filename):
        self.client.delete_object(Bucket=self.bucket_name, Key=filename)
