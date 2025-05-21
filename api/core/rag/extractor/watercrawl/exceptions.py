import json


class WaterCrawlError(Exception):
    pass


class WaterCrawlBadRequestError(WaterCrawlError):
    def __init__(self, response):
        self.status_code = response.status_code
        self.response = response
        data = response.json()
        self.message = data.get("message", "Unknown error occurred")
        self.errors = data.get("errors", {})
        super().__init__(self.message)

    @property
    def flat_errors(self):
        return json.dumps(self.errors)

    def __str__(self):
        return f"WaterCrawlBadRequestError: {self.message} \n {self.flat_errors}"


class WaterCrawlPermissionError(WaterCrawlBadRequestError):
    def __str__(self):
        return f"You are exceeding your WaterCrawl API limits. {self.message}"


class WaterCrawlAuthenticationError(WaterCrawlBadRequestError):
    def __str__(self):
        return "WaterCrawl API key is invalid or expired. Please check your API key and try again."
