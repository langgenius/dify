import base64
import io
from collections.abc import Generator
from typing import Any, override

from google.api_core.exceptions import GoogleAPIError, NotFound, PreconditionFailed
from google.cloud import storage as google_cloud_storage  # type: ignore
from pydantic import TypeAdapter

from configs import dify_config
from extensions.storage.base_storage import BaseStorage

_service_account_adapter: TypeAdapter[dict[str, Any]] = TypeAdapter(dict[str, Any])


class GoogleCloudStorage(BaseStorage):
    """Implementation for Google Cloud storage."""

    def __init__(self):
        super().__init__()

        self.bucket_name = dify_config.GOOGLE_STORAGE_BUCKET_NAME
        service_account_json_str = dify_config.GOOGLE_STORAGE_SERVICE_ACCOUNT_JSON_BASE64
        # if service_account_json_str is empty, use Application Default Credentials
        if service_account_json_str:
            service_account_json = base64.b64decode(service_account_json_str).decode("utf-8")
            # convert str to object
            service_account_obj = _service_account_adapter.validate_json(service_account_json)
            self.client = google_cloud_storage.Client.from_service_account_info(service_account_obj)
        else:
            self.client = google_cloud_storage.Client()

    @override
    def save(self, filename, data):
        bucket = self.client.get_bucket(self.bucket_name)
        blob = bucket.blob(filename)
        with io.BytesIO(data) as stream:
            blob.upload_from_file(stream)

    @override
    def save_if_absent(self, filename: str, data: bytes) -> bool:
        """Publish only when the object has no live generation; never replace a winner."""
        try:
            self.client.bucket(self.bucket_name).blob(filename).upload_from_string(data, if_generation_match=0)
        except PreconditionFailed:
            return False
        except GoogleAPIError:
            raise OSError("GCS atomic creation failed") from None
        return True

    @override
    def load_once(self, filename: str) -> bytes:
        try:
            bucket = self.client.get_bucket(self.bucket_name)
            blob = bucket.get_blob(filename)
        except GoogleAPIError:
            raise OSError("GCS bucket read failed") from None
        if blob is None:
            raise FileNotFoundError("File not found")
        try:
            data: bytes = blob.download_as_bytes()
        except NotFound:
            raise FileNotFoundError("File not found") from None
        except GoogleAPIError:
            raise OSError("GCS object read failed") from None
        return data

    @override
    def load_stream(self, filename: str) -> Generator:
        bucket = self.client.get_bucket(self.bucket_name)
        blob = bucket.get_blob(filename)
        if blob is None:
            raise FileNotFoundError("File not found")
        with blob.open(mode="rb") as blob_stream:
            while chunk := blob_stream.read(4096):
                yield chunk

    @override
    def download(self, filename, target_filepath):
        bucket = self.client.get_bucket(self.bucket_name)
        blob = bucket.get_blob(filename)
        if blob is None:
            raise FileNotFoundError("File not found")
        blob.download_to_filename(target_filepath)

    @override
    def exists(self, filename):
        bucket = self.client.get_bucket(self.bucket_name)
        blob = bucket.blob(filename)
        return blob.exists()

    @override
    def delete(self, filename: str):
        bucket = self.client.get_bucket(self.bucket_name)
        bucket.delete_blob(filename)

    @override
    def scan(self, path: str, files: bool = True, directories: bool = False) -> list[str]:
        keys = (blob.name for blob in self.client.list_blobs(self.bucket_name, prefix=path))
        return self._filter_scan_keys(keys, files, directories)
