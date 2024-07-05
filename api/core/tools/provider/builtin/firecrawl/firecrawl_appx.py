import os
import time

import requests
from requests.exceptions import HTTPError


class FirecrawlApp:
    def __init__(self, api_key=None, base_url=None):
        self.api_key = api_key
        self.base_url = base_url or 'https://api.firecrawl.dev'
        if not self.api_key:
            raise ValueError("API key is required")

    def _prepare_headers(self, idempotency_key=None):
        headers = {
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {self.api_key}'
        }
        if idempotency_key:
            headers['Idempotency-Key'] = idempotency_key
        return headers

    def _request(self, method, url, data=None, headers=None, retries=3, backoff_factor=0.3):
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


    def scrape_url(self, url, **kwargs):
        endpoint = f'{self.base_url}/v0/scrape'
        headers = self._prepare_headers()
        data = {'url': url, **kwargs}
        return self._request('POST', endpoint, data, headers)

    def search(self, query, **kwargs):
        endpoint = f'{self.base_url}/v0/search'
        headers = self._prepare_headers()
        data = {'query': query, **kwargs}
        return self._request('POST', endpoint, data, headers)

    def crawl_url(self, url, wait=False, poll_interval=5, idempotency_key=None, **kwargs):
        endpoint = f'{self.base_url}/v0/crawl'
        headers = self._prepare_headers(idempotency_key)
        data = {'url': url, **kwargs}
        response = self._request('POST', endpoint, data, headers)
        job_id = response['jobId']  
        if wait:
            return self._monitor_job_status(job_id, headers, poll_interval)
        return job_id

    def check_crawl_status(self, job_id):
        endpoint = f'{self.base_url}/v0/crawl/status/{job_id}'
        headers = self._prepare_headers()
        return self._request('GET', endpoint, headers=headers)

    def _monitor_job_status(self, job_id, headers, poll_interval):
        while True:
            status = self.check_crawl_status(job_id)
            if status['status'] == 'completed':
                return status
            elif status['status'] == 'failed':
                raise HTTPError(f'Job {job_id} failed: {status["error"]}')
            time.sleep(poll_interval)

if __name__ == "__main__":
    api_key = os.getenv('FIRECRAWL_API_KEY')
    app = FirecrawlApp(api_key)
    try:
        result = app.scrape_url('https://example.com')
        print(result)
    except HTTPError as e:
        print("Error:", e)
