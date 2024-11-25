from collections.abc import Generator

from obs import ObsClient

from configs import dify_config
from extensions.storage.base_storage import BaseStorage


class HuaweiObsStorage(BaseStorage):
    """Implementation for Huawei OBS storage."""

    def __init__(self):
        super().__init__()

        self.bucket_name = dify_config.HUAWEI_OBS_BUCKET_NAME
        self.client = ObsClient(
            access_key_id=dify_config.HUAWEI_OBS_ACCESS_KEY,
            secret_access_key=dify_config.HUAWEI_OBS_SECRET_KEY,
            server=dify_config.HUAWEI_OBS_SERVER,
        )

    def save(self, filename, data):
        self.client.putObject(bucketName=self.bucket_name, objectKey=filename, content=data)

    def load_once(self, filename: str) -> bytes:
        data = self.client.getObject(bucketName=self.bucket_name, objectKey=filename)["body"].response.read()
        return data

    def load_stream(self, filename: str) -> Generator:
        response = self.client.getObject(bucketName=self.bucket_name, objectKey=filename)["body"].response
        while chunk := response.read(4096):
            yield chunk

    def download(self, filename, target_filepath):
        self.client.getObject(bucketName=self.bucket_name, objectKey=filename, downloadPath=target_filepath)

    def exists(self, filename):
        res = self._get_meta(filename)
        if res is None:
            return False
        return True

    def delete(self, filename):
        self.client.deleteObject(bucketName=self.bucket_name, objectKey=filename)

    def _get_meta(self, filename):
        res = self.client.getObjectMetadata(bucketName=self.bucket_name, objectKey=filename)
        if res.status < 300:
            return res
        else:
            return None
