import os

import requests


class EnterpriseRequest:
    base_url = os.environ.get('ENTERPRISE_API_URL', 'ENTERPRISE_API_URL')
    secret_key = os.environ.get('ENTERPRISE_API_SECRET_KEY', 'ENTERPRISE_API_SECRET_KEY')

    @classmethod
    def send_request(cls, method, endpoint, json=None, params=None):
        headers = {
            "Content-Type": "application/json",
            "Enterprise-Api-Secret-Key": cls.secret_key
        }

        url = f"{cls.base_url}{endpoint}"
        response = requests.request(method, url, json=json, params=params, headers=headers)

        return response.json()
