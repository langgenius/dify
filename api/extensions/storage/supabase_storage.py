import io
from collections.abc import Generator
from pathlib import Path

from flask import Flask
from supabase import Client

from extensions.storage.base_storage import BaseStorage


class SupabaseStorage(BaseStorage):
    """Implementation for supabase obs storage."""

    def __init__(self, app: Flask):
        super().__init__(app)
        app_config = self.app.config
        self.bucket_name = app_config.get("SUPABASE_BUCKET_NAME")
        self.client = Client(
            supabase_url=app_config.get("SUPABASE_URL"), supabase_key=app_config.get("SUPABASE_API_KEY")
        )
        self.create_bucket(
            id=app_config.get("SUPABASE_BUCKET_NAME"), bucket_name=app_config.get("SUPABASE_BUCKET_NAME")
        )

    def create_bucket(self, id, bucket_name):
        if not self.bucket_exists():
            self.client.storage.create_bucket(id=id, name=bucket_name)

    def save(self, filename, data):
        self.client.storage.from_(self.bucket_name).upload(filename, data)

    def load_once(self, filename: str) -> bytes:
        content = self.client.storage.from_(self.bucket_name).download(filename)
        return content

    def load_stream(self, filename: str) -> Generator:
        def generate(filename: str = filename) -> Generator:
            result = self.client.storage.from_(self.bucket_name).download(filename)
            byte_stream = io.BytesIO(result)
            while chunk := byte_stream.read(4096):  # Read in chunks of 4KB
                yield chunk

        return generate()

    def download(self, filename, target_filepath):
        result = self.client.storage.from_(self.bucket_name).download(filename)
        Path(result).write_bytes(result)

    def exists(self, filename):
        result = self.client.storage.from_(self.bucket_name).list(filename)
        if result.count() > 0:
            return True
        return False

    def delete(self, filename):
        self.client.storage.from_(self.bucket_name).remove(filename)

    def bucket_exists(self):
        buckets = self.client.storage.list_buckets()
        return any(bucket.name == self.bucket_name for bucket in buckets)
