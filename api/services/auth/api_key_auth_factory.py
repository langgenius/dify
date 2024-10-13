from services.auth.firecrawl import FirecrawlAuth
from services.auth.jina import JinaAuth


class ApiKeyAuthFactory:
    def __init__(self, provider: str, credentials: dict):
        if provider == "firecrawl":
            self.auth = FirecrawlAuth(credentials)
        elif provider == "jinareader":
            self.auth = JinaAuth(credentials)
        else:
            raise ValueError("Invalid provider")

    def validate_credentials(self):
        return self.auth.validate_credentials()
