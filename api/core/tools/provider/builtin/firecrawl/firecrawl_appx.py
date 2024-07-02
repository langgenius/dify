import os
import logging
import time
import requests
from requests.exceptions import HTTPError


class FirecrawlApp:
    def __init__(self, api_key=None, api_url=None):
        self.api_key = api_key
        if not self.api_key:
            raise ValueError("API key is required")
        self.api_url = api_url or 'https://api.firecrawl.dev'
        self.logger = logging.getLogger(__name__)

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
            except HTTPError as e:
                if response.status_code == 502 and i < retries - 1:
                    time.sleep(backoff_factor * (2 ** i))
                else:
                    self._handle_error(response)
        return None

    def _handle_error(self, response):
        try:
            error_detail = response.json()
        except ValueError:
            error_detail = response.text
        if response.status_code == 500:
            raise HTTPError(f'Server Error: {error_detail}')
        else:
            raise HTTPError(f'{response.status_code} Error: {error_detail}')

    def scrape_url(self, url, **kwargs):
        endpoint = f'{self.api_url}/v0/scrape'
        headers = self._prepare_headers()
        data = {'url': url, **kwargs}
        return self._request('POST', endpoint, data, headers)

    def search(self, query, **kwargs):
        endpoint = f'{self.api_url}/v0/search'
        headers = self._prepare_headers()
        data = {'query': query, **kwargs}
        return self._request('POST', endpoint, data, headers)

    def crawl_url(self, url, wait=False, poll_interval=5, idempotency_key=None, **kwargs):
        endpoint = f'{self.api_url}/v0/crawl'
        headers = self._prepare_headers(idempotency_key)
        data = {'url': url, **kwargs}
        job_id = self._request('POST', endpoint, data, headers)
        if wait:
            return self._monitor_job_status(job_id, headers, poll_interval)
        return job_id

    def check_crawl_status(self, job_id):
        endpoint = f'{self.api_url}/v0/crawl/status/{job_id}'
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


# Example usage
if __name__ == "__main__":
    logging.basicConfig(level=logging.DEBUG)
    api_key = os.getenv('FIRECRAWL_API_KEY')
    app = DifyFirecrawlApp(api_key)
    try:
        result = app.scrape_url('https://example.com')
        print(result)
        exit(0)
    except HTTPError as e:
        print("Error:", e)