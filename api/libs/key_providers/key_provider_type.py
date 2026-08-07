from enum import StrEnum


class KeyProviderType(StrEnum):
    LOCAL = "local"
    AZURE_KEYVAULT = "azure-keyvault"
