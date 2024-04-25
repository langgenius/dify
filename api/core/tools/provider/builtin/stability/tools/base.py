import requests
from yarl import URL

from core.tools.errors import ToolProviderCredentialValidationError


class BaseStabilityAuthorization:
    def sd_validate_credentials(self, credentials: dict):
        """
        This method is responsible for validating the credentials.
        """
        api_key = credentials.get('api_key', '')
        if not api_key:
            raise ToolProviderCredentialValidationError('API key is required.')
        
        response = requests.get(
            URL('https://api.stability.ai') / 'v1' / 'user' / 'account', 
            headers=self.generate_authorization_headers(credentials),
            timeout=(5, 30)
        )

        if not response.ok:
            raise ToolProviderCredentialValidationError('Invalid API key.')

        return True
    
    def generate_authorization_headers(self, credentials: dict) -> dict[str, str]:
        """
        This method is responsible for generating the authorization headers.
        """
        return {
            'Authorization': f'Bearer {credentials.get("api_key", "")}'
        }
    