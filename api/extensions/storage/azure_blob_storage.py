from collections.abc import Generator
from datetime import UTC, datetime, timedelta

from azure.core.exceptions import ClientAuthenticationError
from azure.identity import ClientSecretCredential, DefaultAzureCredential
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
        self.auth_type = dify_config.AZURE_BLOB_AUTH_TYPE

        # Account Key auth
        self.account_key = dify_config.AZURE_BLOB_ACCOUNT_KEY

        # SAS Token auth
        self.sas_token = dify_config.AZURE_BLOB_SAS_TOKEN

        # Service Principal auth
        self.client_id = dify_config.AZURE_BLOB_CLIENT_ID
        self.client_secret = dify_config.AZURE_BLOB_CLIENT_SECRET
        self.tenant_id = dify_config.AZURE_BLOB_TENANT_ID

    def _get_cached_token(self, cache_key: str) -> str | None:
        """Get cached token from Redis."""
        cached = redis_client.get(cache_key)
        if cached:
            return cached.decode("utf-8")
        return None

    def _cache_token(self, cache_key: str, token: str, expires_in: int):
        """Cache token in Redis with expiry."""
        # Set expiry 5 minutes before actual expiry to ensure token refresh
        redis_client.set(cache_key, token, ex=max(1, expires_in - 300))

    def _sync_client(self) -> BlobServiceClient:
        """Create a BlobServiceClient based on the configured authentication method."""
        if self.auth_type == "account_key":
            return BlobServiceClient(account_url=self.account_url, credential=self.account_key)
        elif self.auth_type == "sas_token":
            # If SAS token is provided directly, use it
            if self.sas_token:
                return BlobServiceClient(account_url=self.account_url, credential=self.sas_token)
            # Generate and cache SAS token if account key is available
            elif self.account_key:
                cache_key = f"azure_blob_sas_token_{self.account_name}"
                sas_token = self._get_cached_token(cache_key)

                if not sas_token:
                    sas_token = generate_account_sas(
                        account_name=self.account_name,
                        account_key=self.account_key,
                        resource_types=ResourceTypes(service=True, container=True, object=True),
                        permission=AccountSasPermissions(
                            read=True, write=True, delete=True, list=True, add=True, create=True
                        ),
                        expiry=datetime.now(UTC).replace(tzinfo=None) + timedelta(hours=1),
                    )
                    self._cache_token(cache_key, sas_token, 3600)  # Cache for 1 hour

                return BlobServiceClient(account_url=self.account_url, credential=sas_token)
            else:
                raise ValueError("Neither SAS token nor account key provided for SAS token authentication")

        elif self.auth_type == "service_principal":
            cache_key = f"azure_sp_token_{self.client_id}"
            cached_token = self._get_cached_token(cache_key)

            if cached_token:
                return BlobServiceClient(account_url=self.account_url, credential=cached_token)

            try:
                credential = ClientSecretCredential(
                    tenant_id=self.tenant_id, client_id=self.client_id, client_secret=self.client_secret
                )
                # Get token with 1 hour expiry
                token = credential.get_token("https://storage.azure.com/.default")
                self._cache_token(cache_key, token.token, token.expires_in)

                return BlobServiceClient(account_url=self.account_url, credential=credential)
            except ClientAuthenticationError as e:
                raise ValueError(f"Failed to authenticate with Service Principal: {str(e)}")

        elif self.auth_type == "managed_identity":
            cache_key = "azure_msi_token"
            cached_token = self._get_cached_token(cache_key)

            if cached_token:
                return BlobServiceClient(account_url=self.account_url, credential=cached_token)

            try:
                credential = DefaultAzureCredential()
                # Get token with 1 hour expiry
                token = credential.get_token("https://storage.azure.com/.default")
                self._cache_token(cache_key, token.token, token.expires_in)

                return BlobServiceClient(account_url=self.account_url, credential=credential)
            except ClientAuthenticationError as e:
                raise ValueError(f"Failed to authenticate with Managed Identity: {str(e)}")
        else:
            raise ValueError(f"Unsupported authentication type: {self.auth_type}")

    def save(self, filename, data):
        client = self._sync_client()
        blob_container = client.get_container_client(container=self.bucket_name)
        blob_container.upload_blob(filename, data)

    def load_once(self, filename: str) -> bytes:
        client = self._sync_client()
        blob = client.get_container_client(container=self.bucket_name)
        blob = blob.get_blob_client(blob=filename)
        data: bytes = blob.download_blob().readall()
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
