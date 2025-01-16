import json
import logging
import time
from collections.abc import Mapping
from typing import Any

import requests
from requests.exceptions import HTTPError

logger = logging.getLogger(__name__)


class FirecrawlApp:
    def __init__(self, api_key: str | None = None, base_url: str | None = None):
        self.api_key = api_key
        self.base_url = base_url or "https://api.firecrawl.dev"
        if not self.api_key:
            raise ValueError("API key is required")

    def _prepare_headers(self, idempotency_key: str | None = None):
        headers = {"Content-Type": "application/json", "Authorization": f"Bearer {self.api_key}"}
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        return headers

    def _request(
        self,
        method: str,
        url: str,
        data: Mapping[str, Any] | None = None,
        headers: Mapping[str, str] | None = None,
        retries: int = 3,
        backoff_factor: float = 0.3,
    ) -> Mapping[str, Any] | None:
        if not headers:
            headers = self._prepare_headers()
        for i in range(retries):
            try:
                response = requests.request(method, url, json=data, headers=headers)
                return response.json()
            except requests.exceptions.RequestException:
                if i < retries - 1:
                    time.sleep(backoff_factor * (2**i))
                else:
                    raise
        return None

    def scrape_url(self, url: str, **kwargs):
        endpoint = f"{self.base_url}/v1/scrape"
        data = {"url": url, **kwargs}
        logger.debug(f"Sent request to {endpoint=} body={data}")
        response = self._request("POST", endpoint, data)
        if response is None:
            raise HTTPError("Failed to scrape URL after multiple retries")
        return response

    def map(self, url: str, **kwargs):
        endpoint = f"{self.base_url}/v1/map"
        data = {"url": url, **kwargs}
        logger.debug(f"Sent request to {endpoint=} body={data}")
        response = self._request("POST", endpoint, data)
        if response is None:
            raise HTTPError("Failed to perform map after multiple retries")
        return response

    def crawl_url(
        self, url: str, wait: bool = True, poll_interval: int = 5, idempotency_key: str | None = None, **kwargs
    ):
        endpoint = f"{self.base_url}/v1/crawl"
        headers = self._prepare_headers(idempotency_key)
        data = {"url": url, **kwargs}
        logger.debug(f"Sent request to {endpoint=} body={data}")
        response = self._request("POST", endpoint, data, headers)
        if response is None:
            raise HTTPError("Failed to initiate crawl after multiple retries")
        elif response.get("success") == False:
            raise HTTPError(f"Failed to crawl: {response.get('error')}")
        job_id: str = response["id"]
        if wait:
            return self._monitor_job_status(job_id=job_id, poll_interval=poll_interval)
        return response

    def check_crawl_status(self, job_id: str):
        endpoint = f"{self.base_url}/v1/crawl/{job_id}"
        response = self._request("GET", endpoint)
        if response is None:
            raise HTTPError(f"Failed to check status for job {job_id} after multiple retries")
        return response

    def cancel_crawl_job(self, job_id: str):
        endpoint = f"{self.base_url}/v1/crawl/{job_id}"
        response = self._request("DELETE", endpoint)
        if response is None:
            raise HTTPError(f"Failed to cancel job {job_id} after multiple retries")
        return response

    def _monitor_job_status(self, job_id: str, poll_interval: int):
        while True:
            status = self.check_crawl_status(job_id)
            if status["status"] == "completed":
                return status
            elif status["status"] == "failed":
                raise HTTPError(f"Job {job_id} failed: {status['error']}")
            time.sleep(poll_interval)


def get_array_params(tool_parameters: dict[str, Any], key):
    param = tool_parameters.get(key)
    if param:
        return param.split(",")


def get_json_params(tool_parameters: dict[str, Any], key):
    param = tool_parameters.get(key)
    if param:
        try:
            # support both single quotes and double quotes
            param = param.replace("'", '"')
            param = json.loads(param)
        except Exception:
            raise ValueError(f"Invalid {key} format.")
        return param
