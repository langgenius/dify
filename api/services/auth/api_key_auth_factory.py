from services.auth.api_key_auth_base import ApiKeyAuthBase, ApiKeyAuthCredentials
from services.auth.auth_type import AuthProvider, AuthType


class ApiKeyAuthFactory:
    auth: ApiKeyAuthBase

    def __init__(self, provider: AuthProvider, credentials: ApiKeyAuthCredentials) -> None:
        auth_factory = self.get_apikey_auth_factory(provider)
        self.auth = auth_factory(credentials)

    def validate_credentials(self) -> bool:
        return self.auth.validate_credentials()

    @staticmethod
    def get_apikey_auth_factory(provider: AuthProvider) -> type[ApiKeyAuthBase]:
        match ApiKeyAuthFactory._normalize_provider(provider):
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

    @staticmethod
    def _normalize_provider(provider: AuthProvider) -> AuthType | str:
        if isinstance(provider, AuthType):
            return provider

        try:
            return AuthType(provider)
        except ValueError:
            return provider
