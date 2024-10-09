import base64
import io
import json
from collections.abc import Generator
from contextlib import closing

from flask import Flask
from google.cloud import storage as google_cloud_storage

from extensions.storage.base_storage import BaseStorage


class GoogleCloudStorage(BaseStorage):
    """Implementation for Google Cloud storage."""

    def __init__(self, app: Flask):
        super().__init__(app)
        app_config = self.app.config
        self.bucket_name = app_config.get("GOOGLE_STORAGE_BUCKET_NAME")
        service_account_json_str = app_config.get("GOOGLE_STORAGE_SERVICE_ACCOUNT_JSON_BASE64")
        # if service_account_json_str is empty, use Application Default Credentials
        if service_account_json_str:
            service_account_json = base64.b64decode(service_account_json_str).decode("utf-8")
            # convert str to object
            service_account_obj = json.loads(service_account_json)
            self.client = google_cloud_storage.Client.from_service_account_info(service_account_obj)
        else:
            self.client = google_cloud_storage.Client()

    def save(self, filename, data):
        bucket = self.client.get_bucket(self.bucket_name)
        blob = bucket.blob(filename)
        with io.BytesIO(data) as stream:
            blob.upload_from_file(stream)

    def load_once(self, filename: str) -> bytes:
        bucket = self.client.get_bucket(self.bucket_name)
        blob = bucket.get_blob(filename)
        data = blob.download_as_bytes()
        return data

    def load_stream(self, filename: str) -> Generator:
        def generate(filename: str = filename) -> Generator:
            bucket = self.client.get_bucket(self.bucket_name)
            blob = bucket.get_blob(filename)
            with closing(blob.open(mode="rb")) as blob_stream:
                while chunk := blob_stream.read(4096):
                    yield chunk

        return generate()

    def download(self, filename, target_filepath):
        bucket = self.client.get_bucket(self.bucket_name)
        blob = bucket.get_blob(filename)
        blob.download_to_filename(target_filepath)

    def exists(self, filename):
        bucket = self.client.get_bucket(self.bucket_name)
        blob = bucket.blob(filename)
        return blob.exists()

    def delete(self, filename):
        bucket = self.client.get_bucket(self.bucket_name)
        bucket.delete_blob(filename)
