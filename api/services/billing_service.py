import os
import requests


class BillingService:
    base_url = os.environ.get('BILLING_API_URL', 'BILLING_API_URL')

    @classmethod
    def get_info(cls, tenant_id: str):
        params = {'tenant_id': tenant_id}

        return cls._send_request('GET', '/info', params=params)

    @classmethod
    def get_subscription(cls, prefilled_email: str = '', user_name: str = ''):
        params = {
            'prefilled_email': prefilled_email,
            'user_name': user_name
        }
        return cls._send_request('GET', '/subscription', params=params)

    @classmethod
    def get_invoices(cls, prefilled_email: str = ''):
        params = {'prefilled_email': prefilled_email}
        return cls._send_request('GET', '/invoices', params=params)

    @classmethod
    def _send_request(cls, method, endpoint, json=None, params=None):
        headers = {
            "Content-Type": "application/json"
        }

        url = f"{cls.base_url}{endpoint}"
        response = requests.request(method, url, json=json, params=params, headers=headers)

        return response.json()
