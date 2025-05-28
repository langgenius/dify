import json
import time
from typing import Any, cast

import requests

from extensions.ext_storage import storage


class FirecrawlApp:
    def __init__(self, api_key=None, base_url=None):
        self.api_key = api_key
        self.base_url = base_url or "https://api.firecrawl.dev"
        if self.api_key is None and self.base_url == "https://api.firecrawl.dev":
            raise ValueError("No API key provided")

    def scrape_url(self, url, params=None) -> dict[str, Any]:
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
        response = self._post_request(f"{self.base_url}/v1/scrape", json_data, headers)
        if response.status_code == 200:
            response_data = response.json()
            data = response_data["data"]
            return self._extract_common_fields(data)
        elif response.status_code in {402, 409, 500, 429, 408}:
            self._handle_error(response, "scrape URL")
            return {}  # Avoid additional exception after handling error
        else:
            raise Exception(f"Failed to scrape URL. Status code: {response.status_code}")

    def crawl_url(self, url, params=None) -> str:
        # Documentation: https://docs.firecrawl.dev/api-reference/endpoint/crawl-post
        headers = self._prepare_headers()
        json_data = {"url": url}
        if params:
            json_data.update(params)
        response = self._post_request(f"{self.base_url}/v1/crawl", json_data, headers)
        if response.status_code == 200:
            # There's also another two fields in the response: "success" (bool) and "url" (str)
            job_id = response.json().get("id")
            return cast(str, job_id)
        else:
            self._handle_error(response, "start crawl job")
            # FIXME: unreachable code for mypy
            return ""  # unreachable

    def check_crawl_status(self, job_id) -> dict[str, Any]:
        headers = self._prepare_headers()
        response = self._get_request(f"{self.base_url}/v1/crawl/{job_id}", headers)
        if response.status_code == 200:
            crawl_status_response = response.json()
            if crawl_status_response.get("status") == "completed":
                total = crawl_status_response.get("total", 0)
                if total == 0:
                    raise Exception("Failed to check crawl status. Error: No page found")
                data = crawl_status_response.get("data", [])
                url_data_list = []
                for item in data:
                    if isinstance(item, dict) and "metadata" in item and "markdown" in item:
                        url_data = self._extract_common_fields(item)
                        url_data_list.append(url_data)
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
        else:
            self._handle_error(response, "check crawl status")
            # FIXME: unreachable code for mypy
            return {}  # unreachable

    def _format_crawl_status_response(
        self, status: str, crawl_status_response: dict[str, Any], url_data_list: list[dict[str, Any]]
    ) -> dict[str, Any]:
        return {
            "status": status,
            "total": crawl_status_response.get("total"),
            "current": crawl_status_response.get("completed"),
            "data": url_data_list,
        }

    def _extract_common_fields(self, item: dict[str, Any]) -> dict[str, Any]:
        return {
            "title": item.get("metadata", {}).get("title"),
            "description": item.get("metadata", {}).get("description"),
            "source_url": item.get("metadata", {}).get("sourceURL"),
            "markdown": item.get("markdown"),
        }

    def _prepare_headers(self) -> dict[str, Any]:
        return {"Content-Type": "application/json", "Authorization": f"Bearer {self.api_key}"}

    def _post_request(self, url, data, headers, retries=3, backoff_factor=0.5) -> requests.Response:
        for attempt in range(retries):
            response = requests.post(url, headers=headers, json=data)
            if response.status_code == 502:
                time.sleep(backoff_factor * (2**attempt))
            else:
                return response
        return response

    def _get_request(self, url, headers, retries=3, backoff_factor=0.5) -> requests.Response:
        for attempt in range(retries):
            response = requests.get(url, headers=headers)
            if response.status_code == 502:
                time.sleep(backoff_factor * (2**attempt))
            else:
                return response
        return response

    def _handle_error(self, response, action) -> None:
        error_message = response.json().get("error", "Unknown error occurred")
        raise Exception(f"Failed to {action}. Status code: {response.status_code}. Error: {error_message}")
