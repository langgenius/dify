import json
from urllib.parse import urljoin

import requests

from services.auth.api_key_auth_base import ApiKeyAuthBase


class ScrapflyAuth(ApiKeyAuthBase):
    def __init__(self, credentials: dict):
        super().__init__(credentials)
        auth_type = credentials.get("auth_type")
        if auth_type != "api-key":
            raise ValueError("Invalid auth type, Scrapfly auth type must be api-key")
        self.api_key = credentials.get("config", {}).get("api_key", None)
        self.base_url = credentials.get("config", {}).get("base_url", "https://api.scrapfly.io")

        if not self.api_key:
            raise ValueError("No API key provided")

    def validate_credentials(self):
        """
        Validate Scrapfly credentials by making a simple test request
        """
        url = urljoin(self.base_url, "/scrape")
        params = {
            "key": self.api_key,
            "url": "https://httpbin.org/json",  # Simple test URL
            "format": "json"
        }
        
        try:
            response = requests.get(url, params=params, timeout=10)
            if response.status_code == 200:
                return True
            else:
                self._handle_error(response)
        except requests.exceptions.RequestException as e:
            raise Exception(f"Failed to connect to Scrapfly API: {str(e)}")

    def _handle_error(self, response):
        """
        Handle API error responses
        """
        try:
            error_data = response.json()
            error_message = error_data.get("message", "Unknown error occurred")
        except (json.JSONDecodeError, AttributeError):
            error_message = response.text or "Unknown error occurred"

        if response.status_code == 401:
            raise Exception("Invalid API key. Please check your Scrapfly API key.")
        elif response.status_code == 402:
            raise Exception("Payment required. Please check your Scrapfly account billing.")
        elif response.status_code == 403:
            raise Exception("Access forbidden. Please check your Scrapfly API permissions.")
        elif response.status_code == 429:
            raise Exception("Rate limit exceeded. Please wait and try again.")
        elif 400 <= response.status_code < 500:
            raise Exception(f"Client error. Status code: {response.status_code}. Error: {error_message}")
        elif response.status_code >= 500:
            raise Exception(f"Server error. Status code: {response.status_code}. Error: {error_message}")
        else:
            raise Exception(f"Unexpected error occurred while trying to authorize. Status code: {response.status_code}")
