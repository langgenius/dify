import json

import requests

from services.auth.api_key_auth_base import ApiKeyAuthBase


class FirecrawlAuth(ApiKeyAuthBase):
    def __init__(self, credentials: dict):
        super().__init__(credentials)
        auth_type = credentials.get("auth_type")
        if auth_type != "bearer":
            raise ValueError("Invalid auth type, Firecrawl auth type must be Bearer")
        self.api_key = credentials.get("config", {}).get("api_key", None)
        self.base_url = credentials.get("config", {}).get("base_url", "https://api.firecrawl.dev")

        if not self.api_key:
            raise ValueError("No API key provided")

    def validate_credentials(self):
        headers = self._prepare_headers()
        options = {
            "url": "https://example.com",
            "crawlerOptions": {"excludes": [], "includes": [], "limit": 1},
            "pageOptions": {"onlyMainContent": True},
        }
        response = self._post_request(f"{self.base_url}/v0/crawl", options, headers)
        if response.status_code == 200:
            return True
        else:
            self._handle_error(response)

    def _prepare_headers(self):
        return {"Content-Type": "application/json", "Authorization": f"Bearer {self.api_key}"}

    def _post_request(self, url, data, headers):
        return requests.post(url, headers=headers, json=data)

    def _handle_error(self, response):
        if response.status_code in {402, 409, 500}:
            error_message = response.json().get("error", "Unknown error occurred")
            raise Exception(f"Failed to authorize. Status code: {response.status_code}. Error: {error_message}")
        else:
            if response.text:
                error_message = json.loads(response.text).get("error", "Unknown error occurred")
                raise Exception(f"Failed to authorize. Status code: {response.status_code}. Error: {error_message}")
            raise Exception(f"Unexpected error occurred while trying to authorize. Status code: {response.status_code}")
