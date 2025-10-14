import json
from urllib.parse import urljoin

import httpx

from services.auth.api_key_auth_base import ApiKeyAuthBase


class WatercrawlAuth(ApiKeyAuthBase):
    def __init__(self, credentials: dict):
        super().__init__(credentials)
        auth_type = credentials.get("auth_type")
        if auth_type != "x-api-key":
            raise ValueError("Invalid auth type, WaterCrawl auth type must be x-api-key")
        self.api_key = credentials.get("config", {}).get("api_key", None)
        self.base_url = credentials.get("config", {}).get("base_url", "https://app.watercrawl.dev")

        if not self.api_key:
            raise ValueError("No API key provided")

    def validate_credentials(self):
        headers = self._prepare_headers()
        url = urljoin(self.base_url, "/api/v1/core/crawl-requests/")
        response = self._get_request(url, headers)
        if response.status_code == 200:
            return True
        else:
            self._handle_error(response)

    def _prepare_headers(self):
        return {"Content-Type": "application/json", "X-API-KEY": self.api_key}

    def _get_request(self, url, headers):
        return httpx.get(url, headers=headers)

    def _handle_error(self, response):
        if response.status_code in {402, 409, 500}:
            error_message = response.json().get("error", "Unknown error occurred")
            raise Exception(f"Failed to authorize. Status code: {response.status_code}. Error: {error_message}")
        else:
            if response.text:
                error_message = json.loads(response.text).get("error", "Unknown error occurred")
                raise Exception(f"Failed to authorize. Status code: {response.status_code}. Error: {error_message}")
            raise Exception(f"Unexpected error occurred while trying to authorize. Status code: {response.status_code}")
