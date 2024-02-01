from typing import Any, Dict

from core.helper import encrypter
from core.tools.entities.tool_entities import ToolProviderCredentials
from core.tools.provider.tool_provider import ToolProviderController
from pydantic import BaseModel


class ToolConfiguration(BaseModel):
    tenant_id: str
    provider_controller: ToolProviderController

    def _deep_copy(self, credentials: Dict[str, str]) -> Dict[str, str]:
        """
        deep copy credentials
        """
        return {key: value for key, value in credentials.items()}
    
    def encrypt_tool_credentials(self, credentials: Dict[str, str]) -> Dict[str, str]:
        """
        encrypt tool credentials with tenant id

        return a deep copy of credentials with encrypted values
        """
        credentials = self._deep_copy(credentials)

        # get fields need to be decrypted
        fields = self.provider_controller.get_credentials_schema()
        for field_name, field in fields.items():
            if field.type == ToolProviderCredentials.CredentialsType.SECRET_INPUT:
                if field_name in credentials:
                    encrypted = encrypter.encrypt_token(self.tenant_id, credentials[field_name])
                    credentials[field_name] = encrypted
        
        return credentials
    
    def mask_tool_credentials(self, credentials: Dict[str, Any]) -> Dict[str, Any]:
        """
        mask tool credentials

        return a deep copy of credentials with masked values
        """
        credentials = self._deep_copy(credentials)

        # get fields need to be decrypted
        fields = self.provider_controller.get_credentials_schema()
        for field_name, field in fields.items():
            if field.type == ToolProviderCredentials.CredentialsType.SECRET_INPUT:
                if field_name in credentials:
                    if len(credentials[field_name]) > 6:
                        credentials[field_name] = \
                            credentials[field_name][:2] + \
                            '*' * (len(credentials[field_name]) - 4) +\
                            credentials[field_name][-2:]
                    else:
                        credentials[field_name] = '*' * len(credentials[field_name])

        return credentials

    def decrypt_tool_credentials(self, credentials: Dict[str, str]) -> Dict[str, str]:
        """
        decrypt tool credentials with tenant id

        return a deep copy of credentials with decrypted values
        """
        credentials = self._deep_copy(credentials)

        # get fields need to be decrypted
        fields = self.provider_controller.get_credentials_schema()
        for field_name, field in fields.items():
            if field.type == ToolProviderCredentials.CredentialsType.SECRET_INPUT:
                if field_name in credentials:
                    try:
                        credentials[field_name] = encrypter.decrypt_token(self.tenant_id, credentials[field_name])
                    except:
                        pass
        
        return credentials