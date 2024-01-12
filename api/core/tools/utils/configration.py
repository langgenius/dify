from typing import Dict, Any
from pydantic import BaseModel

from core.tools.entities.tool_entities import ToolProviderCredentials
from core.tools.provider.tool_provider import ToolProviderController
from core.helper import encrypter

class ToolConfiguration(BaseModel):
    tenant_id: str
    provider_controller: ToolProviderController

    def encrypt_tool_credentials(self, credentails: Dict[str, str]) -> Dict[str, str]:
        """
        encrypt tool credentials with tanent id

        return a deep copy of credentials with encrypted values
        """
        # TODO: deep copy
        credentials = credentials.copy()

        # get fields need to be decrypted
        decoding_rsa_key, decoding_cipher_rsa = encrypter.get_decrypt_decoding(self.tenant_id)
        fields = self.provider_controller.get_credentails_schema()
        for field_name, field in fields.items():
            if field.type == ToolProviderCredentials.CredentialsType.SECRET_INPUT:
                if field_name in credentials:
                    # TODO: encrypt
                    pass
        
        return credentials
    
    def mask_tool_credentials(self, credentials: Dict[str, Any]) -> Dict[str, Any]:
        """
        mask tool credentials

        return a deep copy of credentials with masked values
        """
        return credentials

    def decrypt_tool_credentials(self, credentials: Dict[str, str]) -> Dict[str, str]:
        """
        decrypt tool credentials with tanent id

        return a deep copy of credentials with decrypted values
        """

        # TODO: deep copy
        credentials = credentials.copy()

        # get fields need to be decrypted
        decoding_rsa_key, decoding_cipher_rsa = encrypter.get_decrypt_decoding(self.tenant_id)
        fields = self.provider_controller.get_credentails_schema()
        for field_name, field in fields.items():
            if field.type == ToolProviderCredentials.CredentialsType.SECRET_INPUT:
                if field_name in credentials:
                    # TODO: decrypt
                    credentials[field_name] = '****'
        
        return credentials