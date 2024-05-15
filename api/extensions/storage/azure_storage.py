from collections.abc import Generator
from contextlib import closing
from datetime import datetime, timedelta, timezone

from azure.storage.blob import AccountSasPermissions, BlobServiceClient, ResourceTypes, generate_account_sas
from flask import Flask

from extensions.storage.base_storage import BaseStorage


class AzureStorage(BaseStorage):
    """Implementation for azure storage.
    """
    def __init__(self, app: Flask):
        super().__init__(app)
        app_config = self.app.config
        self.bucket_name = app_config.get('AZURE_STORAGE_CONTAINER_NAME')
        sas_token = generate_account_sas(
            account_name=app_config.get('AZURE_BLOB_ACCOUNT_NAME'),
            account_key=app_config.get('AZURE_BLOB_ACCOUNT_KEY'),
            resource_types=ResourceTypes(service=True, container=True, object=True),
            permission=AccountSasPermissions(read=True, write=True, delete=True, list=True, add=True, create=True),
            expiry=datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(hours=1)
        )
        self.client = BlobServiceClient(account_url=app_config.get('AZURE_BLOB_ACCOUNT_URL'),
                                        credential=sas_token)
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