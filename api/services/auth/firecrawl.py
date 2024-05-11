import os
import requests


class FirecrawlAuth:
    def __init__(self, api_key=None, endpoint=None):
        self.api_key = api_key or os.getenv('FIRECRAWL_API_KEY')
        if self.api_key is None:
            raise ValueError('No API key provided')

    def _validate_credentials(self):
        headers = self._prepare_headers()
        options = {
            'url': 'https://example.com',
            'crawlerOptions': {
                'excludes': [],
                'includes': [],
                'limit': 1
            },
            'pageOptions': {
                'onlyMainContent': True
            }
        }
        response = self._post_request('https://api.firecrawl.dev/v0/crawl', options, headers)
        if response.status_code == 200:
            return True
        else:
            self._handle_error(response, 'start crawl job')

    def check_crawl_status(self, job_id):
        headers = self._prepare_headers()
        response = self._get_request(f'https://api.firecrawl.dev/v0/crawl/status/{job_id}', headers)
        if response.status_code == 200:
            return response.json()
        else:
            self._handle_error(response, 'check crawl status')

    def _prepare_headers(self):
        return {
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {self.api_key}'
        }

    def _post_request(self, url, data, headers):
        return requests.post(url, headers=headers, json=data)

    def _get_request(self, url, headers):
        return requests.get(url, headers=headers)

    def _monitor_job_status(self, job_id, headers, timeout):
        import time
        while True:
            status_response = self._get_request(f'https://api.firecrawl.dev/v0/crawl/status/{job_id}', headers)
            if status_response.status_code == 200:
                status_data = status_response.json()
                if status_data['status'] == 'completed':
                    if 'data' in status_data:
                        return status_data['data']
                    else:
                        raise Exception('Crawl job completed but no data was returned')
                elif status_data['status'] in ['active', 'paused', 'pending', 'queued']:
                    if timeout < 2:
                        timeout = 2
                    time.sleep(timeout)  # Wait for the specified timeout before checking again
                else:
                    raise Exception(f'Crawl job failed or was stopped. Status: {status_data["status"]}')
            else:
                self._handle_error(status_response, 'check crawl status')

    def _handle_error(self, response, action):
        if response.status_code in [402, 409, 500]:
            error_message = response.json().get('error', 'Unknown error occurred')
            raise Exception(f'Failed to {action}. Status code: {response.status_code}. Error: {error_message}')
        else:
            raise Exception(f'Unexpected error occurred while trying to {action}. Status code: {response.status_code}')
