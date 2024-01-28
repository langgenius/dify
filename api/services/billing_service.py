import os

import requests
from extensions.ext_database import db
from models.account import TenantAccountJoin


class BillingService:
    base_url = os.environ.get('BILLING_API_URL', 'BILLING_API_URL')
    secret_key = os.environ.get('BILLING_API_SECRET_KEY', 'BILLING_API_SECRET_KEY')

    @classmethod
    def get_info(cls, tenant_id: str):
        params = {'tenant_id': tenant_id}

        billing_info = cls._send_request('GET', '/subscription/info', params=params)

        return billing_info

    @classmethod
    def get_subscription(cls, plan: str,
                         interval: str,
                         prefilled_email: str = '',
                         tenant_id: str = ''):
        params = {
            'plan': plan,
            'interval': interval,
            'prefilled_email': prefilled_email,
            'tenant_id': tenant_id
        }
        return cls._send_request('GET', '/subscription/payment-link', params=params)

    @classmethod
    def get_model_provider_payment_link(cls,
                                        provider_name: str,
                                        tenant_id: str,
                                        account_id: str,
                                        prefilled_email: str):
        params = {
            'provider_name': provider_name,
            'tenant_id': tenant_id,
            'account_id': account_id,
            'prefilled_email': prefilled_email
        }
        return cls._send_request('GET', '/model-provider/payment-link', params=params)

    @classmethod
    def get_invoices(cls, prefilled_email: str = '', tenant_id: str = ''):
        params = {
            'prefilled_email': prefilled_email,
            'tenant_id': tenant_id
        }
        return cls._send_request('GET', '/invoices', params=params)

    @classmethod
    def _send_request(cls, method, endpoint, json=None, params=None):
        headers = {
            "Content-Type": "application/json",
            "Billing-Api-Secret-Key": cls.secret_key
        }

        url = f"{cls.base_url}{endpoint}"
        response = requests.request(method, url, json=json, params=params, headers=headers)

        return response.json()

    @staticmethod
    def is_tenant_owner_or_admin(current_user):
        tenant_id = current_user.current_tenant_id

        join = db.session.query(TenantAccountJoin).filter(
            TenantAccountJoin.tenant_id == tenant_id,
            TenantAccountJoin.account_id == current_user.id
        ).first()

        if join.role not in ['owner', 'admin']:
            raise ValueError('Only team owner or team admin can perform this action')
