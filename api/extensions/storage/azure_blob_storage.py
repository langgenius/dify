from collections.abc import Generator
from datetime import UTC, datetime, timedelta

from azure.storage.blob import AccountSasPermissions, BlobServiceClient, ResourceTypes, generate_account_sas

from configs import dify_config
from extensions.ext_redis import redis_client
from extensions.storage.base_storage import BaseStorage


class AzureBlobStorage(BaseStorage):
    """Implementation for Azure Blob storage."""

    def __init__(self):
        super().__init__()
        self.bucket_name = dify_config.AZURE_BLOB_CONTAINER_NAME
        self.account_url = dify_config.AZURE_BLOB_ACCOUNT_URL
        self.account_name = dify_config.AZURE_BLOB_ACCOUNT_NAME
        self.account_key = dify_config.AZURE_BLOB_ACCOUNT_KEY

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
        blob = client.get_blob_client(container=self.bucket_name, blob=filename)
        blob_data = blob.download_blob()
        yield from blob_data.chunks()

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
        cache_key = "azure_blob_sas_token_{}_{}".format(self.account_name, self.account_key)
        cache_result = redis_client.get(cache_key)
        if cache_result is not None:
            sas_token = cache_result.decode("utf-8")
        else:
            sas_token = generate_account_sas(
                account_name=self.account_name,
                account_key=self.account_key,
                resource_types=ResourceTypes(service=True, container=True, object=True),
                permission=AccountSasPermissions(read=True, write=True, delete=True, list=True, add=True, create=True),
                expiry=datetime.now(UTC).replace(tzinfo=None) + timedelta(hours=1),
            )
            redis_client.set(cache_key, sas_token, ex=3000)
        return BlobServiceClient(account_url=self.account_url, credential=sas_token)
