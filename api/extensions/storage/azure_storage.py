from collections.abc import Generator
from contextlib import closing
from datetime import datetime, timedelta, timezone

from azure.storage.blob import AccountSasPermissions, BlobServiceClient, ResourceTypes, generate_account_sas
from flask import Flask

from extensions.ext_redis import redis_client
from extensions.storage.base_storage import BaseStorage


class AzureStorage(BaseStorage):
    """Implementation for azure storage.
    """

    def __init__(self, app: Flask):
        super().__init__(app)
        app_config = self.app.config
        self.bucket_name = app_config.get('AZURE_BLOB_CONTAINER_NAME')
        self.account_url = app_config.get('AZURE_BLOB_ACCOUNT_URL')
        self.account_name = app_config.get('AZURE_BLOB_ACCOUNT_NAME')
        self.account_key = app_config.get('AZURE_BLOB_ACCOUNT_KEY')

    def save(self, filename, data):
        client = self._sync_client()
        blob_container = client.get_container_client(container=self.bucket_name)
        blob_container.upload_blob(filename, data)

    def load_once(self, filename: str) -> bytes:
        client = self._sync_client()
        blob = client.get_container_client(container=self.bucket_name)
        blob = blob.get_blob_client(blob=filename)
        data = blob.download_blob().readall()
        return data

    def load_stream(self, filename: str) -> Generator:
        client = self._sync_client()

        def generate(filename: str = filename) -> Generator:
            blob = client.get_blob_client(container=self.bucket_name, blob=filename)
            with closing(blob.download_blob()) as blob_stream:
                while chunk := blob_stream.readall(4096):
                    yield chunk

        return generate()

    def download(self, filename, target_filepath):
        client = self._sync_client()

        blob = client.get_blob_client(container=self.bucket_name, blob=filename)
        with open(target_filepath, "wb") as my_blob:
            blob_data = blob.download_blob()
            blob_data.readinto(my_blob)

    def exists(self, filename):
        client = self._sync_client()

        blob = client.get_blob_client(container=self.bucket_name, blob=filename)
        return blob.exists()

    def delete(self, filename):
        client = self._sync_client()

        blob_container = client.get_container_client(container=self.bucket_name)
        blob_container.delete_blob(filename)

    def _sync_client(self):
        cache_key = 'azure_blob_sas_token_{}_{}'.format(self.account_name, self.account_key)
        cache_result = redis_client.get(cache_key)
        if cache_result is not None:
            sas_token = cache_result.decode('utf-8')
        else:
            sas_token = generate_account_sas(
                account_name=self.account_name,
                account_key=self.account_key,
                resource_types=ResourceTypes(service=True, container=True, object=True),
                permission=AccountSasPermissions(read=True, write=True, delete=True, list=True, add=True, create=True),
                expiry=datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(hours=1)
            )
            redis_client.set(cache_key, sas_token, ex=3000)
        return BlobServiceClient(account_url=self.account_url, credential=sas_token)
