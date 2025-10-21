from services.auth.api_key_auth_base import ApiKeyAuthBase
from services.auth.auth_type import AuthType


class ApiKeyAuthFactory:
    def __init__(self, provider: str, credentials: dict):
        auth_factory = self.get_apikey_auth_factory(provider)
        self.auth = auth_factory(credentials)

    def validate_credentials(self):
        return self.auth.validate_credentials()

    @staticmethod
    def get_apikey_auth_factory(provider: str) -> type[ApiKeyAuthBase]:
        match provider:
            case AuthType.FIRECRAWL:
                from services.auth.firecrawl.firecrawl import FirecrawlAuth

                return FirecrawlAuth
            case AuthType.WATERCRAWL:
                from services.auth.watercrawl.watercrawl import WatercrawlAuth

                return WatercrawlAuth
            case AuthType.JINA:
                from services.auth.jina.jina import JinaAuth

                return JinaAuth
            case _:
                raise ValueError("Invalid provider")
