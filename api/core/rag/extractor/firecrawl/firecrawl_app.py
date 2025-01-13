import json
import time
from typing import cast

import requests

from extensions.ext_storage import storage


class FirecrawlApp:
    def __init__(self, api_key=None, base_url=None):
        self.api_key = api_key
        self.base_url = base_url or "https://api.firecrawl.dev"
        if self.api_key is None and self.base_url == "https://api.firecrawl.dev":
            raise ValueError("No API key provided")

    def scrape_url(self, url, params=None) -> dict:
        headers = {"Content-Type": "application/json", "Authorization": f"Bearer {self.api_key}"}
        json_data = {"url": url}
        if params:
            json_data.update(params)
        response = requests.post(f"{self.base_url}/v0/scrape", headers=headers, json=json_data)
        if response.status_code == 200:
            response_data = response.json()
            if response_data["success"] == True:
                data = response_data["data"]
                return {
                    "title": data.get("metadata").get("title"),
                    "description": data.get("metadata").get("description"),
                    "source_url": data.get("metadata").get("sourceURL"),
                    "markdown": data.get("markdown"),
                }
            else:
                raise Exception(f'Failed to scrape URL. Error: {response_data["error"]}')

        elif response.status_code in {402, 409, 500}:
            error_message = response.json().get("error", "Unknown error occurred")
            raise Exception(f"Failed to scrape URL. Status code: {response.status_code}. Error: {error_message}")
        else:
            raise Exception(f"Failed to scrape URL. Status code: {response.status_code}")

    def crawl_url(self, url, params=None) -> str:
        headers = self._prepare_headers()
        json_data = {"url": url}
        if params:
            json_data.update(params)
        response = self._post_request(f"{self.base_url}/v0/crawl", json_data, headers)
        if response.status_code == 200:
            job_id = response.json().get("jobId")
            return cast(str, job_id)
        else:
            self._handle_error(response, "start crawl job")
            # FIXME: unreachable code for mypy
            return ""  # unreachable

    def check_crawl_status(self, job_id) -> dict:
        headers = self._prepare_headers()
        response = self._get_request(f"{self.base_url}/v0/crawl/status/{job_id}", headers)
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
                        url_data = {
                            "title": item.get("metadata", {}).get("title"),
                            "description": item.get("metadata", {}).get("description"),
                            "source_url": item.get("metadata", {}).get("sourceURL"),
                            "markdown": item.get("markdown"),
                        }
                        url_data_list.append(url_data)
                if url_data_list:
                    file_key = "website_files/" + job_id + ".txt"
                    if storage.exists(file_key):
                        storage.delete(file_key)
                    storage.save(file_key, json.dumps(url_data_list).encode("utf-8"))
                return {
                    "status": "completed",
                    "total": crawl_status_response.get("total"),
                    "current": crawl_status_response.get("current"),
                    "data": url_data_list,
                }

            else:
                return {
                    "status": crawl_status_response.get("status"),
                    "total": crawl_status_response.get("total"),
                    "current": crawl_status_response.get("current"),
                    "data": [],
                }

        else:
            self._handle_error(response, "check crawl status")
            # FIXME: unreachable code for mypy
            return {}  # unreachable

    def _prepare_headers(self):
        return {"Content-Type": "application/json", "Authorization": f"Bearer {self.api_key}"}

    def _post_request(self, url, data, headers, retries=3, backoff_factor=0.5):
        for attempt in range(retries):
            response = requests.post(url, headers=headers, json=data)
            if response.status_code == 502:
                time.sleep(backoff_factor * (2**attempt))
            else:
                return response
        return response

    def _get_request(self, url, headers, retries=3, backoff_factor=0.5):
        for attempt in range(retries):
            response = requests.get(url, headers=headers)
            if response.status_code == 502:
                time.sleep(backoff_factor * (2**attempt))
            else:
                return response
        return response

    def _handle_error(self, response, action):
        error_message = response.json().get("error", "Unknown error occurred")
        raise Exception(f"Failed to {action}. Status code: {response.status_code}. Error: {error_message}")
