import io
from collections.abc import Generator
from pathlib import Path
from typing import override

from supabase import Client

from configs import dify_config
from extensions.storage.base_storage import BaseStorage


class SupabaseStorage(BaseStorage):
    """Implementation for supabase obs storage."""

    def __init__(self):
        super().__init__()
        if dify_config.SUPABASE_URL is None:
            raise ValueError("SUPABASE_URL is not set")
        if dify_config.SUPABASE_API_KEY is None:
            raise ValueError("SUPABASE_API_KEY is not set")
        if dify_config.SUPABASE_BUCKET_NAME is None:
            raise ValueError("SUPABASE_BUCKET_NAME is not set")

        self.bucket_name = dify_config.SUPABASE_BUCKET_NAME
        self.client = Client(supabase_url=dify_config.SUPABASE_URL, supabase_key=dify_config.SUPABASE_API_KEY)
        self.create_bucket(id=dify_config.SUPABASE_BUCKET_NAME, bucket_name=dify_config.SUPABASE_BUCKET_NAME)

    def create_bucket(self, id, bucket_name):
        if not self.bucket_exists():
            self.client.storage.create_bucket(id=id, name=bucket_name)

    @override
    def save(self, filename, data):
        self.client.storage.from_(self.bucket_name).upload(filename, data)

    @override
    def load_once(self, filename: str) -> bytes:
        content: bytes = self.client.storage.from_(self.bucket_name).download(filename)
        return content

    @override
    def load_stream(self, filename: str) -> Generator:
        result = self.client.storage.from_(self.bucket_name).download(filename)
        byte_stream = io.BytesIO(result)
        while chunk := byte_stream.read(4096):  # Read in chunks of 4KB
            yield chunk

    @override
    def download(self, filename, target_filepath):
        result = self.client.storage.from_(self.bucket_name).download(filename)
        Path(target_filepath).write_bytes(result)

    @override
    def exists(self, filename):
        result = self.client.storage.from_(self.bucket_name).list(path=filename)
        return len(result) > 0

    @override
    def delete(self, filename: str):
        self.client.storage.from_(self.bucket_name).remove([filename])

    @override
    def scan(self, path: str, files: bool = True, directories: bool = False) -> list[str]:
        bucket = self.client.storage.from_(self.bucket_name)
        # Supabase lists only immediate children, with offset pagination.
        root = path.rstrip("/") if path.endswith("/") else path.rpartition("/")[0]
        pending = [root]
        keys: list[str] = []
        page_size = 100
        while pending:
            folder = pending.pop()
            offset = 0
            while True:
                page = bucket.list(
                    path=folder,
                    options={
                        "limit": page_size,
                        "offset": offset,
                        "sortBy": {"column": "name", "order": "asc"},
                    },
                )
                for entry in page:
                    key = f"{folder}/{entry['name']}" if folder else entry["name"]
                    if entry.get("id") is None:
                        directory_key = key + "/"
                        if directory_key.startswith(path) or path.startswith(directory_key):
                            pending.append(key)
                            if directory_key.startswith(path):
                                keys.append(directory_key)
                    elif key.startswith(path):
                        keys.append(key)
                if len(page) < page_size:
                    break
                offset += page_size
        return self._filter_scan_keys(keys, files, directories)

    def bucket_exists(self):
        buckets = self.client.storage.list_buckets()
        return any(bucket.name == self.bucket_name for bucket in buckets)
