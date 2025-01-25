import os
from typing import Literal, Optional

import httpx
from tenacity import retry, retry_if_exception_type, stop_before_delay, wait_fixed

from extensions.ext_database import db
from models.account import TenantAccountJoin, TenantAccountRole


class BillingService:
    base_url = os.environ.get("BILLING_API_URL", "BILLING_API_URL")
    secret_key = os.environ.get("BILLING_API_SECRET_KEY", "BILLING_API_SECRET_KEY")

    @classmethod
    def get_info(cls, tenant_id: str):
        params = {"tenant_id": tenant_id}

        billing_info = cls._send_request("GET", "/subscription/info", params=params)
        return billing_info

    @classmethod
    def get_subscription(cls, plan: str, interval: str, prefilled_email: str = "", tenant_id: str = ""):
        params = {"plan": plan, "interval": interval, "prefilled_email": prefilled_email, "tenant_id": tenant_id}
        return cls._send_request("GET", "/subscription/payment-link", params=params)

    @classmethod
    def get_model_provider_payment_link(cls, provider_name: str, tenant_id: str, account_id: str, prefilled_email: str):
        params = {
            "provider_name": provider_name,
            "tenant_id": tenant_id,
            "account_id": account_id,
            "prefilled_email": prefilled_email,
        }
        return cls._send_request("GET", "/model-provider/payment-link", params=params)

    @classmethod
    def get_invoices(cls, prefilled_email: str = "", tenant_id: str = ""):
        params = {"prefilled_email": prefilled_email, "tenant_id": tenant_id}
        return cls._send_request("GET", "/invoices", params=params)

    @classmethod
    @retry(
        wait=wait_fixed(2),
        stop=stop_before_delay(10),
        retry=retry_if_exception_type(httpx.RequestError),
        reraise=True,
    )
    def _send_request(cls, method: Literal["GET", "POST", "DELETE"], endpoint: str, json=None, params=None):
        headers = {"Content-Type": "application/json", "Billing-Api-Secret-Key": cls.secret_key}

        url = f"{cls.base_url}{endpoint}"
        response = httpx.request(method, url, json=json, params=params, headers=headers)
        if method == "GET" and response.status_code != httpx.codes.OK:
            raise ValueError("Unable to retrieve billing information. Please try again later or contact support.")
        return response.json()

    @staticmethod
    def is_tenant_owner_or_admin(current_user):
        tenant_id = current_user.current_tenant_id

        join: Optional[TenantAccountJoin] = (
            db.session.query(TenantAccountJoin)
            .filter(TenantAccountJoin.tenant_id == tenant_id, TenantAccountJoin.account_id == current_user.id)
            .first()
        )

        if not join:
            raise ValueError("Tenant account join not found")

        if not TenantAccountRole.is_privileged_role(join.role):
            raise ValueError("Only team owner or team admin can perform this action")

    @classmethod
    def delete_account(cls, account_id: str):
        """Delete account."""
        params = {"account_id": account_id}
        return cls._send_request("DELETE", "/account/", params=params)

    @classmethod
    def is_email_in_freeze(cls, email: str) -> bool:
        params = {"email": email}
        try:
            response = cls._send_request("GET", "/account/in-freeze", params=params)
            return bool(response.get("data", False))
        except Exception:
            return False

    @classmethod
    def update_account_deletion_feedback(cls, email: str, feedback: str):
        """Update account deletion feedback."""
        json = {"email": email, "feedback": feedback}
        return cls._send_request("POST", "/account/delete-feedback", json=json)
