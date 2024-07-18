import os
from typing import Literal, Optional, TypedDict

import requests


class RequestParamsDict(TypedDict, total=False):
    url: Optional[str]
    request: Optional[Literal["http", "chrome", "smart"]]
    limit: Optional[int]
    return_format: Optional[Literal["raw", "markdown", "html2text", "text", "bytes"]]
    tld: Optional[bool]
    depth: Optional[int]
    cache: Optional[bool]
    budget: Optional[dict[str, int]]
    locale: Optional[str]
    cookies: Optional[str]
    stealth: Optional[bool]
    headers: Optional[dict[str, str]]
    anti_bot: Optional[bool]
    metadata: Optional[bool]
    viewport: Optional[dict[str, int]]
    encoding: Optional[str]
    subdomains: Optional[bool]
    user_agent: Optional[str]
    store_data: Optional[bool]
    gpt_config: Optional[list[str]]
    fingerprint: Optional[bool]
    storageless: Optional[bool]
    readability: Optional[bool]
    proxy_enabled: Optional[bool]
    respect_robots: Optional[bool]
    query_selector: Optional[str]
    full_resources: Optional[bool]
    request_timeout: Optional[int]
    run_in_background: Optional[bool]
    skip_config_checks: Optional[bool]


class Spider:
    def __init__(self, api_key: Optional[str] = None):
        """
        Initialize the Spider with an API key.

        :param api_key: A string of the API key for Spider. Defaults to the SPIDER_API_KEY environment variable.
        :raises ValueError: If no API key is provided.
        """
        self.api_key = api_key or os.getenv("SPIDER_API_KEY")
        if self.api_key is None:
            raise ValueError("No API key provided")

    def api_post(
        self,
        endpoint: str,
        data: dict,
        stream: bool,
        content_type: str = "application/json",
    ):
        """
        Send a POST request to the specified API endpoint.

        :param endpoint: The API endpoint to which the POST request is sent.
        :param data: The data (dictionary) to be sent in the POST request.
        :param stream: Boolean indicating if the response should be streamed.
        :return: The JSON response or the raw response stream if stream is True.
        """
        headers = self._prepare_headers(content_type)
        response = self._post_request(
            f"https://api.spider.cloud/v1/{endpoint}", data, headers, stream
        )

        if stream:
            return response
        elif response.status_code == 200:
            return response.json()
        else:
            self._handle_error(response, f"post to {endpoint}")

    def api_get(
        self, endpoint: str, stream: bool, content_type: str = "application/json"
    ):
        """
        Send a GET request to the specified endpoint.

        :param endpoint: The API endpoint from which to retrieve data.
        :return: The JSON decoded response.
        """
        headers = self._prepare_headers(content_type)
        response = self._get_request(
            f"https://api.spider.cloud/v1/{endpoint}", headers, stream
        )
        if response.status_code == 200:
            return response.json()
        else:
            self._handle_error(response, f"get from {endpoint}")

    def get_credits(self):
        """
        Retrieve the account's remaining credits.

        :return: JSON response containing the number of credits left.
        """
        return self.api_get("credits", stream=False)

    def scrape_url(
        self,
        url: str,
        params: Optional[RequestParamsDict] = None,
        stream: bool = False,
        content_type: str = "application/json",
    ):
        """
        Scrape data from the specified URL.

        :param url: The URL from which to scrape data.
        :param params: Optional dictionary of additional parameters for the scrape request.
        :return: JSON response containing the scraping results.
        """

        # Add { "return_format": "markdown" } to the params if not already present
        if "return_format" not in params:
            params["return_format"] = "markdown"    

        # Set limit to 1
        params["limit"] = 1

        return self.api_post(
            "crawl", {"url": url, **(params or {})}, stream, content_type
        )

    def crawl_url(
        self,
        url: str,
        params: Optional[RequestParamsDict] = None,
        stream: bool = False,
        content_type: str = "application/json",
    ):
        """
        Start crawling at the specified URL.

        :param url: The URL to begin crawling.
        :param params: Optional dictionary with additional parameters to customize the crawl.
        :param stream: Boolean indicating if the response should be streamed. Defaults to False.
        :return: JSON response or the raw response stream if streaming enabled.
        """

        # Add { "return_format": "markdown" } to the params if not already present
        if "return_format" not in params:
            params["return_format"] = "markdown"

        return self.api_post(
            "crawl", {"url": url, **(params or {})}, stream, content_type
        )

    def links(
        self,
        url: str,
        params: Optional[RequestParamsDict] = None,
        stream: bool = False,
        content_type: str = "application/json",
    ):
        """
        Retrieve links from the specified URL.

        :param url: The URL from which to extract links.
        :param params: Optional parameters for the link retrieval request.
        :return: JSON response containing the links.
        """
        return self.api_post(
            "links", {"url": url, **(params or {})}, stream, content_type
        )

    def extract_contacts(
        self,
        url: str,
        params: Optional[RequestParamsDict] = None,
        stream: bool = False,
        content_type: str = "application/json",
    ):
        """
        Extract contact information from the specified URL.

        :param url: The URL from which to extract contact information.
        :param params: Optional parameters for the contact extraction.
        :return: JSON response containing extracted contact details.
        """
        return self.api_post(
            "pipeline/extract-contacts",
            {"url": url, **(params or {})},
            stream,
            content_type,
        )

    def label(
        self,
        url: str,
        params: Optional[RequestParamsDict] = None,
        stream: bool = False,
        content_type: str = "application/json",
    ):
        """
        Apply labeling to data extracted from the specified URL.

        :param url: The URL to label data from.
        :param params: Optional parameters to guide the labeling process.
        :return: JSON response with labeled data.
        """
        return self.api_post(
            "pipeline/label", {"url": url, **(params or {})}, stream, content_type
        )

    def _prepare_headers(self, content_type: str = "application/json"):
        return {
            "Content-Type": content_type,
            "Authorization": f"Bearer {self.api_key}",
            "User-Agent": "Spider-Client/0.0.27",
        }

    def _post_request(self, url: str, data, headers, stream=False):
        return requests.post(url, headers=headers, json=data, stream=stream)

    def _get_request(self, url: str, headers, stream=False):
        return requests.get(url, headers=headers, stream=stream)

    def _delete_request(self, url: str, headers, stream=False):
        return requests.delete(url, headers=headers, stream=stream)

    def _handle_error(self, response, action):
        if response.status_code in [402, 409, 500]:
            error_message = response.json().get("error", "Unknown error occurred")
            raise Exception(
                f"Failed to {action}. Status code: {response.status_code}. Error: {error_message}"
            )
        else:
            raise Exception(
                f"Unexpected error occurred while trying to {action}. Status code: {response.status_code}"
            )
