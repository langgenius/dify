import json
import time
from typing import Any, NotRequired, cast

import httpx
from typing_extensions import TypedDict

from extensions.ext_storage import storage


class FirecrawlDocumentData(TypedDict):
    title: str | None
    description: str | None
    source_url: str | None
    markdown: str | None


class CrawlStatusResponse(TypedDict):
    status: str
    total: int | None
    current: int | None
    data: list[FirecrawlDocumentData]


class MapResponse(TypedDict):
    success: bool
    links: list[str]


class SearchResponse(TypedDict):
    success: bool
    data: list[dict[str, Any]]
    warning: NotRequired[str]


class FirecrawlApp:
    def __init__(self, api_key=None, base_url=None):
        self.api_key = api_key
        self.base_url = base_url or "https://api.firecrawl.dev"
        if self.api_key is None and self.base_url == "https://api.firecrawl.dev":
            raise ValueError("No API key provided")

    def scrape_url(self, url, params=None) -> FirecrawlDocumentData:
        # Documentation: https://docs.firecrawl.dev/api-reference/endpoint/scrape
        headers = self._prepare_headers()
        json_data = {
            "url": url,
            "formats": ["markdown"],
            "onlyMainContent": True,
            "timeout": 30000,
        }
        if params:
            json_data.update(params)
        response = self._post_request(self._build_url("v2/scrape"), json_data, headers)
        if response.status_code == 200:
            response_data = response.json()
            data = response_data["data"]
            return self._extract_common_fields(data)
        elif response.status_code in {402, 409, 500, 429, 408}:
            self._handle_error(response, "scrape URL")
        raise Exception(f"Failed to scrape URL. Status code: {response.status_code}")

    def crawl_url(self, url, params=None) -> str:
        # Documentation: https://docs.firecrawl.dev/api-reference/endpoint/crawl-post
        headers = self._prepare_headers()
        json_data = {"url": url}
        if params:
            json_data.update(params)
        response = self._post_request(self._build_url("v2/crawl"), json_data, headers)
        if response.status_code == 200:
            # There's also another two fields in the response: "success" (bool) and "url" (str)
            job_id = response.json().get("id")
            return cast(str, job_id)
        else:
            self._handle_error(response, "start crawl job")
            return ""  # unreachable

    def map(self, url: str, params: dict[str, Any] | None = None) -> MapResponse:
        # Documentation: https://docs.firecrawl.dev/api-reference/endpoint/map
        headers = self._prepare_headers()
        json_data: dict[str, Any] = {"url": url, "integration": "dify"}
        if params:
            # Pass through provided params, including optional "sitemap": "only" | "include" | "skip"
            json_data.update(params)
        response = self._post_request(self._build_url("v2/map"), json_data, headers)
        if response.status_code == 200:
            return cast(MapResponse, response.json())
        elif response.status_code in {402, 409, 500, 429, 408}:
            self._handle_error(response, "start map job")
        raise Exception(f"Failed to start map job. Status code: {response.status_code}")

    def check_crawl_status(self, job_id) -> CrawlStatusResponse:
        headers = self._prepare_headers()
        response = self._get_request(self._build_url(f"v2/crawl/{job_id}"), headers)
        if response.status_code == 200:
            crawl_status_response = response.json()
            if crawl_status_response.get("status") == "completed":
                # Normalize to avoid None bypassing the zero-guard when the API returns null.
                total = crawl_status_response.get("total") or 0
                if total <= 0:
                    raise Exception("Failed to check crawl status. Error: No page found")
                url_data_list = self._collect_all_crawl_pages(crawl_status_response, headers)
                if url_data_list:
                    file_key = "website_files/" + job_id + ".txt"
                    try:
                        if storage.exists(file_key):
                            storage.delete(file_key)
                        storage.save(file_key, json.dumps(url_data_list).encode("utf-8"))
                    except Exception as e:
                        raise Exception(f"Error saving crawl data: {e}")
                return self._format_crawl_status_response("completed", crawl_status_response, url_data_list)
            else:
                return self._format_crawl_status_response(
                    crawl_status_response.get("status"), crawl_status_response, []
                )
        self._handle_error(response, "check crawl status")
        raise RuntimeError("unreachable: _handle_error always raises")

    def _collect_all_crawl_pages(
        self, first_page: dict[str, Any], headers: dict[str, str]
    ) -> list[FirecrawlDocumentData]:
        """Collect all crawl result pages by following pagination links.

        Raises an exception if any paginated request fails, to avoid returning
        partial data that is inconsistent with the reported total.

        The number of pages processed is capped at ``total`` (the
        server-reported page count) to guard against infinite loops caused by
        a misbehaving server that keeps returning a ``next`` URL.
        """
        total: int = first_page.get("total") or 0
        url_data_list: list[FirecrawlDocumentData] = []
        current_page = first_page
        pages_processed = 0
        while True:
            for item in current_page.get("data", []):
                if isinstance(item, dict) and "metadata" in item and "markdown" in item:
                    url_data_list.append(self._extract_common_fields(item))
            next_url: str | None = current_page.get("next")
            pages_processed += 1
            if not next_url or pages_processed >= total:
                break
            response = self._get_request(next_url, headers)
            if response.status_code != 200:
                self._handle_error(response, "fetch next crawl page")
            current_page = response.json()
        return url_data_list

    def _format_crawl_status_response(
        self,
        status: str,
        crawl_status_response: dict[str, Any],
        url_data_list: list[FirecrawlDocumentData],
    ) -> CrawlStatusResponse:
        return {
            "status": status,
            "total": crawl_status_response.get("total"),
            "current": crawl_status_response.get("completed"),
            "data": url_data_list,
        }

    def _extract_common_fields(self, item: dict[str, Any]) -> FirecrawlDocumentData:
        return {
            "title": item.get("metadata", {}).get("title"),
            "description": item.get("metadata", {}).get("description"),
            "source_url": item.get("metadata", {}).get("sourceURL"),
            "markdown": item.get("markdown"),
        }

    def _prepare_headers(self) -> dict[str, str]:
        return {"Content-Type": "application/json", "Authorization": f"Bearer {self.api_key}"}

    def _build_url(self, path: str) -> str:
        # ensure exactly one slash between base and path, regardless of user-provided base_url
        return f"{self.base_url.rstrip('/')}/{path.lstrip('/')}"

    def _post_request(self, url, data, headers, retries=3, backoff_factor=0.5) -> httpx.Response:
        for attempt in range(retries):
            response = httpx.post(url, headers=headers, json=data)
            if response.status_code == 502:
                time.sleep(backoff_factor * (2**attempt))
            else:
                return response
        return response

    def _get_request(self, url, headers, retries=3, backoff_factor=0.5) -> httpx.Response:
        for attempt in range(retries):
            response = httpx.get(url, headers=headers)
            if response.status_code == 502:
                time.sleep(backoff_factor * (2**attempt))
            else:
                return response
        return response

    def _handle_error(self, response, action):
        try:
            payload = response.json()
            error_message = payload.get("error") or payload.get("message") or response.text or "Unknown error occurred"
        except json.JSONDecodeError:
            error_message = response.text or "Unknown error occurred"
        raise Exception(f"Failed to {action}. Status code: {response.status_code}. Error: {error_message}")  # type: ignore[return]

    def search(self, query: str, params: dict[str, Any] | None = None) -> SearchResponse:
        # Documentation: https://docs.firecrawl.dev/api-reference/endpoint/search
        headers = self._prepare_headers()
        json_data: dict[str, Any] = {
            "query": query,
            "limit": 5,
            "lang": "en",
            "country": "us",
            "timeout": 60000,
            "ignoreInvalidURLs": True,
            "scrapeOptions": {},
            "sources": [
                {"type": "web"},
            ],
            "integration": "dify",
        }
        if params:
            json_data.update(params)
        response = self._post_request(self._build_url("v2/search"), json_data, headers)
        if response.status_code == 200:
            response_data: SearchResponse = response.json()
            if not response_data.get("success"):
                raise Exception(f"Search failed. Error: {response_data.get('warning', 'Unknown error')}")
            return response_data
        elif response.status_code in {402, 409, 500, 429, 408}:
            self._handle_error(response, "perform search")
        raise Exception(f"Failed to perform search. Status code: {response.status_code}")
