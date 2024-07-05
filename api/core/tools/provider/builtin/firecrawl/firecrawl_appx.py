import time
from collections.abc import Mapping
from typing import Any

import requests
from requests.exceptions import HTTPError


class FirecrawlApp:
    def __init__(self, api_key: str | None = None, base_url: str | None = None):
        self.api_key = api_key
        self.base_url = base_url or 'https://api.firecrawl.dev'
        if not self.api_key:
            raise ValueError("API key is required")

    def _prepare_headers(self, idempotency_key: str | None = None):
        headers = {
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {self.api_key}'
        }
        if idempotency_key:
            headers['Idempotency-Key'] = idempotency_key
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
        for i in range(retries):
            try:
                response = requests.request(method, url, json=data, headers=headers)
                response.raise_for_status()
                return response.json()
            except requests.exceptions.RequestException as e:
                if i < retries - 1:
                    time.sleep(backoff_factor * (2 ** i))
                else:
                    raise
        return None

    def scrape_url(self, url: str, **kwargs):
        endpoint = f'{self.base_url}/v0/scrape'
        headers = self._prepare_headers()
        data = {'url': url, **kwargs}
        response = self._request('POST', endpoint, data, headers)
        if response is None:
            raise HTTPError("Failed to scrape URL after multiple retries")
        return response

    def search(self, query: str, **kwargs):
        endpoint = f'{self.base_url}/v0/search'
        headers = self._prepare_headers()
        data = {'query': query, **kwargs}
        response = self._request('POST', endpoint, data, headers)
        if response is None:
            raise HTTPError("Failed to perform search after multiple retries")
        return response

    def crawl_url(
        self, url: str, wait: bool = False, poll_interval: int = 5, idempotency_key: str | None = None, **kwargs
    ):
        endpoint = f'{self.base_url}/v0/crawl'
        headers = self._prepare_headers(idempotency_key)
        data = {'url': url, **kwargs}
        response = self._request('POST', endpoint, data, headers)
        if response is None:
            raise HTTPError("Failed to initiate crawl after multiple retries")
        job_id: str = response['jobId']
        if wait:
            return self._monitor_job_status(job_id=job_id, poll_interval=poll_interval)
        return job_id

    def check_crawl_status(self, job_id: str):
        endpoint = f'{self.base_url}/v0/crawl/status/{job_id}'
        headers = self._prepare_headers()
        response = self._request('GET', endpoint, headers=headers)
        if response is None:
            raise HTTPError(f"Failed to check status for job {job_id} after multiple retries")
        return response

    def _monitor_job_status(self, job_id: str, poll_interval: int):
        while True:
            status = self.check_crawl_status(job_id)
            if status['status'] == 'completed':
                return status
            elif status['status'] == 'failed':
                raise HTTPError(f'Job {job_id} failed: {status["error"]}')
            time.sleep(poll_interval)
