import os

import httpx


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
    def record_utm(cls, tenant_id: str, utm_info: dict):
        params = {
            "tenant_id": tenant_id,
            "utm_source": utm_info.get("utm_source", ""),
            "utm_medium": utm_info.get("utm_medium", ""),
            "utm_campaign": utm_info.get("utm_campaign", ""),
            "utm_content": utm_info.get("utm_content", ""),
            "utm_term": utm_info.get("utm_term", ""),
        }
        return cls._send_request("POST", "/tenant_utms", params=params)
