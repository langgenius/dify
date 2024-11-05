import logging
import time
from collections.abc import Mapping
from typing import Any

import requests
from requests.exceptions import HTTPError

logger = logging.getLogger(__name__)


class DIDApp:
    def __init__(self, api_key: str | None = None, base_url: str | None = None):
        self.api_key = api_key
        self.base_url = base_url or "https://api.d-id.com"
        if not self.api_key:
            raise ValueError("API key is required")

    def _prepare_headers(self, idempotency_key: str | None = None):
        headers = {"Content-Type": "application/json", "Authorization": f"Basic {self.api_key}"}
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
        for i in range(retries):
            try:
                response = requests.request(method, url, json=data, headers=headers)
                response.raise_for_status()
                return response.json()
            except requests.exceptions.RequestException as e:
                if i < retries - 1 and isinstance(e, HTTPError) and e.response.status_code >= 500:
                    time.sleep(backoff_factor * (2**i))
                else:
                    raise
        return None

    def talks(self, wait: bool = True, poll_interval: int = 5, idempotency_key: str | None = None, **kwargs):
        endpoint = f"{self.base_url}/talks"
        headers = self._prepare_headers(idempotency_key)
        data = kwargs["params"]
        logger.debug(f"Send request to {endpoint=} body={data}")
        response = self._request("POST", endpoint, data, headers)
        if response is None:
            raise HTTPError("Failed to initiate D-ID talks after multiple retries")
        id: str = response["id"]
        if wait:
            return self._monitor_job_status(id=id, target="talks", poll_interval=poll_interval)
        return id

    def animations(self, wait: bool = True, poll_interval: int = 5, idempotency_key: str | None = None, **kwargs):
        endpoint = f"{self.base_url}/animations"
        headers = self._prepare_headers(idempotency_key)
        data = kwargs["params"]
        logger.debug(f"Send request to {endpoint=} body={data}")
        response = self._request("POST", endpoint, data, headers)
        if response is None:
            raise HTTPError("Failed to initiate D-ID talks after multiple retries")
        id: str = response["id"]
        if wait:
            return self._monitor_job_status(target="animations", id=id, poll_interval=poll_interval)
        return id

    def check_did_status(self, target: str, id: str):
        endpoint = f"{self.base_url}/{target}/{id}"
        headers = self._prepare_headers()
        response = self._request("GET", endpoint, headers=headers)
        if response is None:
            raise HTTPError(f"Failed to check status for talks {id} after multiple retries")
        return response

    def _monitor_job_status(self, target: str, id: str, poll_interval: int):
        while True:
            status = self.check_did_status(target=target, id=id)
            if status["status"] == "done":
                return status
            elif status["status"] == "error" or status["status"] == "rejected":
                raise HTTPError(f'Talks {id} failed: {status["status"]} {status.get("error", {}).get("description")}')
            time.sleep(poll_interval)
