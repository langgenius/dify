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
            result: str = str(cached.decode("utf-8"))
            return result
        return None

    def _cache_token(self, cache_key: str, token: str, expires_in: int):
        """Cache token in Redis with expiry."""
        # Set expiry 5 minutes before actual expiry to ensure token refresh
        redis_client.set(cache_key, token, ex=max(1, expires_in - 300))

    def _sync_client(self) -> BlobServiceClient:
        """Create a BlobServiceClient based on the configured authentication method."""
        if not self.account_url:
            raise ValueError("account_url is required")

        if self.auth_type == "account_key":
            if not self.account_key:
                raise ValueError("account_key is required for account_key authentication")
            return BlobServiceClient(account_url=self.account_url, credential=self.account_key)
        elif self.auth_type == "sas_token":
            # If SAS token is provided directly, use it
            if self.sas_token:
                return BlobServiceClient(account_url=self.account_url, credential=self.sas_token)
            # Generate and cache SAS token if account key is available
            elif self.account_key and self.account_name:
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
                    self._cache_token(cache_key, sas_token, 3600)  

                return BlobServiceClient(account_url=self.account_url, credential=sas_token)
            else:
                raise ValueError("Neither SAS token nor account key provided for SAS token authentication")

        elif self.auth_type == "service_principal":
            if not all([self.tenant_id, self.client_id, self.client_secret]):
                raise ValueError(
                    "tenant_id, client_id, and client_secret are required "
                    "for service_principal authentication"
                )
            cache_key = f"azure_sp_token_{self.client_id}"
            cached_token = self._get_cached_token(cache_key)

            if cached_token:
                return BlobServiceClient(account_url=self.account_url, credential=cached_token)

            try:
                assert self.tenant_id is not None
                assert self.client_id is not None
                assert self.client_secret is not None
                
                credential = ClientSecretCredential(
                    tenant_id=self.tenant_id,
                    client_id=self.client_id,
                    client_secret=self.client_secret
                )
                token = credential.get_token("https://storage.azure.com/.default")
                expires_in = 3600
                if hasattr(token, 'expires_on') and isinstance(token.expires_on, datetime):
                    time_diff = token.expires_on - datetime.now(UTC)
                    expires_in = int(time_diff.total_seconds())
                self._cache_token(cache_key, token.token, expires_in)

                return BlobServiceClient(account_url=self.account_url, credential=credential)
            except ClientAuthenticationError as e:
                raise ValueError(f"Failed to authenticate with Service Principal: {str(e)}")

        elif self.auth_type == "managed_identity":
            cache_key = "azure_msi_token"
            cached_token = self._get_cached_token(cache_key)

            if cached_token:
                return BlobServiceClient(account_url=self.account_url, credential=cached_token)

            try:
                credential: ClientSecretCredential = DefaultAzureCredential()  # type: ignore
                token = credential.get_token("https://storage.azure.com/.default")
                expires_in = 3600
                if hasattr(token, 'expires_on') and isinstance(token.expires_on, datetime):
                    time_diff = token.expires_on - datetime.now(UTC)
                    expires_in = int(time_diff.total_seconds())
                self._cache_token(cache_key, token.token, expires_in)

                return BlobServiceClient(account_url=self.account_url, credential=credential)
            except ClientAuthenticationError as e:
                raise ValueError(f"Failed to authenticate with Managed Identity: {str(e)}")
        else:
            raise ValueError(f"Unsupported authentication type: {self.auth_type}")

    def save(self, filename: str, data: bytes) -> None:
        if not self.bucket_name:
            raise ValueError("bucket_name is required")
            
        client = self._sync_client()
        blob_client = client.get_blob_client(container=self.bucket_name, blob=filename)
        blob_client.upload_blob(data)

    def load_once(self, filename: str) -> bytes:
        if not self.bucket_name:
            raise ValueError("bucket_name is required")
            
        client = self._sync_client()
        blob_client = client.get_blob_client(container=self.bucket_name, blob=filename)
        downloaded = blob_client.download_blob().readall()
        # Ensure we return bytes
        if isinstance(downloaded, str):
            data = downloaded.encode('utf-8')
        else:
            data = downloaded
        return data

    def load_stream(self, filename: str) -> Generator:
        if not self.bucket_name:
            raise ValueError("bucket_name is required")
            
        client = self._sync_client()
        blob_client = client.get_blob_client(container=self.bucket_name, blob=filename)
        blob_data = blob_client.download_blob()
        yield from blob_data.chunks()

    def download(self, filename: str, target_filepath: str) -> None:
        if not self.bucket_name:
            raise ValueError("bucket_name is required")
            
        client = self._sync_client()
        blob_client = client.get_blob_client(container=self.bucket_name, blob=filename)
        with open(target_filepath, "wb") as my_blob:
            blob_data = blob_client.download_blob()
            blob_data.readinto(my_blob)

    def exists(self, filename: str) -> bool:
        if not self.bucket_name:
            raise ValueError("bucket_name is required")
            
        client = self._sync_client()
        blob_client = client.get_blob_client(container=self.bucket_name, blob=filename)
        return blob_client.exists()

    def delete(self, filename: str) -> None:
        if not self.bucket_name:
            raise ValueError("bucket_name is required")
            
        client = self._sync_client()
        blob_client = client.get_blob_client(container=self.bucket_name, blob=filename)
        blob_client.delete_blob()
