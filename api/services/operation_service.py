import os
from typing import TypedDict

import httpx


class UtmInfo(TypedDict, total=False):
    """Expected shape of the utm_info dict passed to record_utm.

    All fields are optional; missing keys default to an empty string.
    """

    utm_source: str
    utm_medium: str
    utm_campaign: str
    utm_content: str
    utm_term: str


class OperationService:
    base_url = os.environ.get("BILLING_API_URL", "BILLING_API_URL")
    secret_key = os.environ.get("BILLING_API_SECRET_KEY", "BILLING_API_SECRET_KEY")

    @classmethod
    def _send_request(cls, method, endpoint, json=None, params=None):
        headers = {"Content-Type": "application/json", "Billing-Api-Secret-Key": cls.secret_key}

        url = f"{cls.base_url}{endpoint}"
        response = httpx.request(method, url, json=json, params=params, headers=headers)

        return response.json()

    @classmethod
    def record_utm(cls, tenant_id: str, utm_info: UtmInfo):
        params = {
            "tenant_id": tenant_id,
            "utm_source": utm_info.get("utm_source", ""),
            "utm_medium": utm_info.get("utm_medium", ""),
            "utm_campaign": utm_info.get("utm_campaign", ""),
            "utm_content": utm_info.get("utm_content", ""),
            "utm_term": utm_info.get("utm_term", ""),
        }
        return cls._send_request("POST", "/tenant_utms", params=params)
