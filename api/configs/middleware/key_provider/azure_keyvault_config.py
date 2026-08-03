from pydantic import Field
from pydantic_settings import BaseSettings


class AzureKeyVaultConfig(BaseSettings):
    """
    Configuration settings for Azure Key Vault, used as a tenant credential encryption key provider
    """

    AZURE_KEYVAULT_VAULT_URL: str | None = Field(
        description="URL of the Azure Key Vault instance (e.g., 'https://<your-vault-name>.vault.azure.net')."
        " Required when KEY_PROVIDER_TYPE is set to 'azure-keyvault'. Authentication uses"
        " DefaultAzureCredential (managed identity, environment variables, or Azure CLI login).",
        default=None,
    )

    AZURE_KEYVAULT_KEY_SIZE: int = Field(
        description="RSA key size (in bits) used when Dify provisions a new per-tenant key in Azure Key Vault.",
        default=2048,
    )

    AZURE_KEYVAULT_ROTATION_INTERVAL_DAYS: int | None = Field(
        description="If set, Dify configures each newly-created per-tenant Key Vault key to auto-rotate every"
        " N days (using a 'time after create' trigger, with no expiry set on generated versions)."
        " Old key versions are kept forever and remain usable for decrypting credentials encrypted"
        " before the rotation, so rotation requires no manual re-encryption. Leave unset (default) to"
        " not configure a rotation policy and manage rotation manually in Azure. Must be at least 7 days.",
        default=None,
        ge=7,
    )
