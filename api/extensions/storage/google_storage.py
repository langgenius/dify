import base64
from collections.abc import Generator
from contextlib import closing

from flask import Flask
from google.cloud import storage as GoogleCloudStorage

from extensions.storage.base_storage import BaseStorage


class GoogleStorage(BaseStorage):
    """Implementation for google storage.
    """
    def __init__(self, app: Flask):
        super().__init__(app)
        app_config = self.app.config
        self.bucket_name = app_config.get('GOOGLE_STORAGE_BUCKET_NAME')
        service_account_json = base64.b64decode(app_config.get('GOOGLE_STORAGE_SERVICE_ACCOUNT_JSON_BASE64')).decode(
            'utf-8')
        self.client = GoogleCloudStorage.Client().from_service_account_json(service_account_json)

    def save(self, filename, data):
        bucket = self.client.get_bucket(self.bucket_name)
        blob = bucket.blob(filename)
        blob.upload_from_file(data)

    def load_once(self, filename: str) -> bytes:
        bucket = self.client.get_bucket(self.bucket_name)
        blob = bucket.get_blob(filename)
        data = blob.download_as_bytes()
        return data

    def load_stream(self, filename: str) -> Generator:
        def generate(filename: str = filename) -> Generator:
            bucket = self.client.get_bucket(self.bucket_name)
            blob = bucket.get_blob(filename)
            with closing(blob.open(mode='rb')) as blob_stream:
                while chunk := blob_stream.read(4096):
                    yield chunk
        return generate()

    def download(self, filename, target_filepath):
        bucket = self.client.get_bucket(self.bucket_name)
        blob = bucket.get_blob(filename)
        with open(target_filepath, "wb") as my_blob:
            blob_data = blob.download_blob()
            blob_data.readinto(my_blob)

    def exists(self, filename):
        bucket = self.client.get_bucket(self.bucket_name)
        blob = bucket.blob(filename)
        return blob.exists()

    def delete(self, filename):
        bucket = self.client.get_bucket(self.bucket_name)
        bucket.delete_blob(filename)