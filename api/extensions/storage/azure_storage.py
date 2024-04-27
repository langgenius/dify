"""Abstract interface for file storage implementations."""
from collections.abc import Generator
from contextlib import closing

from extensions.storage.base_storage import BaseStorage


class AzureStorage(BaseStorage):
    """Interface for file storage.
    """

    def save(self, filename, data):
        blob_container = self.client.get_container_client(container=self.bucket_name)
        blob_container.upload_blob(filename, data)

    def load_once(self, filename: str) -> bytes:
        blob = self.client.get_container_client(container=self.bucket_name)
        blob = blob.get_blob_client(blob=filename)
        data = blob.download_blob().readall()
        return data

    def load_stream(self, filename: str) -> Generator:
        def generate(filename: str = filename) -> Generator:
            blob = self.client.get_blob_client(container=self.bucket_name, blob=filename)
            with closing(blob.download_blob()) as blob_stream:
                while chunk := blob_stream.readall(4096):
                    yield chunk

        return generate()

    def download(self, filename, target_filepath):
        blob = self.client.get_blob_client(container=self.bucket_name, blob=filename)
        with open(target_filepath, "wb") as my_blob:
            blob_data = blob.download_blob()
            blob_data.readinto(my_blob)

    def exists(self, filename):
        blob = self.client.get_blob_client(container=self.bucket_name, blob=filename)
        return blob.exists()

    def delete(self, filename):
        blob_container = self.client.get_container_client(container=self.bucket_name)
        blob_container.delete_blob(filename)