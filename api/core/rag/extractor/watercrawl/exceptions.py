"""WaterCrawl domain exceptions.

These exceptions are constructed from upstream HTTP responses, which may be
JSON API errors or plain text/HTML proxy errors. Keep the exception type stable
even when the body is not JSON so callers can handle WaterCrawl failures by
domain type instead of low-level parser errors.
"""

import json
from typing import Any, override

from httpx import Response


class WaterCrawlError(Exception):
    pass


class WaterCrawlBadRequestError(WaterCrawlError):
    def __init__(self, response: Response):
        self.status_code = response.status_code
        self.response = response
        try:
            data: Any = response.json()
        except ValueError:
            data = {}
        if not isinstance(data, dict):
            data = {}
        self.message = data.get("message") or response.text or "Unknown error occurred"
        self.errors = data.get("errors", {})
        super().__init__(self.message)

    @property
    def flat_errors(self):
        return json.dumps(self.errors)

    @override
    def __str__(self):
        return f"WaterCrawlBadRequestError: {self.message} \n {self.flat_errors}"


class WaterCrawlPermissionError(WaterCrawlBadRequestError):
    @override
    def __str__(self):
        return f"You are exceeding your WaterCrawl API limits. {self.message}"


class WaterCrawlAuthenticationError(WaterCrawlBadRequestError):
    @override
    def __str__(self):
        return "WaterCrawl API key is invalid or expired. Please check your API key and try again."
