from typing import Any

from azure.storage.blob import BlobServiceClient

from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class AzureBlobStorage(BuiltinToolProviderController):
    """
    Azure Blob Storage provider
    """

    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        account_name = credentials.get("azure_blob_storage_account_name")
        api_key = credentials.get("azure_blob_storage_api_key")
        # connection_string = credentials.get("azure_blob_storage_connection_string")

        # ensure account name and api key are provided
        if not account_name:
            raise ToolProviderCredentialValidationError("Azure Blob Storage Account Name is required")
        if not api_key:
            raise ToolProviderCredentialValidationError("Azure Blob Storage API Key is required")

        # validate connection string
        try:
            blob_service_client = BlobServiceClient(
                account_url=f"https://{account_name}.blob.core.windows.net", credential=api_key
            )
            containers = blob_service_client.list_containers()
            containers_count = len(list(containers))
        except Exception:
            raise ToolProviderCredentialValidationError("Invalid Azure Blob Storage connection string")
