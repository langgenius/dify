
from services.auth.firecrawl import FirecrawlAuth


class ApiKeyAuthFactory:

    def __init__(self, provider: str, credentials: dict):
        if provider == 'firecrawl':
            self.auth = FirecrawlAuth(credentials)
        else:
            raise ValueError('Invalid provider')

    def validate_credentials(self):
        return self.auth.validate_credentials()
